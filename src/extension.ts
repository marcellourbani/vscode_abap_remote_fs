"use strict"
import * as vscode from "vscode"
import { FsProvider } from "./fs/FsProvider"
import { window, commands, workspace } from "vscode"
import {
  activeTextEditorChangedListener,
  documentChangedListener,
  documentClosedListener
} from "./listeners"
import {
  connectAdtServer,
  activateCurrent,
  searchAdtObject,
  createAdtObject,
  executeAbap
} from "./commands"
import { disconnect } from "./adt/AdtServer"
import { log } from "./logger"

export function activate(context: vscode.ExtensionContext) {
  const abapFS = new FsProvider()
  const sub = context.subscriptions
  // register the filesystem type
  sub.push(
    vscode.workspace.registerFileSystemProvider("adt", abapFS, {
      isCaseSensitive: true
    })
  )

  // change document listener, for locking (and possibly validation in future)
  sub.push(workspace.onDidChangeTextDocument(documentChangedListener))
  // closed document listener, for locking
  sub.push(workspace.onDidCloseTextDocument(documentClosedListener))

  // Editor changed listener, updates context and icons
  sub.push(window.onDidChangeActiveTextEditor(activeTextEditorChangedListener))

  // connect command
  sub.push(commands.registerCommand("abapfs.connect", connectAdtServer))

  // activate command
  sub.push(commands.registerCommand("abapfs.activate", activateCurrent))

  // search command
  sub.push(commands.registerCommand("abapfs.search", searchAdtObject))

  // create command
  sub.push(commands.registerCommand("abapfs.create", createAdtObject))

  // execute Abap command
  sub.push(commands.registerCommand("abapfs.execute", executeAbap))

  log(`Activated,pid=${process.pid}`)
}

// this method is called when your extension is deactivated
// it's important to kill these sessions as there might be an open process on the abap side
// most commonly because of locked sources.
// Locks will not be released until either explicitly closed or the session is terminates
// an open session can leave sources locked without any UI able to release them (except SM12 and the like)
export async function deactivate() {
  await disconnect()
  log(`Deactivated,pid=${process.pid}`)
}
