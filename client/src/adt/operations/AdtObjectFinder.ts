import { PACKAGE } from "./AdtObjectCreator"
import { ADTClient, PathStep, SearchResult, ObjectType } from "abap-adt-api"
import { AdtServer } from "./../AdtServer"
import { window, QuickPickItem, workspace, commands } from "vscode"

import {
  NodePath,
  findObjectInNode,
  findMainInclude
} from "../abap/AbapObjectUtilities"
import { isAbapNode } from "../../fs/AbapNode"

interface SearchObjectType {
  name: string
  description: string
  type: string
}
interface AdtSearchResult {
  uri: string
  type: string
  name: string
  packageName?: string
  description?: string
}

export class MySearchResult implements QuickPickItem, AdtSearchResult {
  public static async createResults(
    results: SearchResult[],
    client: ADTClient
  ) {
    const myresults = results.map(r => new MySearchResult(r))
    if (myresults.find(r => !r.description)) {
      if (!this.types) this.types = await client.loadTypes()
      myresults
        .filter(r => !r.description)
        .forEach(r => {
          const typ = this.types.find(t => t.OBJECT_TYPE === r.type)
          r.description = typ ? typ.OBJECT_TYPE_LABEL : r.type
        })
    }
    myresults.forEach(typ => {
      if (!typ.packageName)
        typ.packageName = typ.type === PACKAGE ? typ.name : "unknown"
    })
    return myresults
  }
  private static types: ObjectType[]
  get label(): string {
    return `${this.name}(${this.description})`
  }
  public uri: string
  public type: string
  public name: string
  public packageName?: string
  public description?: string
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
      const doc = await workspace.openTextDocument(this.server.createUri(uri))
      await window.showTextDocument(doc)
      commands.executeCommand("workbench.files.action.showActiveFileInExplorer")
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
      qp.onDidChangeValue(async e => {
        if (e.length > 3)
          qp.items = await this.search(e, this.server.client, objType)
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
    const query = prefix.toUpperCase() + "*"
    const raw = await client.searchObject(query, objType)
    // object type is only honoured in part. PROG/P matches PROG/I too, and so on
    return await MySearchResult.createResults(
      raw.filter(r => !objType || objType === r["adtcore:type"]),
      client
    )
  }
}
