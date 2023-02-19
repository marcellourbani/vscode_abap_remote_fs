import { AbapFsCommands, command, openObject } from "../commands"
import {
  TextDocument,
  Position,
  CancellationToken,
  CodeLensProvider,
  CodeLens,
  Range,
  Uri,
  EventEmitter,
  window,
  QuickPickItem,
  ProgressLocation
} from "vscode"
import { asyncCache, cache } from "../lib"
import { ADTClient } from "abap-adt-api"
import { getClient, ADTSCHEME } from "./conections"
import { findAbapObject } from "./operations/AdtObjectFinder"

const ok = (type: string, name: string) =>
  `${type.toUpperCase()} ${name.toUpperCase()}`

interface CallParams {
  url: string
  body: string
  position: Position
}

interface RefreshParams {
  connId: string
  key: string
  parents: boolean
}

interface PickParams {
  conn: string
  key: string
  parents: boolean
}

interface Hit {
  url: string
  position: Position
}
interface ClassRelative extends QuickPickItem {
  name: string
  type: string
  uri: string
}
function hierCache(client: ADTClient) {
  const lastSeen = new Map<string, Hit>()
  const bodies = new Map<string, string>()

  const getHier = (up: boolean) => async (obk: string) => {
    const hit = lastSeen.get(obk)
    if (!hit) return
    const body = bodies.get(hit.url)
    if (!body) return
    const hier = await client.typeHierarchy(
      hit.url,
      body,
      hit.position.line + 1,
      hit.position.character,
      up
    )
    return hier.filter(h => h.name !== obk.split(/\s/)[1])
  }
  const parents = asyncCache(getHier(true))
  const children = asyncCache(getHier(false))
  const caches = { parents, children }

  return (key: string, parms?: CallParams) => {
    if (parms) {
      lastSeen.set(key, { url: parms.url, position: parms.position })
      bodies.set(parms.url, parms.body)
    }
    return {
      parents: caches.parents.getSync(key) || [],
      children: caches.children.getSync(key) || [],
      refreshParents: caches.parents.get,
      refreshChildren: caches.children.get
    }
  }
}

const CLASSREGEX = /^\s*((?:class)|(?:interface))\s+((?:\/\w+\/)?\w+)/i
const refreshHier = (
  uri: Uri,
  key: string,
  title: string,
  parents = false
) => ({
  command: AbapFsCommands.refreshHierarchy,
  title,
  arguments: [
    {
      connId: uri.authority,
      key,
      parents
    }
  ]
})

const pickObj = (conn: string, key: string, title: string, parents = false) => {
  const argument: PickParams = { conn, key, parents }

  return {
    command: AbapFsCommands.pickObject,
    title,
    arguments: [argument]
  }
}

export class ClassHierarchyLensProvider implements CodeLensProvider {
  private static emitter = new EventEmitter<void>()
  public get onDidChangeCodeLenses() {
    return ClassHierarchyLensProvider.emitter.event
  }
  private static instance: ClassHierarchyLensProvider
  public static get() {
    if (!this.instance) this.instance = new ClassHierarchyLensProvider()
    return this.instance
  }
  private static caches = cache((connId: string) =>
    hierCache(getClient(connId))
  )
  public async provideCodeLenses(doc: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
    const lenses: CodeLens[] = []
    if (doc.uri.scheme !== ADTSCHEME) return lenses
    const client = getClient(doc.uri.authority)
    const obj = await findAbapObject(doc.uri)
    if (!obj) return lenses
    // TODO stat?
    if (!obj.structure) await obj.loadStructure()
    const doccache = ClassHierarchyLensProvider.caches.get(doc.uri.authority)

    const lines = doc.getText().toString().split("\n")

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]?.replace(/".*/, "")
      const match = line?.match(CLASSREGEX)
      if (!match) continue
      const [type, name = ""] = match.slice(1)
      if (!type) continue
      const char = match[0].indexOf(name)
      const position = new Position(idx, char)
      const endpos = new Position(idx, char + name.length)
      const key = ok(type, name)

      const { parents, children } = doccache(key, {
        url: obj.contentsPath(),
        body: doc.getText().toString(),
        position
      })

      if (type.toUpperCase() === "CLASS") {
        if (parents.length)
          lenses.push(
            new CodeLens(
              new Range(position, endpos),
              pickObj(doc.uri.authority, key, "Select Parent", true)
            )
          )

        lenses.push(
          new CodeLens(
            new Range(position, endpos),
            refreshHier(doc.uri, key, "Refresh Parents", true)
          )
        )
      }
      if (children.length)
        lenses.push(
          new CodeLens(
            new Range(position, endpos),
            pickObj(doc.uri.authority, key, "Select Child")
          )
        )
      lenses.push(
        new CodeLens(
          new Range(position, endpos),
          refreshHier(doc.uri, key, "Refresh Children")
        )
      )
    }

    return lenses
  }
  @command(AbapFsCommands.pickObject)
  private static async pickObject(pp: PickParams) {
    const oc = ClassHierarchyLensProvider.caches.get(pp.conn)(pp.key)
    const list = (pp.parents ? oc.parents : oc.children).map(c => {
      const i: ClassRelative = {
        type: c.type,
        name: c.name,
        uri: c.uri,
        description: c.description,
        detail: `${c.type.replace(/\/.*/, "")} ${c.name}`,
        label: c.name
      }
      return i
    })

    const relative = await window.showQuickPick(list, { ignoreFocusOut: true })
    if (relative) await openObject(pp.conn, relative.uri)
  }

  @command(AbapFsCommands.refreshHierarchy)
  private static refreshHier(p: RefreshParams) {
    const targ = p.parents ? "parent" : "child"
    const title = `Loading ${targ} classes...`
    window.withProgress(
      { location: ProgressLocation.Window, title },
      async () => {
        const ocache = ClassHierarchyLensProvider.caches.get(p.connId)(p.key)
        const result = await (p.parents
          ? ocache.refreshParents(p.key, true)
          : ocache.refreshChildren(p.key, true))
        if (!result || !result.length)
          window.showInformationMessage(`No ${targ} found`)
        ClassHierarchyLensProvider.emitter.fire()
      }
    )
  }
}
