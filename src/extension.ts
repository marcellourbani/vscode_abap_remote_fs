"use strict"
import * as vscode from "vscode"
import { FsProvider } from "./fs/FsProvider"
import { getRemoteList, RemoteConfig } from "./config"
import { AdtConnection } from "./adt/AdtConnection"
import { window, Uri } from "vscode"
import { activeTextEditorChangedListener } from "./listeners"
import { fromUri } from "./adt/AdtServer"

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
async function activateCurrent(selector: Uri) {
  const server = fromUri(selector)
  const obj = await server.findAbapObject(selector)
  const conn = await server.connectionP
  obj.activate(conn)
}
async function connect(selector: any) {
  const connectionID = selector && selector.connection
  const remote = await selectRemote(connectionID)
  const connection = AdtConnection.fromRemote(remote)

  await connection.connect() // if connection raises an exception don't mount any folder

  vscode.workspace.updateWorkspaceFolders(0, 0, {
    uri: vscode.Uri.parse("adt://" + remote.name),
    name: remote.name + "(ABAP)"
  })
}

export function activate(context: vscode.ExtensionContext) {
  const abapFS = new FsProvider()
  //register the filesystem type
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("adt", abapFS, {
      isCaseSensitive: true
    })
  )

  //
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(activeTextEditorChangedListener)
  )

  //connect command
  let disposable = vscode.commands.registerCommand("abapfs.connect", connect)
  context.subscriptions.push(disposable)
  //activate command
  disposable = vscode.commands.registerCommand(
    "abapfs.activate",
    activateCurrent
  )
  context.subscriptions.push(disposable)
}

// this method is called when your extension is deactivated
export function deactivate() {}
