import {
  parsetoPromise,
  getNode,
  recxml2js,
  nodeProperties
} from "./AdtParserBase"
import { mapWith, ArrayToMap, pick, sapEscape } from "../functions"
import { AdtConnection } from "./AdtConnection"
import { window, QuickPickItem, workspace } from "vscode"
import * as vscode from "vscode"
import { getServer } from "./AdtServer"
import {
  NodePath,
  findObjectInNode,
  findMainInclude
} from "../abap/AbapObjectUtilities"
import { isAbapNode } from "../fs/AbapNode"

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
interface AdtObjectPathNode {
  uri: string
  type: string
  name: string
  parentUri: string
  category: string
}
class SearchResult implements QuickPickItem, AdtSearchResult {
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
  constructor(r: AdtSearchResult) {
    this.uri = r.uri
    this.type = r.type
    this.name = r.name
    this.packageName = r.packageName
    this.description = r.description
  }
}

export class AdtObjectFinder {
  types?: Map<string, SearchObjectType>
  constructor(public readonly conn: AdtConnection) {}

  private async search(
    prefix: string,
    conn: AdtConnection
  ): Promise<SearchResult[]> {
    const query = sapEscape(prefix.toUpperCase() + "*")
    const uri = conn.createUri(
      "/sap/bc/adt/repository/informationsystem/search",
      `operation=quickSearch&query=${query}&maxResults=51`
    )
    const response = await conn.request(uri, "GET")
    const raw = await parsetoPromise()(response.body)
    const results = getNode(
      "adtcore:objectReferences/adtcore:objectReference",
      nodeProperties,
      mapWith((x: AdtSearchResult) => new SearchResult(x)),
      raw
    )
    return results
  }

  async findObjectPath(objPath: string) {
    const uri = this.conn.createUri(
      "/sap/bc/adt/repository/nodepath",
      "uri=" + encodeURIComponent(objPath)
    )
    const raw = await this.conn
      .request(uri, "POST")
      .then(pick("body"))
      .then(parsetoPromise())
    const objectPath = getNode(
      "projectexplorer:nodepath/projectexplorer:objectLinkReferences/objectLinkReference",
      nodeProperties,
      raw
    ) as AdtObjectPathNode[]

    return objectPath
  }

  async locateObject(abapPath: AdtObjectPathNode[]) {
    if (abapPath.length === 0) return
    const server = getServer(this.conn.name)
    if (!server) return
    let children = [...abapPath]
    if (abapPath[0].name.match(/^\$/)) {
      if (abapPath[0].name !== "$TMP")
        children.unshift({
          name: "$TMP",
          parentUri: "",
          uri: "",
          category: "",
          type: "DEVC/K"
        })
    } else
      children.unshift({
        name: "",
        parentUri: "",
        uri: "",
        category: "",
        type: "DEVC/K"
      })

    let nodePath: NodePath = { path: "", node: server.root }

    for (const part of children) {
      let child = findObjectInNode(nodePath.node, part.type, part.name)
      if (!child) {
        await nodePath.node.refresh(this.conn)
        child = findObjectInNode(nodePath.node, part.type, part.name)
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
      await nodePath.node.refresh(this.conn)
      const main = findMainInclude(nodePath)
      if (!main) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      uri = this.conn.createUri(main.path)
    } else uri = this.conn.createUri(nodePath.path)
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

  async findObject(): Promise<SearchResult | undefined> {
    const o = await new Promise<SearchResult>(resolve => {
      const qp = window.createQuickPick()
      //TODO debounce
      qp.onDidChangeValue(e => {
        if (e.length > 3)
          this.search(e, this.conn).then(res => (qp.items = res))
      })
      qp.placeholder = "Search an ABAP object"
      qp.onDidChangeSelection(e => {
        if (e[0]) {
          resolve(e[0] as SearchResult)
          qp.hide()
        }
      })
      qp.onDidHide(() => qp.dispose())
      qp.show()
    })
    return o
  }
  async setTypes(source: string) {
    const parser = parsetoPromise(
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
