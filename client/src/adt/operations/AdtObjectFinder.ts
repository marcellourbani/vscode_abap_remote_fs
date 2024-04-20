import { PACKAGE } from "./AdtObjectCreator"
import {
  ADTClient,
  CreatableTypeIds,
  FragmentLocation,
  ObjectType,
  SearchResult,
  UriParts
} from "abap-adt-api"
import {
  window,
  QuickPickItem,
  workspace,
  commands,
  Uri,
  FileStat,
  Range
} from "vscode"

import { splitAdtUri, vscPosition, log, caughtToString, promCache } from "../../lib"
import { getClient, getRoot, uriRoot } from "../conections"
import {
  PathItem,
  isFolder,
  isAbapFolder,
  isAbapFile,
  isAbapStat,
  Root,
  AbapFile,
  AbapStat
} from "abapfs"

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
  constructor(public readonly connId: string) { }
  private fragCache = promCache<FragmentLocation>()

  public async vscodeUriWithFile(uri: string, main = true) {
    const { path, file } = (await getRoot(this.connId).findByAdtUri(uri, main)) || {}
    if (!path) throw new Error(`can't find an URL for ${uri}`)
    const url = createUri(this.connId, path).toString()
    return { uri: url, file }
  }

  public async vscodeUri(uri: string, main = true) {
    const uf = await this.vscodeUriWithFile(uri, main)
    return uf.uri
  }

  public async vscodeObject(uri: string, main = true) {
    const { file } = await this.vscodeUriWithFile(uri, main)
    if (isAbapStat(file)) return file.object
  }

  public clearCaches() {
    this.fragCache = promCache()
  }

  public async vscodeRange(uri: string | UriParts, useFragCache = false) {
    const u = splitAdtUri(uri)
    const rval = { uri: "", start: u.start, file: undefined as AbapFile | undefined }
    if (u.type && u.name) {
      const getFrag = () => getClient(this.connId).fragmentMappings(u.path, u.type!, u.name!)
      const frag = await this.fragCache(`${u.path}_${u.type}_${u.name}`, getFrag, !useFragCache)
      const uf = await this.vscodeUriWithFile(frag.uri)
      rval.uri = uf.uri
      if (isAbapFile(uf.file)) rval.file = uf.file // should always be an abapfile at this point
      rval.start = vscPosition(frag.line + (u.start?.line || 0), frag.column)
    }
    else {
      const uf = await this.vscodeUriWithFile(u.path)
      if (isAbapFile(uf.file)) rval.file = uf.file // should always be an abapfile at this point
      rval.uri = uf.uri
    }
    return rval
  }

  public async vscodeUriFromAdt(adtUri: string) {
    const prefixRe = /adt:\/\/[^\/]+\/sap\/bc\/adt/
    if (adtUri.match(prefixRe)) {
      const base = adtUri.replace(prefixRe, "/sap/bc/adt")
      const { uri, start } = await this.vscodeRange(base)
      return { uri: Uri.parse(uri), start }
    } else {
      throw new Error(`Unexpected ADT URI format for ${adtUri}`)
    }

  }

  public async displayAdtUri(adtUri: string) {
    try {
      const { uri, start } = await this.vscodeUriFromAdt(adtUri) || {}
      if (uri && start) {
        const document = await workspace.openTextDocument(uri)
        const selection = start ? new Range(start, start) : undefined
        window.showTextDocument(document, { selection })
      }
    } catch (error) {
      window.showErrorMessage(`Failed to open document ofr object ${adtUri}:\n${caughtToString(error)}`)
    }
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

const findMainIncludeAsync = async (item: PathItem) => {
  if (isAbapFile(item.file)) return item
  if (isAbapFolder(item.file)) {
    const main = item.file.mainInclude(item.path)
    if (main) return main
    await item.file.refresh()
    return item.file.mainInclude(item.path)
  }
}

export function createUri(connId: string, path: string, query: string = "") {
  return Uri.parse("adt://" + connId).with({
    path,
    query
  })
}

export function findAbapObject(uri: Uri) {
  const file = uriRoot(uri).getNode(uri.path)
  if (isAbapStat(file)) return file.object
  throw new Error("Not an ABAP object")
}

export const uriAbapFile = (uri?: Uri): AbapStat | undefined => {
  try {
    if (!uri) return
    const root = uriRoot(uri)
    const file = root.getNode(uri.path)
    if (isAbapStat(file)) return file
  } catch (error) {
  }
}

export const pathSequence = (root: Root, uri: Uri | undefined): FileStat[] => {
  if (uri)
    try {
      const parts = uri.path.split("/")
      let path = ""
      const nodes: FileStat[] = []
      for (const part of parts) {
        const sep = path.substr(-1) === "/" ? "" : "/"
        path = `${path}${sep}${part}`
        const hit = root.getNode(path)
        if (!hit) log(`Incomplete path hierarchy for ${uri.path}`)
        else nodes.unshift(hit)
      }
      return nodes
    } catch (e) {
      // ignore
    }
  return []
}
