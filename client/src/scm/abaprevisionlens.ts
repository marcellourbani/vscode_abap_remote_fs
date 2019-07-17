import { ADTSCHEME, fromUri, getOrCreateServer } from "../adt/AdtServer"
import { command, AbapFsCommands } from "../commands"
import {
  CodeLensProvider,
  EventEmitter,
  TextDocument,
  CodeLens,
  Command,
  Range,
  Uri,
  window
} from "vscode"
import { AbapRevision, revLabel } from "./abaprevision"
import { uriName } from "../functions"
import { RemoteManager } from "../config"

export class AbapRevisionLensP implements CodeLensProvider {
  public static get() {
    if (!this.instance) this.instance = new AbapRevisionLensP()
    return this.instance
  }
  private static instance?: AbapRevisionLensP

  @command(AbapFsCommands.changequickdiff)
  private static async changeQD(document: TextDocument) {
    const uri = document.uri
    if (uri.scheme !== ADTSCHEME) return
    const revp = AbapRevision.get()
    const { revision } = await revp.selectRevision(
      uri,
      `Select version for ${uriName(uri)}`
    )
    if (revision) {
      revp.setReferenceRevision(uri, revision)
      AbapRevisionLensP.get().emitter.fire()
    }
  }

  @command(AbapFsCommands.remotediff)
  private static async remoteDiff(document: TextDocument) {
    const uri = document.uri
    if (uri.scheme !== ADTSCHEME) return
    try {
      const localServer = fromUri(uri)
      const obj = await localServer.findAbapObject(uri)
      const { remote, userCancel } = await RemoteManager.get().selectConnection(
        undefined,
        r => r.name.toLowerCase() !== uri.authority
      )
      if (!remote)
        if (userCancel) return
        else throw Error("No remote system available in configuration")

      const remoteServer = await getOrCreateServer(remote.name)
      if (!remoteServer)
        throw Error(`Faild to connect to server ${remote.name}`)

      const path = await remoteServer.objectFinder.objectNode(obj.path)
      if (!path) throw Error(`Object not found in remote ${remote.name}`)

      let remoteUri = uri.with({
        authority: remoteServer.connectionId,
        path: path.path
      })
      const revp = AbapRevision.get()
      await revp.addDocument(remoteUri)
      const {
        revision: leftRev,
        userCancel: leftcanc
      } = await revp.selectRevision(remoteUri, "Select version for left pane")
      if (leftcanc) return
      remoteUri = leftRev
        ? AbapRevision.revisionUri(leftRev, remoteUri)
        : remoteUri
      const {
        revision: rightRev,
        userCancel: rightcanc
      } = await revp.selectRevision(uri, "Select version for right pane")
      if (rightcanc) return
      const localUri = rightRev ? AbapRevision.revisionUri(rightRev, uri) : uri
      AbapRevision.displayRemoteDiff(localUri, rightRev, remoteUri, leftRev)
    } catch (e) {
      window.showErrorMessage(e.toString())
    }
  }

  @command(AbapFsCommands.comparediff)
  private static async compareDiff(document: TextDocument) {
    const uri = document.uri
    if (uri.scheme !== ADTSCHEME) return
    const revp = AbapRevision.get()
    const { revision: leftRev } = await revp.selectRevision(
      uri,
      "Select version for left pane"
    )
    if (!leftRev) return
    const { revision: rightRev } = await revp.selectRevision(
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
      command: AbapFsCommands.changequickdiff,
      title,
      arguments: [document]
    }
    const qdLens = new CodeLens(new Range(0, 0, 0, 0), changeQD)

    const compareDiff: Command = {
      command: AbapFsCommands.comparediff,
      title: "compare versions",
      arguments: [document]
    }
    const compareLens = new CodeLens(new Range(0, 0, 0, 0), compareDiff)

    const remoteDiff: Command = {
      command: AbapFsCommands.remotediff,
      title: "compare with remote",
      arguments: [document]
    }
    const remoteLens = new CodeLens(new Range(0, 0, 0, 0), remoteDiff)

    return [qdLens, compareLens, remoteLens]
  }
}
