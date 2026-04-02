import * as vscode from "vscode"
import { ReplPanel } from "./replPanel"
import { log } from "../lib"

export function registerAbapRepl(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.executeAbapCode", () => {
      ReplPanel.create(context.extensionUri)
    })
  )
  log("ABAP REPL command registered (abapfs.executeAbapCode)")
}
