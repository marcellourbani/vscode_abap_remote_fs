import * as vscode from "vscode"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID, DEFAULT_MAX_ROWS } from "./types"
import { funWindow as window } from "../services/funMessenger"
import { renameReferences, validateCellName } from "./cellReferences"
import { cellName } from "./abapNotebookController"

/**
 * Status bar items on each cell:
 *   left : "#5 · s1_auth"  (click: name / rename the cell)
 *   right: "Rows: 1000" for SQL cells (click: change the row limit)
 */
export class SqlCellStatusBarProvider implements vscode.NotebookCellStatusBarItemProvider {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeCellStatusBarItems = this.changed.event

  refresh(): void {
    this.changed.fire()
  }

  provideCellStatusBarItems(cell: vscode.NotebookCell): vscode.NotebookCellStatusBarItem[] {
    const items: vscode.NotebookCellStatusBarItem[] = []
    const isCode = cell.kind === vscode.NotebookCellKind.Code
    const isSql = cell.document.languageId === SQL_LANGUAGE_ID

    // name
    const name = cellName(cell)
    const nameItem = new vscode.NotebookCellStatusBarItem(
      name ? `$(tag) #${cell.index} · ${name}` : `$(tag) #${cell.index}`,
      vscode.NotebookCellStatusBarAlignment.Left
    )
    nameItem.tooltip = name
      ? `Referenced as cells.${name} (JS) or \${cells.${name}.result...} (SQL). Click to rename.`
      : "Click to give this cell a name, so references survive inserting/moving cells."
    nameItem.command = {
      command: "abapfs.notebookSetCellName",
      title: "Name cell",
      arguments: [cell]
    }
    items.push(nameItem)

    if (isCode && isSql) {
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
      items.push(item)
    }
    return items
  }
}

async function setCellMetadata(cell: vscode.NotebookCell, patch: Record<string, unknown>) {
  const metadata: Record<string, unknown> = { ...cell.metadata }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete metadata[k]
    else metadata[k] = v
  }
  const edit = new vscode.WorkspaceEdit()
  edit.set(cell.notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index, metadata)])
  await vscode.workspace.applyEdit(edit)
}

/** Resolve the target cell for commands invoked from the palette / toolbar without an argument. */
function targetCell(arg: unknown): vscode.NotebookCell | undefined {
  if (arg && typeof arg === "object" && "notebook" in arg && "index" in arg)
    return arg as vscode.NotebookCell
  const editor = vscode.window.activeNotebookEditor
  if (!editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) return undefined
  const idx = editor.selections[0]?.start ?? 0
  return editor.notebook.cellAt(idx)
}

export function registerCellStatusBar(context: vscode.ExtensionContext): SqlCellStatusBarProvider {
  const provider = new SqlCellStatusBarProvider()
  context.subscriptions.push(
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, provider)
  )
  // cell numbers depend on the other cells: refresh when the notebook changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument(e => {
      if (e.notebook.notebookType === NOTEBOOK_TYPE) provider.refresh()
    })
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
        await setCellMetadata(cell, { maxRows: Number(input) })
      }
    ),

    vscode.commands.registerCommand("abapfs.notebookSetCellName", async (arg?: unknown) => {
      const cell = targetCell(arg)
      if (!cell) return
      const current = cellName(cell) ?? ""
      const taken = cell.notebook
        .getCells()
        .filter(c => c.index !== cell.index)
        .map(c => cellName(c))
        .filter((n): n is string => !!n)
      const input = await window.showInputBox({
        title: `Name cell #${cell.index}`,
        prompt:
          "Reference it as cells.<name> in JavaScript or ${cells.<name>.result...} in SQL. Empty = remove name.",
        value: current,
        validateInput: v => validateCellName(v.trim(), taken)
      })
      if (input === undefined) return
      const next = input.trim()
      if (next === current) return
      await setCellMetadata(cell, { name: next || undefined })

      if (current && next) {
        const users = cell.notebook
          .getCells()
          .filter(c => c.kind === vscode.NotebookCellKind.Code && c.index !== cell.index)
          .filter(
            c => renameReferences(c.document.getText(), current, next) !== c.document.getText()
          )
        if (users.length) {
          const answer = await window.showInformationMessage(
            `Update ${users.length} cell(s) that reference '${current}' to use '${next}'?`,
            "Update references",
            "Leave as is"
          )
          if (answer === "Update references") {
            const edit = new vscode.WorkspaceEdit()
            for (const c of users) {
              const text = c.document.getText()
              const full = new vscode.Range(
                c.document.positionAt(0),
                c.document.positionAt(text.length)
              )
              edit.replace(c.document.uri, full, renameReferences(text, current, next))
            }
            await vscode.workspace.applyEdit(edit)
          }
        }
      }
      provider.refresh()
    })
  )
  return provider
}
