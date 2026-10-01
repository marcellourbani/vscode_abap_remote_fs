/** Workbook toolbar: collapse / expand all code cells or all outputs (VS Code built-in commands). */
import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"

const inputsCollapsed = new Map<string, boolean>()
const outputsCollapsed = new Map<string, boolean>()

async function runFirst(ids: string[]): Promise<boolean> {
  for (const id of ids) {
    try {
      await vscode.commands.executeCommand(id)
      return true
    } catch {
      /* try next id */
    }
  }
  return false
}

export async function toggleCollapse(which: "inputs" | "outputs", force?: "collapse" | "expand") {
  const editor = vscode.window.activeNotebookEditor
  if (!editor) return
  const key = editor.notebook.uri.toString()
  const state = which === "inputs" ? inputsCollapsed : outputsCollapsed
  const collapse = force ? force === "collapse" : !state.get(key)
  const Which = which === "inputs" ? "Inputs" : "Outputs"
  const ok = await runFirst([
    `notebook.cell.${collapse ? "collapse" : "expand"}AllCell${Which}`,
    `notebook.${collapse ? "collapse" : "expand"}AllCell${Which}`
  ])
  if (!ok) {
    window.showWarningMessage(
      `This editor does not support 'Collapse All Cell ${Which}'. Use the Command Palette: "Notebook: ${collapse ? "Collapse" : "Expand"} All Cell ${Which}".`
    )
    return
  }
  state.set(key, collapse)
}
