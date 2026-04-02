import * as vscode from "vscode"
import { registerNotebookSerializer } from "./abapNotebookSerializer"
import { AbapNotebookController } from "./abapNotebookController"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID } from "./types"
import { log } from "../lib"

let controller: AbapNotebookController | undefined

export function registerAbapNotebooks(context: vscode.ExtensionContext): void {
  log("📒 SAP Data Workbook initializing...")

  context.subscriptions.push(registerNotebookSerializer(context))

  controller = new AbapNotebookController()
  context.subscriptions.push({ dispose: () => controller?.dispose() })

  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.notebookChangeConnection", () => {
      const activeNotebook = vscode.window.activeNotebookEditor?.notebook
      const uri = activeNotebook?.uri?.toString()
      controller?.resetConnection(uri)
      vscode.window.showInformationMessage(
        "SAP Data Workbook connection reset. Next cell execution will prompt for a system."
      )
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.newAbapNotebook", async () => {
      await createNewNotebook()
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument(notebook => {
      if (notebook.notebookType === NOTEBOOK_TYPE) {
        controller?.clearResults(notebook.uri.toString())
      }
    })
  )

  log("📒 SAP Data Workbook ready — .sapwb files are now executable")
}

async function createNewNotebook(): Promise<void> {
  const data = new vscode.NotebookData([
    new vscode.NotebookCellData(
      vscode.NotebookCellKind.Markup,
      "# New SAP Data Workbook\n\nAdd SQL and JavaScript cells below.",
      "markdown"
    ),
    new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      "SELECT * FROM t000",
      SQL_LANGUAGE_ID
    )
  ])
  data.metadata = { version: 1, connectionId: "", title: "" }

  const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data)
  await vscode.window.showNotebookDocument(doc)
}
