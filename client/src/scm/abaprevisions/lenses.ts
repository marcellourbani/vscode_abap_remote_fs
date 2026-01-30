import {
  CodeLensProvider,
  TextDocument,
  EventEmitter,
  Uri,
  Range,
  CodeLens
} from "vscode"
import { abapUri } from "../../adt/conections"
import { AbapQuickDiff } from "./quickdiff"
import { AbapRevisionService, revLabel } from "./abaprevisionservice"
import { Revision } from "abap-adt-api"
import { AbapFsCommands } from "../../commands"

const currentQd = (uri: Uri, revisions: Revision[]) => {
  const qd = AbapQuickDiff.get()
  let current = qd.getCurrentRev(uri)
  if (!current) {
    current = revisions[0]
    qd.setCurrentRev(uri, current)
  }
  return current
}
const rng = new Range(0, 0, 0, 0)

export class AbapRevisionLens implements CodeLensProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapRevisionLens()
    return this.instance
  }
  get onDidChangeCodeLenses() {
    return this.emitter.event
  }
  public notify() {
    this.emitter.fire()
  }

  async provideCodeLenses(doc: TextDocument) {
    if (!abapUri(doc.uri)) return
    const revisions = await AbapRevisionService.get(
      doc.uri.authority
    ).uriRevisions(doc.uri, false)
    if (!revisions?.length) return
    const current = await currentQd(doc.uri, revisions)
    const title = `showing quickdiff with:${revLabel(current, "none selected")}`
    const quickDiff = new CodeLens(rng, {
      command: AbapFsCommands.changequickdiff,
      title,
      tooltip: current?.versionTitle,
      arguments: [doc.uri]
    })
    const compareDiff = new CodeLens(rng, {
      command: AbapFsCommands.comparediff,
      title: "compare versions",
      arguments: [doc.uri]
    })
    const remoteDiff = new CodeLens(rng, {
      command: AbapFsCommands.remotediff,
      title: "compare with remote",
      arguments: [doc.uri]
    })

    const merge = new CodeLens(rng, {
      command: AbapFsCommands.mergeEditor,
      title: "merge conflicts with remote",
      arguments: [doc.uri]
    })
    return [quickDiff, compareDiff, remoteDiff, merge]
  }
  private emitter = new EventEmitter<void>()
  private static instance?: AbapRevisionLens
}
