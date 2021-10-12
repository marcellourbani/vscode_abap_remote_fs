import { command, AbapFsCommands } from "../../commands"
import { Uri, QuickPickItem, window, commands, workspace } from "vscode"
import { abapUri, uriRoot, getOrCreateRoot } from "../../adt/conections"
import { AbapRevisionService, revLabel } from "./abaprevisionservice"
import { Revision } from "abap-adt-api"
import { AbapQuickDiff } from "./quickdiff"
import { revisionUri } from "./documentprovider"
import { RemoteManager, formatKey } from "../../config"
import { isAbapFile } from "abapfs"
import { AGroup, AState } from "./abapscm"
import { caughtToString } from "../../lib"

interface RevisionItem extends QuickPickItem {
  label: string
  revision: Revision
}
const revItems = (revisions: Revision[]): RevisionItem[] =>
  revisions.map((r, i) => ({
    label: revLabel(r, `revision ${i}`),
    description: r.versionTitle,
    detail: `${r.author || ""} ${r.date}`,
    revision: r
  }))

const selectRevision = async (
  uri: Uri,
  title = "Select version",
  withRefresh = true
) => {
  const service = AbapRevisionService.get(uri.authority)
  const revisions = await service.uriRevisions(uri, false)
  if (!revisions?.length) return
  if (revisions.length === 1) return revisions[0]
  const selected = await window.showQuickPick(revItems(revisions), {
    placeHolder: title
  })
  return selected?.revision || false
}
const CURRENTREV = "current"

const diffTitle = (uri: Uri, lvers: string, rvers: string) =>
  `${uri.path.split("/").pop() || uri.toString()} ${lvers}->${rvers}`

export const displayRevDiff = (
  rightRev: Revision | undefined,
  leftRev: Revision | undefined,
  uri: Uri,
  normalize = false
) => {
  const left = revisionUri(uri, leftRev, normalize)
  const right = revisionUri(uri, rightRev, normalize)
  const lvers = revLabel(leftRev, "initial")
  const rvers = revLabel(rightRev, CURRENTREV)
  const name = diffTitle(uri, lvers, rvers)
  return commands.executeCommand<void>("vscode.diff", left, right, name)
}

export class AbapRevisionCommands {
  @command(AbapFsCommands.changequickdiff)
  private static async changeQuickDiff(uri: Uri) {
    if (!abapUri(uri)) return
    const selected = await selectRevision(uri)
    if (!selected) return
    const qd = AbapQuickDiff.get()
    qd.setCurrentRev(uri, selected)
  }

  @command(AbapFsCommands.remotediff)
  private static async remoteDiff(uri: Uri) {
    if (!abapUri(uri)) return
    try {
      const file = uriRoot(uri).getNode(uri.path)
      if (!isAbapFile(file)) return
      const { remote, userCancel } = await RemoteManager.get().selectConnection(
        undefined,
        r => r.name.toLowerCase() !== uri.authority
      )
      if (!remote)
        if (userCancel) return
        else throw Error("No remote system available in configuration")

      const remoteRoot = await getOrCreateRoot(formatKey(remote.name))
      if (!remoteRoot) throw Error(`Faild to connect to server ${remote.name}`)

      const path = await remoteRoot.findByAdtUri(file.object.path)
      if (!path) throw Error(`Object not found in remote ${remote.name}`)

      const remoteUri = uri.with({
        authority: remoteRoot.connId,
        path: path.path
      })

      const remoteVer = await selectRevision(remoteUri, "Remote version")
      if (remoteVer === false) return
      const localVer = await selectRevision(uri, "Local version")
      if (localVer === false) return

      const text = diffTitle(uri, uri.authority, remoteUri.authority)
      return commands.executeCommand<void>(
        "vscode.diff",
        revisionUri(uri, localVer),
        revisionUri(remoteUri, remoteVer),
        text
      )
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.comparediff)
  private static async compareDiff(uri: Uri) {
    if (!abapUri(uri)) return
    const leftRev = await selectRevision(uri, "Select version for left pane")
    if (!leftRev) return
    const rightRev = await selectRevision(uri, "Select version for right pane")
    if (!rightRev) return
    displayRevDiff(rightRev, leftRev, uri)
  }
  @command(AbapFsCommands.clearScmGroup)
  private static clearGroup(group: AGroup) {
    group.resourceStates = []
  }
  @command(AbapFsCommands.opendiff)
  private static async openDiff(state: AState, select = true) {
    const uri = state.resourceUri
    if (select) {
      const revision = await selectRevision(uri, "Select version")
      if (!revision) return
      return displayRevDiff(state.mainRevision, revision, uri)
    } else return displayRevDiff(state.mainRevision, state.refRevision, uri)
  }

  @command(AbapFsCommands.opendiffNormalized)
  private static openDiffNormalized(state: AState) {
    return displayRevDiff(
      state.mainRevision,
      state.refRevision,
      state.resourceUri,
      true
    )
  }

  @command(AbapFsCommands.openrevstate)
  private static async openState(state: AState) {
    const document = await workspace.openTextDocument(state.resourceUri)
    return window.showTextDocument(document, {
      preserveFocus: false,
      preview: false
    })
  }
}
