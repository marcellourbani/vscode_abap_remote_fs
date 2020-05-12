import {
  ExtensionContext,
  workspace,
  scm,
  QuickDiffProvider,
  Uri,
  CancellationToken,
  TextDocumentContentProvider,
  EventEmitter,
  SourceControl,
  SourceControlResourceGroup,
  commands,
  SourceControlResourceState,
  window,
  QuickPickItem
} from "vscode"
import { Revision, classIncludes, ADTClient } from "abap-adt-api"
import { command, AbapFsCommands } from "../commands"
import { log, parts } from "../lib"
import { FsProvider } from "../fs/FsProvider"
import { ADTURIPATTERN, ADTSCHEME, getRoot, getClient } from "../adt/conections"
import { isAbapClassInclude, isAbapClass, AbapObject } from "abapobject"
import { PathItem, isAbapStat } from "abapfs"
import { findAbapObject, createUri } from "../adt/operations/AdtObjectFinder"

const EXTREGEX = /(\.[^\/^\.]+)$/
const EMPTYFILE = "empty"

const ADTREVISION = "adt_revision"
const QUICKDIFFQUERY = "quickdiff=true"
const CURRENTREV = "current"

export const normalizeAbap = (source: string): string => {
  return source
    .split(/\n/)
    .map(line => {
      if (line.match(/^\*|^(\s*")/)) return line // whole comment
      // comments and strings will be left alone, the rest will be converted to lower case
      const stringsornot = line.split(/'/)
      for (const i in stringsornot) {
        if (Number(i) % 2) continue // string, nothing to do
        const part = stringsornot[i]
        const c = stringsornot[i].indexOf('"')
        if (c >= 0) {
          // comment
          stringsornot[i] = part.substr(0, c).toLowerCase() + part.substr(c)
          break
        } else stringsornot[i] = part.toLowerCase()
      }
      return stringsornot.join("'")
    })
    .join("\n")
}

interface RevisionState extends SourceControlResourceState {
  group: string
  mainRevision?: Revision
  refRevision?: Revision
  refMissing?: boolean
}

interface ConnRevision {
  sc: SourceControl
  groups: Map<string, SourceControlResourceGroup>
  files: Map<string, Revision[]>
}

interface RevQp extends QuickPickItem {
  revision: Revision
}

const revtoQP = (revision: Revision): RevQp => ({
  label: revision.version,
  description: revision.versionTitle,
  detail: `${revision.author || ""} ${revision.date}`,
  revision
})

export const revLabel = (rev: Revision | undefined, fallback: string) =>
  (rev && rev.version) || (rev && rev.date) || fallback

export class AbapRevision
  implements TextDocumentContentProvider, QuickDiffProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapRevision()
    return this.instance
  }

  public static revisionUri(
    revision: Revision | undefined,
    uri: Uri,
    normalize = false
  ) {
    const query = normalize ? "normalize=true" : ""
    if (!revision)
      return uri.with({
        scheme: ADTREVISION,
        authority: "",
        path: EMPTYFILE,
        query
      })
    const ext =
      (revision.uri.match(ADTURIPATTERN) && parts(uri.path, EXTREGEX)[0]) || ""
    return uri.with({
      scheme: ADTREVISION,
      path: revision.uri + ext,
      query
    })
  }

  public static displayRemoteDiff(
    localUri: Uri,
    localRev: Revision | undefined,
    remoteUri: Uri,
    remoteRev: Revision | undefined
  ) {
    const name = `${localUri.authority} ${revLabel(localRev, CURRENTREV)}->${
      remoteUri.authority
    } ${revLabel(remoteRev, CURRENTREV)}`

    return commands.executeCommand<void>(
      "vscode.diff",
      remoteUri,
      localUri,
      name
    )
  }

  public static async displayRevDiff(
    rightRev: Revision | undefined,
    leftRev: Revision | undefined,
    base: Uri,
    normalize = false
  ) {
    if (!leftRev && !rightRev) return
    const left = AbapRevision.revisionUri(leftRev, base, normalize)

    const right = AbapRevision.revisionUri(rightRev, base, normalize)
    const lvers = revLabel(leftRev, "initial")
    const rvers = revLabel(rightRev, CURRENTREV)
    const name =
      (base.path.split("/").pop() || base.toString()) + ` ${lvers}->${rvers}`
    return await commands.executeCommand<void>("vscode.diff", left, right, name)
  }

  public static async displayDiff(uri: Uri, selected?: Revision) {
    const left = AbapRevision.revisionUri(selected, uri)
    const right = uri
    const name =
      (uri.path.split("/").pop() || uri.toString()) +
      `${revLabel(selected, "previous")}->current`
    return await commands.executeCommand<void>("vscode.diff", left, right, name)
  }

  private static instance?: AbapRevision
  private emitter = new EventEmitter<Uri>()
  private conns = new Map<string, ConnRevision>()
  private QDRevision = new Map<string, Revision>()

  public get onDidChange() {
    return this.emitter.event
  }

  /**
   * Document provider implementation for scheme adt_revision, used for diffs
   *
   * @param {Uri} uri
   * @param {CancellationToken} token
   * @returns contents of the required version
   * @memberof AbapRevision
   */
  public async provideTextDocumentContent(uri: Uri, token?: CancellationToken) {
    if (uri.path === EMPTYFILE) return ""
    let revUri = uri
    if (uri.query === QUICKDIFFQUERY) {
      const revision = this.getReferenceRevision(
        uri.with({ query: "", scheme: ADTSCHEME })
      )
      if (revision) revUri = AbapRevision.revisionUri(revision, uri)
    }
    const client = getClient(uri.authority)
    const source: string = revUri.path.match(ADTURIPATTERN)
      ? await client.getObjectSource(revUri.path.replace(EXTREGEX, ""))
      : (
          await FsProvider.get().readFile(
            uri.with({ query: "", scheme: ADTSCHEME })
          )
        ).toString()
    if (uri.query === "normalize=true") return normalizeAbap(source)
    return source
  }

  public async objRevisions(obj: AbapObject, client: ADTClient) {
    if (!obj.structure) await obj.loadStructure()
    const [include, structure] = isAbapClassInclude(obj)
      ? [obj.techName as classIncludes, obj.parent.structure]
      : [undefined, obj.structure]
    if (!structure) return []
    return client.revisions(structure, include)
  }

  public addDocument = async (uri: Uri) => {
    if (uri.scheme !== ADTSCHEME) return
    if (this.find(uri)[0]) return
    const cur = uri.toString()
    const [conn, recent] = this.sourceGroup(uri.authority, "recent")
    if (!recent.resourceStates.find(s => s.resourceUri.toString() === cur)) {
      const client = getClient(uri.authority)
      const root = getRoot(uri.authority)
      if (!client) return
      try {
        const obj = await findAbapObject(uri)
        if (!obj) return
        const revisions = await this.objRevisions(obj, client)
        if (revisions.length > 1) this.addResource(conn, recent, uri, revisions)
      } catch (e) {
        log(e)
      }
    }
  }

  public findInGroup(uri: Uri, group: SourceControlResourceGroup) {
    const target = uri.toString()
    return group.resourceStates.find(
      s => s.resourceUri.toString() === target
    ) as RevisionState
  }

  public find(uri: Uri): [RevisionState?, SourceControlResourceGroup?] {
    const conn = this.conns.get(uri.authority)
    if (!conn) return []
    for (const g of conn.groups) {
      const found = this.findInGroup(uri, g[1])
      if (found) return [found, g[1]]
    }
    return []
  }

  public async addTransport(
    transport: string,
    connId: string,
    nodes: PathItem[],
    filter: RegExp
  ) {
    if (nodes.length === 0 || !filter) return
    const [conn, group] = this.sourceGroup(connId, transport)
    for (const node of nodes) {
      if (!isAbapStat(node.file)) continue
      const uri = createUri(connId, node.path)
      if (this.findInGroup(uri, group)) continue

      const obj = node.file.object
      const revisions = await this.objRevisions(obj, getClient(connId))
      this.addResource(conn, group, uri, revisions, filter)
    }
  }

  public setReferenceRevision(uri: Uri, current: Revision) {
    const key = this.qdKey(uri)
    const old = this.QDRevision.get(key)
    this.QDRevision.set(key.toString(), current)
    if (old) this.emitter.fire(AbapRevision.revisionUri(old, uri))
    this.emitter.fire(this.provideOriginalResource(uri))
  }

  public getReferenceRevision(uri: Uri) {
    let current = this.QDRevision.get(this.qdKey(uri))
    if (!current) {
      const conn = this.conns.get(uri.authority)
      if (conn) {
        const revisions = conn.files.get(uri.path)
        current = revisions && revisions[1]
        if (current) this.QDRevision.set(this.qdKey(uri), current)
      }
    }
    return current
  }

  /**
   * Provides relevant URI for quickdiff.
   * either the latest version with a transport ID different from the last or the next to last
   *
   * @param {Uri} uri
   * @param {CancellationToken} token
   * @returns
   * @memberof AbapRevision
   */
  public provideOriginalResource(uri: Uri, token?: CancellationToken) {
    const qrUri = uri.with({
      scheme: ADTREVISION,
      query: QUICKDIFFQUERY
    })
    return qrUri
  }

  @command(AbapFsCommands.clearScmGroup)
  public async clearScmGroup(group: SourceControlResourceGroup) {
    group.resourceStates = []
  }

  @command(AbapFsCommands.openrevstate)
  public async openCurrent(state: RevisionState) {
    const document = await workspace.openTextDocument(state.resourceUri)
    return window.showTextDocument(document, {
      preserveFocus: false,
      preview: false
    })
  }

  public async selectRevisionOrFail(
    uri: Uri,
    placeHolder: string,
    failMessage: string,
    older?: Revision
  ) {
    const { revision, userCancel } = await this.selectRevision(
      uri,
      placeHolder,
      older
    )
    if (!revision && !userCancel) throw Error(failMessage)
    return revision
  }

  public async selectRevision(uri: Uri, placeHolder: string, older?: Revision) {
    if (older) return { revision: older }
    const conn = this.conns.get(uri.authority)
    if (!conn) return {}
    const revisions = conn.files.get(uri.path)
    if (!revisions) return {}

    const sel = await window.showQuickPick(revisions.map(revtoQP), {
      placeHolder,
      ignoreFocusOut: true
    })
    return { revision: sel && sel.revision, userCancel: !sel }
  }

  @command(AbapFsCommands.opendiff)
  public async openDiff(state: RevisionState, select = true) {
    const uri = state.resourceUri
    const rev = AbapRevision.get()
    if (select) {
      const { revision, userCancel } = await rev.selectRevision(
        uri,
        "Select version",
        select ? undefined : state.refRevision
      )
      if (userCancel || !revision) return

      if (state.mainRevision)
        return AbapRevision.displayRevDiff(state.mainRevision, revision, uri)
      return AbapRevision.displayDiff(uri, revision)
    } else {
      if (state.mainRevision)
        return AbapRevision.displayRevDiff(
          state.mainRevision,
          state.refRevision,
          uri
        )
      return AbapRevision.displayDiff(uri, state.refRevision)
    }
  }

  private static currentRevision(uri: Uri): Revision {
    const client = getClient(uri.authority)

    return {
      uri: uri.path,
      date: Date(),
      author: client.username,
      version: CURRENTREV,
      versionTitle: CURRENTREV
    }
  }

  @command(AbapFsCommands.opendiffNormalized)
  public async openDiffNormalized(state: RevisionState) {
    const rightRev =
      state.mainRevision || AbapRevision.currentRevision(state.resourceUri)
    if (rightRev)
      AbapRevision.displayRevDiff(
        rightRev,
        state.refRevision,
        state.resourceUri,
        true
      )
  }

  private qdKey(uri: Uri) {
    return `${uri.authority}_${uri.path.replace(EXTREGEX, "")}`
  }

  private sourceGroup(connId: string, groupId: string) {
    let conn = this.conns.get(connId)
    if (!conn) {
      const id = `ABAP ${connId}`
      conn = {
        sc: scm.createSourceControl(id, id),
        groups: new Map(),
        files: new Map()
      }
      conn.sc.quickDiffProvider = this
      this.conns.set(connId, conn)
    }
    let group = conn.groups.get(groupId)
    if (!group) {
      group = conn.sc.createResourceGroup(groupId, groupId)
      group.hideWhenEmpty = true
      conn.groups.set(groupId, group)
    }
    return [conn, group] as [ConnRevision, SourceControlResourceGroup]
  }

  private addResource(
    conn: ConnRevision,
    group: SourceControlResourceGroup,
    uri: Uri,
    revisions: Revision[],
    filter?: RegExp
  ) {
    conn.files.set(uri.path, revisions)
    const state: RevisionState = {
      resourceUri: uri,
      group: group.id,
      command: {
        command: AbapFsCommands.opendiff,
        title: "View diff",
        arguments: []
      }
    }
    state.command!.arguments!.push(state, false)
    if (filter) {
      // for transports, I want to compare the latest revision in the transport with the latest out of it
      state.mainRevision = revisions.find(r => !!r.version.match(filter))
      if (!state.mainRevision) return
      const firstDate = Date.parse(state.mainRevision.date)
      state.refRevision = revisions.find(
        r =>
          !!r.version &&
          Date.parse(r.date) < firstDate &&
          !r.version.match(filter)
      )
      if (!state.refRevision) state.refMissing = true
    } else {
      // for non-transports compare the current with the latest
      if (revisions.length < 1) return
      state.refRevision = revisions[0]
    }

    group.resourceStates = [...group.resourceStates, state]
    this.emitter.fire(uri)
  }
}
export function registerRevisionModel(context: ExtensionContext) {
  const c = AbapRevision.get()
  workspace.registerTextDocumentContentProvider(ADTREVISION, c)
  context.subscriptions.push(
    workspace.onDidOpenTextDocument(doc => c.addDocument(doc.uri))
  )
}
