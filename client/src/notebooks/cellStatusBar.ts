import * as vscode from "vscode"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID, DEFAULT_MAX_ROWS } from "./types"
import { funWindow as window } from "../services/funMessenger"

/**
 * Provides a clickable status bar item on each SQL cell showing the current maxRows limit.
 * Clicking it opens an input box to change the value, stored in cell.metadata.maxRows.
 */
export class SqlCellStatusBarProvider implements vscode.NotebookCellStatusBarItemProvider {
  provideCellStatusBarItems(
    cell: vscode.NotebookCell
  ): vscode.NotebookCellStatusBarItem | undefined {
    if (cell.document.languageId !== SQL_LANGUAGE_ID) return undefined

    const maxRows: number = cell.metadata?.maxRows ?? DEFAULT_MAX_ROWS
    const item = new vscode.NotebookCellStatusBarItem(
      `$(list-ordered) Rows: ${maxRows}`,
      vscode.NotebookCellStatusBarAlignment.Right
    )
    item.tooltip = "Click to change the row limit for this SQL cell"
    item.command = {
      command: "abapfs.notebookSetCellMaxRows",
      title: "Set max rows",
      arguments: [cell]
    }
    return item
  }
}

export function registerCellStatusBar(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(
      NOTEBOOK_TYPE,
      new SqlCellStatusBarProvider()
    )
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "abapfs.notebookSetCellMaxRows",
      async (cell: vscode.NotebookCell) => {
        const current: number = cell.metadata?.maxRows ?? DEFAULT_MAX_ROWS
        const input = await window.showInputBox({
          title: "Set Max Rows for SQL Cell",
          prompt: "Maximum number of rows to fetch from SAP for this cell",
          value: String(current),
          validateInput: v => {
            const n = Number(v)
            if (!Number.isInteger(n) || n < 1 || n > 100_000) {
              return "Enter a whole number between 1 and 100,000"
            }
            return undefined
          }
        })

        if (input === undefined) return

        const newMax = Number(input)
        const edit = new vscode.WorkspaceEdit()
        const notebookEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, {
          ...cell.metadata,
          maxRows: newMax
        })
        edit.set(cell.notebook.uri, [notebookEdit])
        await vscode.workspace.applyEdit(edit)
      }
    )
  )
}
