import { ADTSCHEME, fromUri, getServer } from "./../adt/AdtServer"
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
  commands
} from "vscode"
import { Revision, classIncludes } from "abap-adt-api"
import { command } from "../commands"
import { parts } from "../functions"
import { isClassInclude } from "../adt/abap/AbapClassInclude"

const EXTREGEX = /(\.[^\/]+)$/

const ADTREVISION = "adt_revision"

interface ConnRevision {
  sc: SourceControl
  groups: Map<string, SourceControlResourceGroup>
}

// tslint:disable-next-line: max-classes-per-file
class AbapRevision implements TextDocumentContentProvider, QuickDiffProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapRevision()
    return this.instance
  }
  private static instance?: AbapRevision
  private emitter = new EventEmitter<Uri>()
  private conns = new Map<string, ConnRevision>()

  public get onDidChange() {
    return this.emitter.event
  }

  public async provideTextDocumentContent(uri: Uri, token: CancellationToken) {
    const server = getServer(uri.authority)
    const source = await server.client.getObjectSource(
      uri.path.replace(EXTREGEX, "")
    )
    return source
  }

  public addDocument = async (doc: TextDocument) => {
    const uri = doc.uri
    if (uri.scheme !== ADTSCHEME) return
    const cur = uri.toString()
    const recent = this.sourceGroup(uri.authority, "recent")
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
      if (revisions.length > 0)
        recent.resourceStates = [
          ...recent.resourceStates,
          {
            resourceUri: uri,
            command: {
              command: "abapfs.opendiff",
              title: "View diff",
              arguments: [uri, revisions]
            }
          }
        ]
    }
  }

  public provideOriginalResource?(uri: Uri, token: CancellationToken) {
    return uri
  }

  @command("abapfs.opendiff")
  public async openDiff(uri: Uri, revisions: Revision[]) {
    const old = revisions[revisions.length > 1 ? 1 : 0]
    const name = uri.path.split("/").pop() || uri.toString()
    const [ext] = parts(uri.path, EXTREGEX)
    const left = uri.with({ scheme: ADTREVISION, path: old.uri + (ext || "") })
    const right = uri
    return await commands.executeCommand<void>("vscode.diff", left, right, name)
  }

  private sourceGroup(connId: string, groupId: string) {
    let conn = this.conns.get(connId)
    if (!conn) {
      const id = `ABAP ${connId}`
      conn = {
        sc: scm.createSourceControl(id, id),
        groups: new Map()
      }
      this.conns.set(connId, conn)
    }
    let group = conn.groups.get(groupId)
    if (!group) {
      group = conn.sc.createResourceGroup("groupId", "groupId")
      conn.groups.set(groupId, group)
    }
    return group
  }
}
export function registerRevisionModel(context: ExtensionContext) {
  const c = AbapRevision.get()
  workspace.registerTextDocumentContentProvider(ADTREVISION, c)
  context.subscriptions.push(workspace.onDidOpenTextDocument(c.addDocument))
}
