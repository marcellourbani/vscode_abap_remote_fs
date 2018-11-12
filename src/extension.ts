"use strict"
import * as vscode from "vscode"
import { FsProvider } from "./fs/FsProvider"
import { window, commands } from "vscode"
import { activeTextEditorChangedListener } from "./listeners"
import { connectAdtServer, activateCurrent, searchAdtObject } from "./commands"

export function activate(context: vscode.ExtensionContext) {
  const abapFS = new FsProvider()
  //register the filesystem type
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("adt", abapFS, {
      isCaseSensitive: true
    })
  )

  //Editor changed listener
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(activeTextEditorChangedListener)
  )

  //connect command
  let disposable = commands.registerCommand("abapfs.connect", connectAdtServer)
  context.subscriptions.push(disposable)
  //activate command
  disposable = commands.registerCommand("abapfs.activate", activateCurrent)
  context.subscriptions.push(disposable)
  //search command
  context.subscriptions.push(
    commands.registerCommand("abapfs.search", searchAdtObject)
  )
}

// this method is called when your extension is deactivated
export function deactivate() {}
