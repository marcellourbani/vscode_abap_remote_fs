import {
  SourceControlResourceGroup,
  SourceControlResourceState,
  Uri,
  scm,
  SourceControl,
  EventEmitter,
  Command,
  ExtensionContext,
  workspace
} from "vscode"
import { cache } from "../../lib"
import { AbapRevisionService } from "./abaprevisionservice"
import { AbapFsCommands } from "../../commands"
import { PathItem, isAbapStat } from "abapfs"
import { createUri } from "../../adt/operations/AdtObjectFinder"
import { Revision } from "abap-adt-api"
import { AbapRevision, ADTREVISIONSCHEME } from "./documentprovider"
import { abapUri } from "../../adt/conections"
import { AbapQuickDiff } from "./quickdiff"
import { connectedRoots } from "../../config"

const RECENT = "recent"

export interface AState extends SourceControlResourceState {
  ascm: AbapScm
  command: Command
  groupId: string
  mainRevision: Revision
  refRevision?: Revision
}

export interface AGroup extends SourceControlResourceGroup {
  resourceStates: AState[]
}

const findState = (group: AGroup, uri: Uri) => {
  const urist = uri.toString()
  return group.resourceStates.find(s => s.resourceUri.toString() === urist)
}

const findMain = (revisions: Revision[], filter?: RegExp) =>
  revisions.find(r => (filter ? r.version.match(filter) : true))

export const toMs = (d: string) => new Date(d).getTime()
const findRef = (revisions: Revision[], filter?: RegExp) => {
  const main = findMain(revisions, filter)
  if (!main) return
  const mainDate = toMs(main.date)
  const match = (r: Revision) => !filter || r.version.match(filter)
  const before = (r: Revision) => toMs(r.date) < mainDate
  const valid = (r: Revision) => before(r) && !match(r)
  const wayBefore = (r: Revision) => mainDate - toMs(r.date) > 90000
  return revisions.filter(valid).reduce((sofar: Revision | undefined, next) => {
    if (!sofar) return next
    if (sofar.version && wayBefore(sofar)) return sofar
    if (wayBefore(next) && !wayBefore(sofar)) return next
    if (next.version && !sofar.version) return next
    return sofar
  }, undefined)
}

export class AbapScm {
  public static get(connId: string) {
    return this.scms.get(connId)
  }

  public get onDidChange() {
    return this.emitter.event
  }

  public async getGroup(label: string) {
    return this.groups.get(label)
  }

  public async addRecentDocument(uri: Uri) {
    const recent = this.groups.get(RECENT)
    const state = findState(recent, uri)
    if (state) return
    const revisions = await this.service.uriRevisions(uri, true)
    if (revisions?.length) {
      this.addResource(recent, uri, revisions)
    }
  }

  public async addTransport(
    transport: string,
    nodes: PathItem[],
    filter: RegExp
  ) {
    if (nodes.length === 0 || !filter) return
    const group = this.groups.get(transport)
    for (const node of nodes) {
      if (!isAbapStat(node.file)) continue
      const uri = createUri(this.connId, node.path)
      if (findState(group, uri)) continue

      const obj = node.file.object
      const revisions = await this.service.objRevisions(obj)
      this.addResource(group, uri, revisions, filter)
    }
  }

  private addResource(
    group: AGroup,
    uri: Uri,
    revisions: Revision[],
    filter?: RegExp
  ) {
    const mainRevision = findMain(revisions, filter)
    if (!mainRevision) return
    const refRevision = findRef(revisions, filter)
    const state: AState = {
      ascm: this,
      groupId: group.id,
      resourceUri: uri,
      mainRevision,
      refRevision,
      command: {
        command: AbapFsCommands.opendiff,
        title: "View diff"
      }
    }
    state.command.arguments = [state, false]

    group.resourceStates = [...group.resourceStates, state]
    this.emitter.fire(state.resourceUri)
  }

  private service: AbapRevisionService
  private sc: SourceControl
  private groups = cache((name: string) => {
    const group = this.sc.createResourceGroup(name, name)
    group.hideWhenEmpty = true
    return group as AGroup
  })
  private constructor(readonly connId: string) {
    this.service = AbapRevisionService.get(connId)
    const folder = connectedRoots().get(connId)?.uri
    const id = `ABAP ${connId}`
    this.sc = scm.createSourceControl(id, id, folder)
    this.sc.quickDiffProvider = AbapQuickDiff.get()
  }
  private static scms = cache((connId: string) => new AbapScm(connId))
  private emitter = new EventEmitter<Uri>()
}

export function registerRevisionModel(context: ExtensionContext) {
  const c = AbapRevision.get()
  workspace.registerTextDocumentContentProvider(ADTREVISIONSCHEME, c)
  context.subscriptions.push(
    workspace.onDidOpenTextDocument(
      doc =>
        abapUri(doc.uri) &&
        AbapScm.get(doc.uri.authority).addRecentDocument(doc.uri)
    )
  )
}
