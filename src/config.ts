import * as vscode from "vscode"
import { window, workspace, QuickPickItem, WorkspaceFolder } from "vscode"
export interface RemoteConfig {
  name: string
  url: string
  username: string
  password: string
}

const config = (name: string, remote: RemoteConfig) => {
  const conf = { url: "", ...remote, name, valid: true }
  conf.valid = !!(remote.url && remote.username && remote.password)
  return conf
}

export function getRemoteList(): RemoteConfig[] {
  const userConfig = vscode.workspace.getConfiguration("abapfs")
  const remote = userConfig.remote
  if (!remote) throw new Error("No destination configured")
  return Object.keys(remote).map(name =>
    config(name, remote[name] as RemoteConfig)
  )
}
export function selectRemote(connection: string): Thenable<RemoteConfig> {
  const remotes = getRemoteList()
  if (!remotes) throw new Error("No ABAP system configured yet")
  if (remotes[1] && remotes[1].name === connection)
    return new Promise(resolve => resolve(remotes[1]))
  return window
    .showQuickPick(
      remotes.map(remote => ({
        label: remote.name,
        description: remote.name,
        remote
      })),
      {
        placeHolder: "Please choose an ABAP system"
      }
    )
    .then(selection => {
      if (selection) return selection.remote
      throw new Error("No connection selected")
    })
}

interface RootItem extends QuickPickItem {
  root: WorkspaceFolder
}
export async function pickAdtRoot() {
  const roots = (
    (workspace.workspaceFolders && workspace.workspaceFolders) ||
    []
  ).filter(r => r.uri.scheme === "adt")
  if (roots.length === 0)
    throw new Error("No ABAP filesystem mounted in current workspace")

  if (roots.length === 1) return roots[0] //no need to pick if only one root is mounted

  const item = await window.showQuickPick(
    roots.map(root => <RootItem>{ label: root.name, root })
  )
  if (item) return item.root
}
