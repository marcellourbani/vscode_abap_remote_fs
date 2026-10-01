import * as vscode from "vscode"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID, DEFAULT_MAX_ROWS } from "./types"
import { funWindow as window } from "../services/funMessenger"
import { renameReferences, validateCellName } from "./cellReferences"
import { resolveEffectiveSystems } from "./systemPlan"
import { cellName, cellSystem, isSystemConnected } from "./abapNotebookController"
import { connectedRoots, getConfig } from "../config"

/**
 * Status bar items on each cell:
 *   left : "#5 · s1_auth"  (click: name / rename the cell)
 *   left : "⚡ DEV" / "↳ DEV (from #2)"  (click: set the system from this cell on)
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

    // system (sticky)
    const own = cellSystem(cell)
    const eff = resolveEffectiveSystems(
      cell.notebook.getCells().map(c => ({ system: cellSystem(c) }))
    )[cell.index]
    if (own || eff?.system || isSql) {
      const sys = eff?.system
      const connected = sys ? isSystemConnected(sys) : false
      const icon = !sys ? "$(plug)" : connected ? "$(server-environment)" : "$(debug-disconnect)"
      const text = own
        ? `${icon} ${own} ▸`
        : sys
          ? `${icon} ${sys} (from #${eff.from})`
          : `${icon} system: ask`
      const sysItem = new vscode.NotebookCellStatusBarItem(
        text,
        vscode.NotebookCellStatusBarAlignment.Left
      )
      sysItem.tooltip = own
        ? `This cell and all following cells run on '${own}' until the next system marker. Click to change.`
        : sys
          ? `Runs on '${sys}' (set on cell #${eff.from})${connected ? "" : " — NOT connected in this window"}. Click to set a different system from this cell on.`
          : "No system assigned: you will be asked when it runs. Click to assign a system from this cell on."
      sysItem.command = {
        command: "abapfs.notebookSetCellSystem",
        title: "Set system",
        arguments: [cell]
      }
      items.push(sysItem)
    }

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

export function knownSystems(): string[] {
  const configured = Object.keys((getConfig().get("remote") as Record<string, unknown>) || {})
  const connected = [...connectedRoots().keys()]
  const seen = new Map<string, string>()
  for (const s of [...connected, ...configured])
    if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s)
  return [...seen.values()].sort()
}

export function registerCellStatusBar(context: vscode.ExtensionContext): SqlCellStatusBarProvider {
  const provider = new SqlCellStatusBarProvider()
  context.subscriptions.push(
    vscode.notebooks.registerNotebookCellStatusBarItemProvider(NOTEBOOK_TYPE, provider)
  )
  // effective systems depend on other cells and on connections: refresh when either changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument(e => {
      if (e.notebook.notebookType === NOTEBOOK_TYPE) provider.refresh()
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
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
    }),

    vscode.commands.registerCommand("abapfs.notebookSetCellSystem", async (arg?: unknown) => {
      const cell = targetCell(arg)
      if (!cell) return
      const own = cellSystem(cell)
      type Pick = vscode.QuickPickItem & { value?: string; action?: "clear" | "custom" }
      const items: Pick[] = knownSystems().map(s => ({
        label: s,
        description: isSystemConnected(s) ? "connected" : "not connected",
        value: s
      }))
      items.push({ label: "$(edit) Other…", action: "custom" })
      if (own)
        items.push({ label: "$(close) Remove system marker from this cell", action: "clear" })
      const picked = await window.showQuickPick(items, {
        title: `System from cell #${cell.index} onwards`,
        placeHolder: "Cells from here until the next system marker will run on this SAP system"
      })
      if (!picked) return
      let value: string | undefined = picked.value
      if (picked.action === "clear") value = undefined
      if (picked.action === "custom") {
        value = (
          await window.showInputBox({ prompt: "ABAP FS connection id", value: own ?? "" })
        )?.trim()
        if (value === undefined) return
      }
      await setCellMetadata(cell, { system: value })
      provider.refresh()
    }),

    vscode.commands.registerCommand("abapfs.notebookShowRunPlan", async () => {
      const editor = vscode.window.activeNotebookEditor
      if (!editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) return
      const cells = editor.notebook.getCells()
      const eff = resolveEffectiveSystems(cells.map(c => ({ system: cellSystem(c) })))
      const lines = cells
        .filter(c => c.kind === vscode.NotebookCellKind.Code)
        .map(c => {
          const sys =
            c.document.languageId === SQL_LANGUAGE_ID ? (eff[c.index]?.system ?? "(ask)") : "—"
          const n = cellName(c)
          return `#${c.index}${n ? " " + n : ""}  [${c.document.languageId === SQL_LANGUAGE_ID ? "SQL" : "JS"}]  → ${sys}`
        })
      const doc = await vscode.workspace.openTextDocument({
        content: `SAP Data Workbook run plan\n\n${lines.join("\n")}\n`,
        language: "plaintext"
      })
      await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
      })
    })
  )
  return provider
}
