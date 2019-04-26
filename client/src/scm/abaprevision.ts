import { ADTSCHEME, fromUri, getServer, AdtServer } from "../adt/AdtServer"
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
import { Revision, classIncludes } from "abap-adt-api"
import { command, AbapFsCommands } from "../commands"
import { parts, isDefined } from "../functions"
import { isClassInclude } from "../adt/abap/AbapClassInclude"
import { NodePath } from "../adt/abap/AbapObjectUtilities"
import { isAbapNode } from "../fs/AbapNode"
import { isUndefined } from "util"
import { log } from "../logger"

const EXTREGEX = /(\.[^\/]+)$/
const EMPTYFILE = "empty"

const ADTREVISION = "adt_revision"
const QUICKDIFFQUERY = "quickdiff=true"

interface RevisionState extends SourceControlResourceState {
  group: string
  mainRevision?: Revision
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

  public static revisionUri(revision: Revision | undefined, uri: Uri) {
    if (!revision)
      return uri.with({
        scheme: ADTREVISION,
        authority: "",
        path: EMPTYFILE
      })
    const ext = parts(uri.path, EXTREGEX)[0] || ""
    return uri.with({
      scheme: ADTREVISION,
      path: revision.uri + ext
    })
  }

  public static displayRemoteDiff(
    localUri: Uri,
    localRev: Revision | undefined,
    remoteUri: Uri,
    remoteRev: Revision | undefined
  ) {
    const name = `${localUri.authority} ${revLabel(localRev, "current")}->${
      remoteUri.authority
    } ${revLabel(remoteRev, "current")}`

    return commands.executeCommand<void>(
      "vscode.diff",
      remoteUri,
      localUri,
      name
    )
  }

  public static async displayRevDiff(
    rightRev: Revision,
    levtRev: Revision | undefined,
    base: Uri
  ) {
    if (!levtRev && !rightRev) return
    const left = AbapRevision.revisionUri(levtRev, base)

    const right = AbapRevision.revisionUri(rightRev, base)
    const lvers = revLabel(levtRev, "initial")
    const rvers = revLabel(rightRev, "current")
    const name =
      (base.path.split("/").pop() || base.toString()) + ` ${lvers}->${rvers}`
    return await commands.executeCommand<void>("vscode.diff", left, right, name)
  }

  public static async displayDiff(uri: Uri, selected: Revision) {
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
   * Cocument provider implementation for scheme adt_revision, used for diffs
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
    const server = getServer(uri.authority)
    const source = await server.client.getObjectSource(
      revUri.path.replace(EXTREGEX, "")
    )
    return source
  }

  public addDocument = async (uri: Uri) => {
    if (uri.scheme !== ADTSCHEME) return
    if (this.find(uri)[0]) return
    const cur = uri.toString()
    const [conn, recent] = this.sourceGroup(uri.authority, "recent")
    if (!recent.resourceStates.find(s => s.resourceUri.toString() === cur)) {
      const server = fromUri(uri)
      if (!server) return
      try {
        const obj = await server.findAbapObject(uri)
        if (!obj) return
        const include = isClassInclude(obj)
          ? (obj.techName as classIncludes)
          : undefined
        if (!obj.structure) await obj.loadMetadata(server.client)
        if (!obj.structure) return
        const revisions = await server.client.revisions(obj.structure, include)
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
    server: AdtServer,
    nodes: NodePath[],
    filter: RegExp
  ) {
    if (nodes.length === 0 || !filter) return
    const [conn, group] = this.sourceGroup(server.connectionId, transport)
    for (const node of nodes) {
      if (!isAbapNode(node.node)) continue
      const uri = server.createUri(node.path)
      if (this.findInGroup(uri, group)) continue

      const obj = node.node.abapObject
      const include = isClassInclude(obj)
        ? (obj.techName as classIncludes)
        : undefined
      if (!obj.structure) await obj.loadMetadata(server.client)
      if (!obj.structure) continue
      const revisions = await server.client.revisions(obj.structure, include)
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
    older?: number
  ) {
    const { revision, userCancel } = await this.selectRevision(
      uri,
      placeHolder,
      older
    )
    if (!revision && !userCancel) throw Error(failMessage)
    return revision
  }

  public async selectRevision(uri: Uri, placeHolder: string, older?: number) {
    const conn = this.conns.get(uri.authority)
    if (!conn) return {}
    const revisions = conn.files.get(uri.path)
    if (!revisions) return {}
    if (!isUndefined(older)) return { revision: revisions[older] }

    const sel = await window.showQuickPick(revisions.map(revtoQP), {
      placeHolder
    })
    return { revision: sel && sel.revision, userCancel: !sel }
  }

  @command(AbapFsCommands.opendiff)
  public async openDiff(state: RevisionState, older?: number) {
    const uri = state.resourceUri
    const rev = AbapRevision.get()
    const { revision, userCancel } = await rev.selectRevision(
      uri,
      "Select version",
      older
    )

    if (state.mainRevision && (revision || older))
      return AbapRevision.displayRevDiff(state.mainRevision, revision, uri)
    if (!revision) return
    return AbapRevision.displayDiff(uri, revision)
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
    // for transports, I want to compare the latest revision in the transport with the latest out of it
    let first
    let last
    let firstDate: number
    if (filter) {
      for (let r = 0; r < revisions.length; r++) {
        const cur = revisions[r]
        if (cur.version.match(filter) && isUndefined(first)) {
          first = r
          firstDate = Date.parse(cur.date)
        } else if (isDefined(first) && Date.parse(cur.date) < firstDate!) {
          if (isUndefined(r) || cur.version) last = r
          if (cur.version) break
        }
      }
      if (!isDefined(first)) return
      if (!isDefined(last)) last = revisions.length
      state.mainRevision = revisions[first!]
    } else last = 1

    if (filter && isUndefined(first)) return // for transports, if object has no transport version don't add it
    state.command!.arguments!.push(state, last)
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
