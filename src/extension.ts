"use strict"
import * as vscode from "vscode"
import { AbapFsProvider } from "./fs/AbapFsProvider"
import { getRemoteList, RemoteConfig } from "./config"
import { AdtConnectionManager } from "./adt/AdtConnectionManager"

function selectRemote(connection: string): Thenable<RemoteConfig> {
  const remotes = getRemoteList()
  if (!remotes) throw new Error("No ABAP system configured yet")
  if (remotes[1] && remotes[1].name === connection)
    return new Promise(resolve => resolve(remotes[1]))
  return vscode.window
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

export function activate(context: vscode.ExtensionContext) {
  const abapFS = new AbapFsProvider()
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("adt", abapFS, {
      isCaseSensitive: true
    })
  )

  let disposable = vscode.commands.registerCommand(
    "abapfs.connect",
    (selector: any) => {
      const connection = selector && selector.connection
      selectRemote(connection).then(remote => {
        return AdtConnectionManager.getManager()
          .setConn(remote)
          .then(() => {
            if (remote) {
              vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.parse("adt://" + remote.name),
                name: remote.name + "(ABAP)"
              })
            }
          })
      })
    }
  )
  context.subscriptions.push(disposable)
}

// this method is called when your extension is deactivated
export function deactivate() {}
