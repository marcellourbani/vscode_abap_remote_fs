import * as vscode from "vscode"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID, DEFAULT_MAX_ROWS } from "./types"
import { funWindow as window } from "../services/funMessenger"
import { renameReferences, validateCellName } from "./cellReferences"
import {
  cellName,
  cellSystem,
  cellsReferencingName,
  effectiveSystems,
  isSqlCell,
  isSystemConnected,
  knownSystems,
  setCellMetadata,
  validateMaxRows
} from "./cellMetadata"

/**
 * Status bar items on each cell:
 *   left : "#5 · s1_auth"  (click: name / rename the cell)
 *   left : "DEV ▸" / "DEV (from #2)" on ABAP SQL cells  (click: set the system from this cell on)
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

    // system (sticky): ABAP SQL cells only
    const own = cellSystem(cell)
    if (isCode && isSql) items.push(systemItem(cell, own))
    else if (own) items.push(ignoredMarkerItem(cell, own))

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

function systemItem(cell: vscode.NotebookCell, own: string | undefined) {
  const eff = effectiveSystems(cell.notebook)[cell.index]
  const sys = eff?.system
  const connected = sys ? isSystemConnected(sys) : false
  const icon = !sys ? "$(plug)" : connected ? "$(server-environment)" : "$(debug-disconnect)"
  const text = own
    ? `${icon} ${own} ▸`
    : sys
      ? `${icon} ${sys} (from #${eff.from})`
      : `${icon} system: ask`
  const item = new vscode.NotebookCellStatusBarItem(
    text,
    vscode.NotebookCellStatusBarAlignment.Left
  )
  const notConnected = connected ? "" : " — NOT connected in this window"
  item.tooltip = own
    ? `This and the following ABAP SQL cells run on '${own}'${notConnected}, until the next system marker. Click to change or remove.`
    : sys
      ? `Runs on '${sys}' (marker on cell #${eff.from})${notConnected}. Click to set a different system from this cell on.`
      : "No system assigned: you will be asked when it runs. Click to assign a system from this cell on."
  item.command = { command: "abapfs.notebookSetCellSystem", title: "Set system", arguments: [cell] }
  return item
}

/** A marker left on a JavaScript / markdown cell (e.g. by an older version): shown so it can be removed. */
function ignoredMarkerItem(cell: vscode.NotebookCell, own: string) {
  const item = new vscode.NotebookCellStatusBarItem(
    `$(warning) ${own} (ignored)`,
    vscode.NotebookCellStatusBarAlignment.Left
  )
  item.tooltip =
    "System markers apply to ABAP SQL cells only, so this one is ignored. Click to remove it."
  item.command = { command: "abapfs.notebookSetCellSystem", title: "Set system", arguments: [cell] }
  return item
}

type SystemPick = vscode.QuickPickItem & { value?: string; action?: "clear" }

/**
 * Systems for the marker picker: connected systems first, then the cell's current system, then the
 * systems that are configured but not connected. No free-text entry: only known connections.
 */
export function systemPickItems(current: string | undefined, hasMarker: boolean): SystemPick[] {
  const isCurrent = (s: string) => !!current && s.toLowerCase() === current.toLowerCase()
  const others = knownSystems().filter(s => !isCurrent(s))
  const connected = others.filter(isSystemConnected)
  const notConnected = others.filter(s => !isSystemConnected(s))
  const separator = (label: string): SystemPick => ({
    label,
    kind: vscode.QuickPickItemKind.Separator
  })
  const items: SystemPick[] = [separator("Connected")]
  items.push(...connected.map(s => ({ label: s, value: s })))
  if (current)
    items.push({
      label: current,
      value: current,
      description: isSystemConnected(current) ? "current" : "current · not connected"
    })
  if (notConnected.length) items.push(separator("Not connected"))
  items.push(...notConnected.map(s => ({ label: s, description: "not connected", value: s })))
  if (hasMarker) {
    items.push(separator(""))
    items.push({ label: "$(close) Remove the system marker from this cell", action: "clear" })
  }
  return items
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
          validateInput: v => validateMaxRows(Number(v))
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
        const users = cellsReferencingName(cell.notebook, current, cell.index)
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
      if (!isSqlCell(cell)) {
        if (own) await setCellMetadata(cell, { system: undefined })
        else window.showInformationMessage("System markers apply to ABAP SQL cells only.")
        provider.refresh()
        return
      }
      const current = own ?? effectiveSystems(cell.notebook)[cell.index]?.system
      const picked = await window.showQuickPick(systemPickItems(current, !!own), {
        title: `System for ABAP SQL cell #${cell.index} and the following SQL cells`,
        placeHolder: "SQL cells from here until the next system marker run on this SAP system"
      })
      if (!picked) return
      const value = picked.action === "clear" ? undefined : picked.value
      if (value === own) return
      await setCellMetadata(cell, { system: value })
      provider.refresh()
    }),

    vscode.commands.registerCommand("abapfs.notebookShowRunPlan", async () => {
      const editor = vscode.window.activeNotebookEditor
      if (!editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) return
      const cells = editor.notebook.getCells()
      const eff = effectiveSystems(editor.notebook)
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
