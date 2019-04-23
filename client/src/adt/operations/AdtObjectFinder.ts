import { AbapObjectNode } from "../../fs/AbapNode"
import { PACKAGE } from "./AdtObjectCreator"
import { ADTClient, PathStep, SearchResult, ObjectType } from "abap-adt-api"
import { AdtServer } from "../AdtServer"
import { window, QuickPickItem, workspace, commands } from "vscode"

import {
  NodePath,
  findObjectInNode,
  findMainIncludeAsync,
  abapObjectFromNode,
  findObjByPathAsync
} from "../abap/AbapObjectUtilities"
import { isAbapNode } from "../../fs/AbapNode"
import { AbapObject } from "../abap/AbapObject"
import { urlFromPath } from "../../../server"

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

  public async objectNode(objUri: string, mainInclude = true) {
    const path = await this.server.objectFinder.findObjectPath(objUri)

    if (path.length) {
      let nPath = await this.server.objectFinder.locateObject(path)
      if (nPath && nPath.node.isFolder && mainInclude)
        nPath = await findMainIncludeAsync(nPath, this.server.client)
      return nPath
    }
  }

  public async vscodeUri(uri: string, mainInclude: boolean) {
    const path = await this.server.objectFinder.findObjectPath(uri)
    let s = ""

    if (path.length) {
      let nPath = await this.server.objectFinder.locateObject(path)
      if (nPath && nPath.node.isFolder && mainInclude)
        nPath = await findMainIncludeAsync(nPath, this.server.client)
      if (nPath) s = urlFromPath(this.server.connectionId, nPath.path)
    }
    return s
  }

  private async getRootNode(abapPath: PathStep[]): Promise<PathStep> {
    const firstName = abapPath[0]["adtcore:name"]
    const tmpStep: PathStep = {
      "adtcore:name": "",
      "adtcore:uri": "",
      "projectexplorer:category": "",
      "adtcore:type": PACKAGE
    }
    if (!firstName.match(/^\$/)) return tmpStep
    tmpStep["adtcore:name"] = "$TMP"
    if (firstName !== "$TMP") {
      // hack for local packages not marked as children of $TMP
      const tmp = findObjectInNode(this.server.root, PACKAGE, "$TMP")
      if (tmp) {
        let first = findObjectInNode(tmp.node, PACKAGE, "$TMP")
        if (!first) {
          await tmp.node.refresh(this.server.client)
          first = findObjectInNode(tmp.node, PACKAGE, "$TMP")
        }
        if (!first) {
          // package not in $TMP, should always be the case...
          const fn = abapPath[0]
          const obj: AbapObject = abapObjectFromNode({
            OBJECT_TYPE: fn["adtcore:type"],
            OBJECT_NAME: fn["adtcore:name"],
            TECH_NAME: fn["adtcore:name"],
            OBJECT_URI: fn["adtcore:uri"],
            OBJECT_VIT_URI: "",
            EXPANDABLE: "X"
          })
          tmp.node.setChild(obj.vsName, new AbapObjectNode(obj))
        }
      }
    }

    return tmpStep
  }
  public async locateObject(abapPath: PathStep[]) {
    if (abapPath.length === 0) return
    const children = [...abapPath]
    children.unshift(await this.getRootNode(abapPath))

    let nodePath: NodePath = { path: "", node: this.server.root }

    for (const part of children) {
      const name = part["adtcore:name"]
      const type = part["adtcore:type"]
      const uri = part["adtcore:uri"]

      let child = findObjectInNode(nodePath.node, type, name)
      if (!child)
        child = await findObjByPathAsync(nodePath.node, uri, this.server)
      if (!child) child = findObjectInNode(nodePath.node, type, name)

      if (child)
        nodePath = { node: child.node, path: `${nodePath.path}/${child.path}` }
      else return
    }
    const n = nodePath.node
    const l = abapPath[abapPath.length - 1]
    if (isAbapNode(n) && n.isFolder && n.abapObject.path !== l["adtcore:uri"]) {
      // might be looking for a child. Should only happen for classes and programs
      // so one level will be enough
      const child = await findObjByPathAsync(n, l["adtcore:uri"], this.server)
      if (child)
        nodePath = { node: child.node, path: `${nodePath.path}/${child.path}` }
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
      const main = await findMainIncludeAsync(nodePath, this.server.client)
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
