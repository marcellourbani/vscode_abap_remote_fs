import { ADTClient, PathStep, SearchResult } from "abap-adt-api"
import { AdtServer } from "./../AdtServer"
import { window, QuickPickItem, workspace } from "vscode"
import * as vscode from "vscode"
import {
  NodePath,
  findObjectInNode,
  findMainInclude
} from "../abap/AbapObjectUtilities"
import { isAbapNode } from "../../fs/AbapNode"
import { sapEscape } from "../../functions"

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
  public picked: boolean = false
  constructor(r: SearchResult) {
    this.uri = r["adtcore:uri"]
    this.type = r["adtcore:type"]
    this.name = r["adtcore:name"]
    this.packageName = r["adtcore:packageName"]
    this.description = r["adtcore:description"]
  }
}

// tslint:disable-next-line:max-classes-per-file
export class AdtObjectFinder {
  public types?: Map<string, SearchObjectType>
  constructor(public readonly server: AdtServer) {}

  public async findObjectPath(objPath: string) {
    return this.server.client.findObjectPath(objPath)
  }

  public async locateObject(abapPath: PathStep[]) {
    if (abapPath.length === 0) return
    const children = [...abapPath]
    const firstName = abapPath[0]["adtcore:name"]
    if (firstName.match(/^\$/)) {
      if (firstName !== "$TMP")
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

  public async displayNode(nodePath: NodePath) {
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

  public async findObject(
    prompt: string = "Search an ABAP object",
    objType: string = ""
  ): Promise<MySearchResult | undefined> {
    const o = await new Promise<MySearchResult>(resolve => {
      const qp = window.createQuickPick()
      // TODO debounce? Looks like VSC does it for me!
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
}
