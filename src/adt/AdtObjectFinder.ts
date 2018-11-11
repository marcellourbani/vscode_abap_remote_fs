import {
  parsetoPromise,
  getNode,
  recxml2js,
  nodeProperties
} from "./AdtParserBase"
import { mapWith, ArrayToMap, pick } from "../functions"
import { AdtConnection } from "./AdtConnection"
import { window, QuickPickItem } from "vscode"
import { getServer } from "./AdtServer"
import { AbapNode, AbapObjectNode, isAbapNode } from "../fs/AbapNode"

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
interface NodePath {
  path: string
  node: AbapObjectNode
}

export class AdtObjectFinder {
  types?: Map<string, SearchObjectType>
  constructor(public readonly conn: AdtConnection) {}

  private async search(
    prefix: string,
    conn: AdtConnection
  ): Promise<SearchResult[]> {
    const query = encodeURIComponent(prefix + "*")
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

  async findObjectPath(o: SearchResult) {
    const uri = this.conn.createUri(
      "/sap/bc/adt/repository/nodepath",
      "uri=" + encodeURIComponent(o.uri)
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
    function findObject(
      folder: AbapNode,
      type: string,
      name: string
    ): NodePath | undefined {
      const children = [...folder]
      for (const [path, node] of children) {
        if (isAbapNode(node)) {
          const o = node.abapObject
          if (o.type === type && o.vsName === name) return { path, node }
        } else {
          const part = findObject(node, type, name)
          if (part) return { ...part, path: `${path}/${part.path}` }
        }
      }
    }
    if (abapPath.length === 0) return
    const server = getServer(this.conn.name)
    if (!server) return

    // start searching at the subpath
    let node = findObject(
      server.root,
      abapPath[0].type,
      abapPath[0].name.match(/^\$/) ? abapPath[0].name : ""
    )
    if (!node) return

    for (const part of abapPath.slice(1)) {
      let child = findObject(node.node, part.type, part.name)
      if (!child) {
        await node.node.refresh(this.conn)
        child = findObject(node.node, part.type, part.name)
      }

      if (child) node = { node: child.node, path: `${node.path}/${child.path}` }
      else return
    }
    return node
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
