import * as vscode from "vscode"
import * as path from "path"
import { ReplPanel } from "./replPanel"
import { log } from "../lib"

export function registerAbapRepl(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.executeAbapCode", () => {
      ReplPanel.create(context.extensionUri)
    }),
    vscode.commands.registerCommand("abapfs.abapReplSetupGuide", () => {
      const uri = vscode.Uri.file(
        path.join(context.extensionUri.fsPath, "client", "dist", "media", "REPL_SETUP_GUIDE.md")
      )
      vscode.commands.executeCommand("markdown.showPreview", uri)
    })
  )
  log("ABAP REPL commands registered")
}
