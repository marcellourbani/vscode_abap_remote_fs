import { AbapObjectNode } from "../../fs/AbapNode"
import { PACKAGE, TMPPACKAGE } from "./AdtObjectCreator"
import {
  ADTClient,
  PathStep,
  SearchResult,
  ObjectType,
  CreatableTypeIds
} from "abap-adt-api"
import {
  window,
  QuickPickItem,
  workspace,
  commands,
  Uri,
  Position
} from "vscode"

import { isAbapNode } from "../../fs/AbapNode"
import { AbapObject } from "abapobject"
import { urlFromPath } from "vscode-abap-remote-fs-sharedapi"
import { splitAdtUri, vscPosition, rememberFor } from "../../lib"
import { getClient, uriRoot, getRoot, createUri } from "../conections"
import { PathItem, isFolder, isAbapFolder, isAbapFile } from "abapfs"

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
  constructor(public readonly connId: string) {}

  public async vscodeUri(uri: string, main: boolean) {
    const { path } = (await getRoot(this.connId).findByAdtUri(uri, true)) || {}
    if (!path) throw new Error(`can't find an URL for ${uri}`)
    return path
  }
  public async vscodeRange(uri: string) {
    const u = splitAdtUri(uri)
    const rval = { uri: "", start: u.start }
    if (u.type && u.name) {
      const frag = await getClient(this.connId).fragmentMappings(
        u.path,
        u.type,
        u.name
      )
      rval.uri = await this.vscodeUri(frag.uri, true)
      rval.start = vscPosition(frag.line, frag.column)
    }
    rval.uri = await this.vscodeUri(u.path, true)
    return rval
  }

  public async displayNode(nodePath: PathItem) {
    let uri
    if (isFolder(nodePath.file)) {
      if (
        isAbapFolder(nodePath.file) &&
        nodePath.file.object.type.match(/DEVC/i)
      ) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      const main = await findMainIncludeAsync(nodePath)
      if (!main) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      uri = main.path
    } else uri = nodePath.path
    try {
      const doc = await workspace.openTextDocument(createUri(this.connId, uri))
      await window.showTextDocument(doc)
      commands.executeCommand("workbench.files.action.showActiveFileInExplorer")
    } catch (e) {
      window.showErrorMessage(
        `Error displaying object ${nodePath.path}.Type not supported?`
      )
    }
  }
  EPMTYPACKAGE = {
    "adtcore:uri": "",
    "adtcore:type": PACKAGE,
    "adtcore:name": "",
    "adtcore:packageName": "",
    "adtcore:description": "<NONE>"
  }
  public async findObject(
    prompt: string = "Search an ABAP object",
    objType: string = "",
    forType?: CreatableTypeIds
  ): Promise<MySearchResult | undefined> {
    const o = await new Promise<MySearchResult>(resolve => {
      const empty: MySearchResult[] = []
      if (forType === PACKAGE) empty.push(new MySearchResult(this.EPMTYPACKAGE))
      const qp = window.createQuickPick()
      qp.ignoreFocusOut = true
      const searchParent = async (e: string) => {
        qp.items =
          e.length >= 3
            ? await this.search(e, getClient(this.connId), objType)
            : empty
      }

      qp.items = empty
      qp.items = [...empty]
      // TODO debounce? Looks like VSC does it for me!
      qp.onDidChangeValue(async e => searchParent(e))
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

export const findMainIncludeAsync = async (item: PathItem) => {
  if (isAbapFile(item.file)) return item
  if (isAbapFolder(item.file)) {
    const main = item.file.mainInclude(item.path)
    if (main) return main
    await item.file.refresh()
    return item.file.mainInclude(item.path)
  }
}
