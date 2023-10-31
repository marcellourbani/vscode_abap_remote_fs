import { command, AbapFsCommands } from "../../commands"
import { Uri, QuickPickItem, window, commands, workspace, ProgressLocation } from "vscode"
import { abapUri, uriRoot, getOrCreateRoot, getClient } from "../../adt/conections"
import { AbapRevisionService, revLabel } from "./abaprevisionservice"
import { ADTClient, Revision } from "abap-adt-api"
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

const loadRevisions = async (uri: Uri, withRefresh = true) => {
  const service = AbapRevisionService.get(uri.authority)
  const revisions = await service.uriRevisions(uri, withRefresh)
  return revisions || []
}

const pickRevision = async (revisions: Revision[], title = "Select version") => {
  if (!revisions.length) return
  if (revisions.length === 1) return revisions[0]
  const selected = await window.showQuickPick(revItems(revisions), { placeHolder: title })
  return selected?.revision || false
}

const selectRevision = async (
  uri: Uri,
  title = "Select version",
  withRefresh = true
) => {
  const revisions = await loadRevisions(uri, withRefresh)
  return pickRevision(revisions, title)
}
const CURRENTREV = "current"

const diffTitle = (uri: Uri, lvers: string, rvers: string) =>
  `${uri.path.split("/").pop() || uri.toString()} ${lvers}->${rvers}`

const pickCommonAncestor = (locals: Revision[], localVer: Revision, remotes: Revision[], remoteVer: Revision) => {
  const localTime = new Date(localVer.date).getTime()
  const possibleLocals = locals.filter(l => new Date(l.date).getTime() < localTime)
  const remoteTime = new Date(remoteVer.date).getTime()
  const possibleRemotes = remotes.filter(l => new Date(l.date).getTime() < remoteTime)
  for (const l of possibleLocals)
    if (possibleRemotes.find(r => r.version && r.version === l.version)) return l
  return pickRevision(possibleLocals, "Unable to determine common ancestor, please select base for comparison")
}

const wasChanged = async (client: ADTClient, state: AState): Promise<boolean> => {
  try {
    if (!state.refRevision) return false
    const ref = await client.getObjectSource(state.refRevision.uri)
    const rev = await client.getObjectSource(state.mainRevision.uri)
    if (ref !== rev) return true
  } catch (error) {
    return true // safer to assume it was changed
  }
  return false
}

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

  @command(AbapFsCommands.mergeEditor)
  private static async mergeConflicts(uri: Uri) {
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

      const remoteUri = uri.with({ authority: remoteRoot.connId, path: path.path })

      const remotes = await loadRevisions(remoteUri, true)
      const remoteVer = await pickRevision(remotes, "Remote version")
      if (!remoteVer) return
      const locals = await loadRevisions(uri, true)
      const localVer = await pickRevision(locals, "Local version")
      if (!localVer) return
      const baseVer = await pickCommonAncestor(locals, localVer, remotes, remoteVer)
      if (!baseVer) return
      const base = revisionUri(uri, baseVer)

      const description = uri.path.replace(/.*\//, "")

      const options = {
        base,
        input1: { uri: revisionUri(uri, localVer), title: uri.authority, description, detail: localVer.version },
        input2: { uri: revisionUri(remoteUri, remoteVer), title: remoteUri.authority, description, detail: remoteVer.version },
        output: uri
      }
      return commands.executeCommand<void>("_open.mergeEditor", options)
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }
  @command(AbapFsCommands.clearScmGroup)
  private static clearGroup(group: AGroup) {
    group.resourceStates = []
  }
  @command(AbapFsCommands.filterScmGroup)
  private static filterGroup(group: AGroup) {
    window.withProgress({ location: ProgressLocation.Notification, cancellable: true, title: "checking diffs" }, async (prog, tok) => {
      const nextState: AState[] = []
      const unchanged: AState[] = []
      let count = 0
      const scm = group.resourceStates[0]?.ascm
      if (!scm) return
      const client = getClient(scm.connId)
      for (const s of group.resourceStates) {
        if (tok.isCancellationRequested) return
        const increment = count * 100 / group.resourceStates.length
        const message = s.resourceUri.path.replace(/.*\//, "")
        prog.report({ message, increment })
        const found = await wasChanged(client, s)
        if (found) nextState.push(s)
        else unchanged.push(s)
        count++
      }

      group.resourceStates = nextState
      if (unchanged.length) {
        const label = `unchanged ${group.label}`
        const ugroup = await scm.getGroup(label)
        const toAdd = unchanged.filter(s => !ugroup.resourceStates.includes(s))
        ugroup.resourceStates = [...ugroup.resourceStates, ...toAdd]
      }

    })
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

