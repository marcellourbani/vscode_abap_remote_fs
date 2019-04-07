import { ADTSCHEME, fromUri, getServer, AdtServer } from "./../adt/AdtServer"
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
  TextDocument,
  commands,
  SourceControlResourceState,
  window,
  QuickPickItem
} from "vscode"
import { Revision, classIncludes } from "abap-adt-api"
import { command } from "../commands"
import { parts, isDefined } from "../functions"
import { isClassInclude } from "../adt/abap/AbapClassInclude"
import { NodePath } from "../adt/abap/AbapObjectUtilities"
import { isAbapNode } from "../fs/AbapNode"
import { log } from "../logger"

const EXTREGEX = /(\.[^\/]+)$/
const EMPTYFILE = "empty"

const ADTREVISION = "adt_revision"

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

const revLabel = (rev: Revision | undefined, fallback: string) =>
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
  public async provideTextDocumentContent(uri: Uri, token: CancellationToken) {
    if (uri.path === EMPTYFILE) return ""
    const server = getServer(uri.authority)
    const source = await server.client.getObjectSource(
      uri.path.replace(EXTREGEX, "")
    )
    return source
  }

  public addDocument = async (doc: TextDocument) => {
    const uri = doc.uri
    if (uri.scheme !== ADTSCHEME) return
    if (this.find(uri)) return
    const cur = uri.toString()
    const [conn, recent] = this.sourceGroup(uri.authority, "recent")
    if (!recent.resourceStates.find(s => s.resourceUri.toString() === cur)) {
      const server = fromUri(uri)
      if (!server) return
      const obj = await server.findAbapObject(uri)
      if (!obj) return
      const include = isClassInclude(obj)
        ? (obj.techName as classIncludes)
        : undefined
      if (!obj.structure) await obj.loadMetadata(server.client)
      if (!obj.structure) return
      const revisions = await server.client.revisions(obj.structure, include)
      if (revisions.length > 1) this.addResource(conn, recent, uri, revisions)
    }
  }

  public findInGroup(uri: Uri, group: SourceControlResourceGroup) {
    const target = uri.toString()
    return group.resourceStates.find(s => s.resourceUri.toString() === target)
  }

  public find(uri: Uri) {
    const conn = this.conns.get(uri.authority)
    if (!conn) return
    for (const g of conn.groups) {
      const found = this.findInGroup(uri, g[1])
      if (found) return found
    }
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

  /**
   * Provides relevant URI for quickdiff.
   * either the latest version with a transport ID different from the last or the next to last
   *
   * @param {Uri} uri
   * @param {CancellationToken} token
   * @returns
   * @memberof AbapRevision
   */
  public provideOriginalResource(uri: Uri, token: CancellationToken) {
    const conn = this.conns.get(uri.authority)
    if (!conn) return
    const revisions = conn.files.get(uri.path)
    if (!revisions || !revisions[1]) return
    const revision =
      revisions.find(r => r.version !== revisions[0].version) || revisions[1]
    return AbapRevision.revisionUri(revision, uri)
  }

  @command("abapfs.clearScmGroup")
  public async clearScmGroup(group: SourceControlResourceGroup) {
    group.resourceStates = []
  }

  @command("abapfs.openrevstate")
  public async openCurrent(state: RevisionState) {
    const document = await workspace.openTextDocument(state.resourceUri)
    return window.showTextDocument(document, {
      preserveFocus: false
    })
  }

  @command("abapfs.opendiff")
  public async openDiff(state: RevisionState, older?: number) {
    const uri = state.resourceUri
    const rev = AbapRevision.get()
    const [conn] = rev.sourceGroup(uri.authority, state.group)
    const revisions = conn.files.get(uri.path)
    if (!revisions) return
    let selected
    if (older) selected = revisions[older]
    else {
      const sel = await window.showQuickPick(revisions.map(revtoQP))
      if (sel) selected = sel.revision
    }
    if (state.mainRevision && (selected || older))
      return AbapRevision.displayRevDiff(state.mainRevision, selected, uri)
    if (!selected) return
    return AbapRevision.displayDiff(uri, selected)
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
        command: "abapfs.opendiff",
        title: "View diff",
        arguments: []
      }
    }
    // for transports, I want to compare the latest revision in the transport with the latest out of it
    let first
    let last
    if (filter) {
      for (let r = 0; r < revisions.length; r++)
        if (revisions[r].version.match(filter)) first = first || r
        else if (isDefined(first)) {
          last = r
          break
        }
      if (!isDefined(first)) return
      if (!isDefined(last)) last = revisions.length
      state.mainRevision = revisions[first!]
    } else last = 1
    state.command!.arguments!.push(state, last)
    group.resourceStates = [...group.resourceStates, state]
  }
}
export function registerRevisionModel(context: ExtensionContext) {
  const c = AbapRevision.get()
  workspace.registerTextDocumentContentProvider(ADTREVISION, c)
  context.subscriptions.push(workspace.onDidOpenTextDocument(c.addDocument))
}
