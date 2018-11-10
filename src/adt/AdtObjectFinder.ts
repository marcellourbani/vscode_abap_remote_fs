import { parsetoPromise, getNode, recxml2js } from "./AdtParserBase"
import { mapWith, ArrayToMap, pipe, pick, removeNameSpace } from "../functions"
import { AdtConnection } from "./AdtConnection"
import { window, QuickPickItem } from "vscode"

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
  picked?: boolean | undefined
  constructor(r: AdtSearchResult) {
    this.uri = r.uri
    this.type = r.type
    this.name = r.name
    this.packageName = r.packageName
    this.description = r.description
  }
}

export class AdtObjectFinder {
  constructor(public readonly types: Map<string, SearchObjectType>) {}

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
    const results = (await parsetoPromise(
      getNode(
        "adtcore:objectReferences/adtcore:objectReference",
        mapWith(
          pipe(
            pick("$"),
            removeNameSpace,
            (x: AdtSearchResult) => new SearchResult(x)
          )
        )
      )
    )(response.body)) as SearchResult[]
    return results
  }

  async findObject(conn: AdtConnection) {
    const qp = window.createQuickPick()
    //TODO debounce
    qp.onDidChangeValue(e => {
      if (e.length > 3) this.search(e, conn).then(res => (qp.items = res))
    })
    qp.placeholder = "Search an ABAP object"
    qp.show()
    qp.onDidAccept
  }

  static async fromXML(source: string): Promise<AdtObjectFinder> {
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
    return new AdtObjectFinder(ArrayToMap("type")(types))
  }
}
