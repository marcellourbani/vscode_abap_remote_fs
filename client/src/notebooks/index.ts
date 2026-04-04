import * as vscode from "vscode"
import { registerNotebookSerializer } from "./abapNotebookSerializer"
import { AbapNotebookController } from "./abapNotebookController"
import { registerCellStatusBar } from "./cellStatusBar"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID } from "./types"
import { log } from "../lib"

let controller: AbapNotebookController | undefined

export function registerAbapNotebooks(context: vscode.ExtensionContext): void {
  log.debug("📒 SAP Data Workbook initializing...")

  context.subscriptions.push(registerNotebookSerializer(context))

  controller = new AbapNotebookController()
  context.subscriptions.push({ dispose: () => controller?.dispose() })

  registerCellStatusBar(context)

  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.newAbapNotebook", async () => {
      await createNewNotebook()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.notebookClearConnection", () => {
      const notebook = vscode.window.activeNotebookEditor?.notebook
      if (notebook && notebook.notebookType === NOTEBOOK_TYPE) {
        controller?.clearCachedConnection(notebook.uri.toString())
        vscode.window.showInformationMessage(
          "SAP connection cleared. Next cell execution will prompt for a system."
        )
      }
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidOpenNotebookDocument(notebook => {
      if (notebook.notebookType !== NOTEBOOK_TYPE) return
      log.debug(`📒 [Index] onDidOpenNotebookDocument: ${notebook.uri.toString()}`)
      controller?.clearCachedConnection(notebook.uri.toString())
      correctSqlLanguages(notebook)
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument(notebook => {
      if (notebook.notebookType !== NOTEBOOK_TYPE) return
      log.debug(`📒 [Index] onDidCloseNotebookDocument: ${notebook.uri.toString()}`)
      controller?.clearResults(notebook.uri.toString())
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument(e => {
      if (e.notebook.notebookType !== NOTEBOOK_TYPE) return
      correctSqlLanguages(e.notebook)
    })
  )

  log.debug("📒 SAP Data Workbook ready — .sapwb files are now executable")
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
  data.metadata = { version: 1, title: "" }

  const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data)
  await vscode.window.showNotebookDocument(doc)
}

async function correctSqlLanguages(notebook: vscode.NotebookDocument): Promise<void> {
  const wrongCells = notebook.getCells().filter(
    c => c.kind === vscode.NotebookCellKind.Code && c.document.languageId === "sql"
  )
  if (wrongCells.length === 0) return

  const edit = new vscode.WorkspaceEdit()
  for (const cell of wrongCells) {
    const nbEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, {
      ...cell.metadata,
      custom: { ...cell.metadata?.custom, languageId: SQL_LANGUAGE_ID }
    })
    edit.set(notebook.uri, [nbEdit])
  }

  const langEdit = new vscode.WorkspaceEdit()
  for (const cell of wrongCells) {
    langEdit.set(cell.document.uri, [
      vscode.NotebookEdit.updateCellMetadata(cell.index, cell.metadata)
    ])
  }

  for (const cell of wrongCells) {
    await vscode.languages.setTextDocumentLanguage(cell.document, SQL_LANGUAGE_ID)
  }
  log.debug(`📒 Corrected ${wrongCells.length} cell(s) from "sql" to "${SQL_LANGUAGE_ID}"`)
}
