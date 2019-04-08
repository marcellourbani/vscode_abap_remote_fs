import { ADTSCHEME, fromUri, getServer } from "../adt/AdtServer"
import { command } from "../commands"
import {
  CodeLensProvider,
  EventEmitter,
  TextDocument,
  CodeLens,
  Command,
  Range,
  Uri,
  window,
  workspace
} from "vscode"
import { AbapRevision, revLabel } from "./abaprevision"
import { selectRemote } from "../config"

export class AbapRevisionLensP implements CodeLensProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapRevisionLensP()
    return this.instance
  }
  private static instance?: AbapRevisionLensP

  @command("abapfs.changequickdiff")
  private static async changeQD(document: TextDocument) {
    const uri = document.uri
    if (uri.scheme !== ADTSCHEME) return
    const revp = AbapRevision.get()
    const revision = await revp.selectRevision(uri, "Select version")
    if (revision) {
      revp.setReferenceRevision(uri, revision)
      AbapRevisionLensP.get().emitter.fire()
    }
  }

  @command("abapfs.remotediff")
  private static async remoteDiff(document: TextDocument) {
    const uri = document.uri
    if (uri.scheme !== ADTSCHEME) return
    const localServer = fromUri(uri)
    if (!localServer) return
    const obj = await localServer.findAbapObject(uri)
    if (!obj) return
    const remote = await selectRemote(
      r => r.name.toLowerCase() !== uri.authority
    )
    if (!remote) return
    const remoteServer = getServer(remote.name)
    if (!remoteServer) return

    const path = await remoteServer.objectFinder.findObjectPath(obj.path)
    if (path.length === 0) return
    const nodePath = await remoteServer.objectFinder.locateObject(path)
    if (!nodePath) return

    let remoteUri = uri.with({
      authority: remoteServer.connectionId,
      path: nodePath.path
    })
    const revp = AbapRevision.get()
    await revp.addDocument(remoteUri)
    const leftRev = await revp.selectRevision(
      remoteUri,
      "Select version for left pane"
    )
    if (!leftRev) return
    remoteUri = AbapRevision.revisionUri(leftRev, remoteUri)
    const rightRev = await revp.selectRevision(
      uri,
      "Select version for right pane"
    )
    if (!rightRev) return
    const localUri = AbapRevision.revisionUri(rightRev, uri)
    AbapRevision.displayRemoteDiff(localUri, rightRev, remoteUri, leftRev)
  }

  @command("abapfs.comparediff")
  private static async compareDiff(document: TextDocument) {
    const uri = document.uri
    if (uri.scheme !== ADTSCHEME) return
    const revp = AbapRevision.get()
    const leftRev = await revp.selectRevision(
      uri,
      "Select version for left pane"
    )
    if (!leftRev) return
    const rightRev = await revp.selectRevision(
      uri,
      "Select version for right pane"
    )
    if (!rightRev) return
    AbapRevision.displayRevDiff(rightRev, leftRev, document.uri)
  }

  private emitter = new EventEmitter<void>()
  private constructor() {
    AbapRevision.get().onDidChange((uri: Uri) => {
      this.emitter.fire()
    })
  }

  public get onDidChangeCodeLenses() {
    return this.emitter.event
  }

  public async provideCodeLenses(document: TextDocument) {
    if (document.uri.scheme !== ADTSCHEME) return
    const revp = AbapRevision.get()
    const revision = revp.getReferenceRevision(document.uri)
    const title = `showing quickdiff with:${revLabel(
      revision,
      "none selected"
    )}`

    const changeQD: Command = {
      command: "abapfs.changequickdiff",
      title,
      arguments: [document]
    }
    const qdLens = new CodeLens(new Range(0, 0, 0, 0), changeQD)

    const compareDiff: Command = {
      command: "abapfs.comparediff",
      title: "compare versions",
      arguments: [document]
    }
    const compareLens = new CodeLens(new Range(0, 0, 0, 0), compareDiff)

    const remoteDiff: Command = {
      command: "abapfs.remotediff",
      title: "compare with remote",
      arguments: [document]
    }
    const remoteLens = new CodeLens(new Range(0, 0, 0, 0), remoteDiff)

    return [qdLens, compareLens, remoteLens]
  }
}
