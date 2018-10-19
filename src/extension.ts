"use strict"
import * as vscode from "vscode"
import { AbapFsProvider } from "./abapFsProvider"
import { getRemoteList } from "./config"
import { AdtConnectionManager } from "./adt/AdtConnectionManager"

function selectRemote() {
  const remotes = getRemoteList()
  return vscode.window
    .showQuickPick(
      remotes.map(remote => ({
        label: remote.name,
        description: remote.name,
        remote
      })),
      {
        placeHolder: "Please choose a remote"
      }
    )
    .then(selection => selection && selection.remote)
}

export function activate(context: vscode.ExtensionContext) {
  const abapFS = new AbapFsProvider()
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("adt", abapFS, {
      isCaseSensitive: true
    })
  )

  let disposable = vscode.commands.registerCommand("abapfs.connect", () => {
    selectRemote().then(remote => {
      return AdtConnectionManager.getManager()
        .setConn(remote)
        .then(() => {
          if (remote) {
            vscode.workspace.updateWorkspaceFolders(0, 0, {
              uri: vscode.Uri.parse("adt://" + remote.name + "/sap/bc/adt/"),
              name: "ABAP"
            })
          }
        })
    })
  })
  context.subscriptions.push(disposable)
}

// this method is called when your extension is deactivated
export function deactivate() {}
