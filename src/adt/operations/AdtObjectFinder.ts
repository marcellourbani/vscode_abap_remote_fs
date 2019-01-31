import { AdtServer } from "./../AdtServer"
import { ADTClient, SearchResult, PathStep } from "abap-adt-api"
import { parseToPromise, getNode, recxml2js } from "../parsers/AdtParserBase"
import { mapWith, ArrayToMap, sapEscape } from "../../functions"
import { window, QuickPickItem, workspace } from "vscode"
import * as vscode from "vscode"
import {
  NodePath,
  findObjectInNode,
  findMainInclude
} from "../abap/AbapObjectUtilities"
import { isAbapNode } from "../../fs/AbapNode"

interface AdtObjectType {
  "nameditem:name": string
  "nameditem:description": string
  "nameditem:data": string
}
interface SearchObjectType {
  name: string
  description: string
  type: string
}
interface AdtSearchResult {
  uri: string
  type: string
  name: string
  packageName: string
  description: string
}

class MySearchResult implements QuickPickItem, AdtSearchResult {
  get label(): string {
    return `${this.name}(${this.description})`
  }
  public readonly uri: string
  public readonly type: string
  public readonly name: string
  public readonly packageName: string
  public readonly description: string
  get detail(): string | undefined {
    return `Package ${this.packageName} type ${this.type}`
  }
  picked: boolean = false
  constructor(r: SearchResult) {
    this.uri = r["adtcore:uri"]
    this.type = r["adtcore:type"]
    this.name = r["adtcore:name"]
    this.packageName = r["adtcore:packageName"]
    this.description = r["adtcore:description"]
  }
}

export class AdtObjectFinder {
  types?: Map<string, SearchObjectType>
  constructor(public readonly server: AdtServer) {}

  private async search(
    prefix: string,
    client: ADTClient,
    objType: string = ""
  ): Promise<MySearchResult[]> {
    const query = sapEscape(prefix.toUpperCase() + "*")
    const raw = await client.searchObject(query, objType)
    return raw.map(res => {
      return new MySearchResult(res)
    })
  }

  async findObjectPath(objPath: string) {
    return this.server.client.findObjectPath(objPath)
  }

  async locateObject(abapPath: PathStep[]) {
    if (abapPath.length === 0) return
    let children = [...abapPath]
    const name = abapPath[0]["adtcore:name"]
    if (name.match(/^\$/)) {
      if (name !== "$TMP")
        children.unshift({
          "adtcore:name": "$TMP",
          "adtcore:uri": "",
          "projectexplorer:category": "",
          "adtcore:type": "DEVC/K"
        })
    } else
      children.unshift({
        "adtcore:name": "",
        "adtcore:uri": "",
        "projectexplorer:category": "",
        "adtcore:type": "DEVC/K"
      })

    let nodePath: NodePath = { path: "", node: this.server.root }

    for (const part of children) {
      const name = part["adtcore:name"]
      const type = part["adtcore:type"]
      let child = findObjectInNode(nodePath.node, type, name)
      if (!child) {
        await this.server.refreshDirIfNeeded(nodePath.node)
        child = findObjectInNode(nodePath.node, type, name)
      }

      if (child)
        nodePath = { node: child.node, path: `${nodePath.path}/${child.path}` }
      else return
    }
    return nodePath
  }

  async displayNode(nodePath: NodePath) {
    let uri
    if (nodePath.node.isFolder) {
      if (
        isAbapNode(nodePath.node) &&
        nodePath.node.abapObject.type.match(/DEVC/i)
      ) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      await nodePath.node.refresh(this.server.client)
      const main = findMainInclude(nodePath)
      if (!main) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      uri = main.path
    } else uri = nodePath.path
    try {
      const doc = await workspace.openTextDocument(uri)
      await window.showTextDocument(doc)
      vscode.commands.executeCommand(
        "workbench.files.action.showActiveFileInExplorer"
      )
    } catch (e) {
      window.showErrorMessage(
        `Error displaying object ${nodePath.path}.Type not supported?`
      )
    }
  }

  async findObject(
    prompt: string = "Search an ABAP object",
    objType: string = ""
  ): Promise<MySearchResult | undefined> {
    const o = await new Promise<MySearchResult>(resolve => {
      const qp = window.createQuickPick()
      //TODO debounce? Looks like VSC does it for me!
      qp.onDidChangeValue(e => {
        if (e.length > 3)
          this.search(e, this.server.client, objType).then(
            res => (qp.items = res)
          )
      })
      qp.placeholder = prompt
      qp.onDidChangeSelection(e => {
        if (e[0]) {
          resolve(e[0] as MySearchResult)
          qp.hide()
        }
      })
      qp.onDidHide(() => qp.dispose())
      qp.show()
    })
    return o
  }
  async setTypes(source: string) {
    const parser = parseToPromise(
      getNode("nameditem:namedItemList/nameditem:namedItem", mapWith(recxml2js))
    )
    const raw = (await parser(source)) as AdtObjectType[]
    const types: SearchObjectType[] = raw
      .filter(o => o["nameditem:data"].match(/usedBy:.*quick_search/i))
      .map(o => {
        return {
          name: o["nameditem:name"],
          description: o["nameditem:description"],
          type: o["nameditem:data"].replace(/.*type:([^;]*).*/, "$1")
        }
      })

    this.types = ArrayToMap("type")(types)
  }
}
