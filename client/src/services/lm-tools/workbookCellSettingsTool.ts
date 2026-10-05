/**
 * Workbook Cell Settings Tool
 *
 * Reads and changes the per-cell settings of an SAP Data Workbook (.sapwb): cell name, system
 * marker and row limit. Copilot's notebook tools edit cell content but cannot see or set these,
 * so this tool closes that gap. All changes of one call are validated first and applied as one
 * edit (one undo step); if anything is invalid, nothing is changed.
 */

import * as path from "path"
import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { logTelemetry } from "../telemetry"
import { DEFAULT_MAX_ROWS, FILE_EXTENSION, NOTEBOOK_TYPE } from "../../notebooks/types"
import { validateCellName } from "../../notebooks/cellReferences"
import {
  applyCellPatches,
  type CellPatch,
  cellName,
  cellSystem,
  cellsReferencingName,
  effectiveSystems,
  isSqlCell,
  isSystemConnected,
  knownSystems,
  validateMaxRows
} from "../../notebooks/cellMetadata"

// ============================================================================
// INTERFACE
// ============================================================================

export interface CellSettingsRequest {
  /** 0-based cell position, counting markdown cells (the same N as cells[N]). */
  index: number
  name?: string
  system?: string
  maxRows?: number
  clearName?: boolean
  clearSystem?: boolean
}

export interface IWorkbookCellSettingsParameters {
  /** Absolute path, file URI, or path relative to a workspace folder. Must end in .sapwb. */
  filePath: string
  /** Cells to change. Omit (or pass an empty list) to only read the current settings. */
  cells?: CellSettingsRequest[]
}

// ============================================================================
// CORE LOGIC
// ============================================================================

const hasScheme = (p: string) => /^[a-zA-Z][\w+.-]+:\/\//.test(p)

/** Turn the path Copilot passes into a URI. Relative paths are looked up in the workspace. */
export async function resolveWorkbookUri(filePath: string): Promise<vscode.Uri> {
  const p = (filePath ?? "").trim()
  if (!p) throw new Error("filePath is required: the path of the .sapwb workbook.")
  if (path.extname(p.replace(/[?#].*$/, "")).toLowerCase() !== FILE_EXTENSION)
    throw new Error(
      `'${p}' is not an SAP Data Workbook: the file must have the ${FILE_EXTENSION} extension.`
    )
  if (hasScheme(p)) return vscode.Uri.parse(p)
  if (path.isAbsolute(p) || path.win32.isAbsolute(p)) return vscode.Uri.file(p)
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme === "adt") continue
    const candidate = vscode.Uri.joinPath(folder.uri, p)
    try {
      await vscode.workspace.fs.stat(candidate)
      return candidate
    } catch {
      // not in this folder
    }
  }
  throw new Error(`Workbook '${p}' not found in the workspace. Pass an absolute path.`)
}

const cellLanguage = (cell: vscode.NotebookCell) =>
  cell.kind === vscode.NotebookCellKind.Markup ? "markdown" : cell.document.languageId

const firstLine = (cell: vscode.NotebookCell) => {
  const line =
    cell.document
      .getText()
      .split(/\r?\n/)
      .find(l => l.trim()) ?? ""
  return line.length > 80 ? line.slice(0, 77) + "..." : line
}

const connectionNote = (system: string) => (isSystemConnected(system) ? "" : ", not connected")

/** One line per cell with its settings, for Copilot to read. */
export function describeCells(notebook: vscode.NotebookDocument): string[] {
  const eff = effectiveSystems(notebook)
  return notebook.getCells().map(cell => {
    const parts = [`#${cell.index} ${cellLanguage(cell)}`]
    const name = cellName(cell)
    if (name) parts.push(`name: ${name}`)
    const own = cellSystem(cell)
    if (isSqlCell(cell)) {
      const sys = eff[cell.index]?.system
      if (own) parts.push(`system: ${own} (marker${connectionNote(own)})`)
      else if (sys)
        parts.push(`system: ${sys} (from #${eff[cell.index].from}${connectionNote(sys)})`)
      else parts.push("system: none (asked when run)")
      parts.push(`maxRows: ${cell.metadata?.maxRows ?? DEFAULT_MAX_ROWS}`)
    } else if (own) {
      parts.push(`system marker '${own}' is ignored (not an ABAP SQL cell; clear it)`)
    }
    parts.push(JSON.stringify(firstLine(cell)))
    return parts.join(" | ")
  })
}

export interface SettingsPlan {
  patches: CellPatch[]
  changes: string[]
  warnings: string[]
  errors: string[]
}

const hasSetting = (r: CellSettingsRequest) =>
  r.name !== undefined ||
  r.system !== undefined ||
  r.maxRows !== undefined ||
  !!r.clearName ||
  !!r.clearSystem

/** Validate the requests against the workbook and work out the metadata patches. */
export function planCellSettings(
  notebook: vscode.NotebookDocument,
  requests: CellSettingsRequest[]
): SettingsPlan {
  const plan: SettingsPlan = { patches: [], changes: [], warnings: [], errors: [] }
  const cells = notebook.getCells()
  const finalNames = cells.map(c => cellName(c))
  const seen = new Set<number>()
  const known = new Set(knownSystems().map(s => s.toLowerCase()))

  for (const r of requests) {
    const at = `Cell #${r.index}`
    if (!Number.isInteger(r.index) || r.index < 0 || r.index >= cells.length) {
      plan.errors.push(`${at}: no such cell (the workbook has cells #0 to #${cells.length - 1}).`)
      continue
    }
    if (seen.has(r.index)) {
      plan.errors.push(`${at} is listed more than once; combine its settings in one entry.`)
      continue
    }
    seen.add(r.index)
    if (!hasSetting(r)) {
      plan.errors.push(
        `${at}: give at least one of name, system, maxRows, clearName or clearSystem.`
      )
      continue
    }
    const cell = cells[r.index]
    const sql = isSqlCell(cell)
    const patch: Record<string, unknown> = {}
    const done: string[] = []

    if (r.name !== undefined && r.clearName)
      plan.errors.push(`${at}: use either name or clearName, not both.`)
    else if (r.clearName) {
      patch.name = undefined
      finalNames[r.index] = undefined
      done.push("name removed")
    } else if (r.name !== undefined) {
      const name = String(r.name).trim()
      const invalid = name ? validateCellName(name) : "Use clearName to remove a name."
      if (invalid) plan.errors.push(`${at}: invalid name '${name}': ${invalid}`)
      else {
        patch.name = name
        finalNames[r.index] = name
        done.push(`name ${name}`)
      }
    }

    if (r.system !== undefined && r.clearSystem)
      plan.errors.push(`${at}: use either system or clearSystem, not both.`)
    else if (r.clearSystem) {
      if (cellSystem(cell)) {
        patch.system = undefined
        done.push("system marker removed (inherits the marker above)")
      } else plan.warnings.push(`${at} has no system marker to clear.`)
    } else if (r.system !== undefined) {
      const system = String(r.system).trim()
      if (!sql)
        plan.errors.push(
          `${at} is a ${cellLanguage(cell)} cell: systems apply to ABAP SQL cells only.`
        )
      else if (!system) plan.errors.push(`${at}: use clearSystem to remove a system marker.`)
      else {
        patch.system = system
        done.push(`system ${system}`)
        if (!isSystemConnected(system))
          plan.warnings.push(
            known.has(system.toLowerCase())
              ? `${at}: system '${system}' is configured but not connected. Saved anyway; the user must connect it before running.`
              : `${at}: '${system}' is not a configured ABAP FS connection id. Saved anyway; check the id with abapfs_get_connected_systems.`
          )
      }
    }

    if (r.maxRows !== undefined) {
      const invalid = sql
        ? validateMaxRows(r.maxRows)
        : `row limits apply to ABAP SQL cells only (this is a ${cellLanguage(cell)} cell)`
      if (invalid) plan.errors.push(`${at}: invalid maxRows ${r.maxRows}: ${invalid}`)
      else {
        patch.maxRows = r.maxRows
        done.push(`maxRows ${r.maxRows}`)
      }
    }

    if (Object.keys(patch).length) {
      plan.patches.push({ index: r.index, patch })
      plan.changes.push(`${at}: ${done.join(", ")}`)
    }
  }

  checkNames(notebook, finalNames, plan)
  return plan
}

/** Names must be unique after the change; warn when a removed or renamed name is still used. */
function checkNames(
  notebook: vscode.NotebookDocument,
  finalNames: Array<string | undefined>,
  plan: SettingsPlan
) {
  const byName = new Map<string, number[]>()
  finalNames.forEach((n, i) => n && byName.set(n, [...(byName.get(n) ?? []), i]))
  for (const [name, at] of byName)
    if (at.length > 1)
      plan.errors.push(`Name '${name}' would be used by cells ${at.map(i => `#${i}`).join(", ")}.`)

  for (const cell of notebook.getCells()) {
    const before = cellName(cell)
    if (!before || finalNames[cell.index] === before || byName.has(before)) continue
    const users = cellsReferencingName(notebook, before, cell.index)
    if (users.length)
      plan.warnings.push(
        `Cells ${users.map(u => `#${u.index}`).join(", ")} still reference cells.${before}; update them to ${
          finalNames[cell.index] ? `cells.${finalNames[cell.index]}` : `cells[${cell.index}]`
        }.`
      )
  }
}

/** SQL cells that would have no system after the patches. */
function unassignedSqlCells(notebook: vscode.NotebookDocument, patches: CellPatch[]): number[] {
  const pending = new Map<number, string | undefined>()
  for (const p of patches)
    if ("system" in p.patch) pending.set(p.index, p.patch.system as string | undefined)
  const eff = effectiveSystems(notebook, pending)
  return notebook
    .getCells()
    .filter(c => isSqlCell(c) && !eff[c.index]?.system)
    .map(c => c.index)
}

async function openWorkbook(uri: vscode.Uri): Promise<vscode.NotebookDocument> {
  let notebook: vscode.NotebookDocument
  try {
    notebook = await vscode.workspace.openNotebookDocument(uri)
  } catch (e) {
    throw new Error(
      `Cannot open workbook ${uri.fsPath}: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  if (notebook.notebookType !== NOTEBOOK_TYPE)
    throw new Error(`${uri.fsPath} is not open as an SAP Data Workbook.`)
  return notebook
}

/** Apply the plan and save when the workbook had no unsaved changes before. */
export async function updateCellSettings(
  notebook: vscode.NotebookDocument,
  requests: CellSettingsRequest[]
): Promise<string[]> {
  const plan = planCellSettings(notebook, requests)
  if (plan.errors.length)
    throw new Error(
      `Nothing was changed:\n${plan.errors.map(e => `- ${e}`).join("\n")}` +
        (plan.warnings.length ? `\nAlso:\n${plan.warnings.map(w => `- ${w}`).join("\n")}` : "")
    )
  const lines: string[] = []
  if (plan.patches.length) {
    const wasDirty = notebook.isDirty
    const unassigned = unassignedSqlCells(notebook, plan.patches)
    if (!(await applyCellPatches(notebook, plan.patches)))
      throw new Error("VS Code rejected the edit; nothing was changed.")
    const saved = !wasDirty && (await notebook.save())
    lines.push("Changed:", ...plan.changes.map(c => `- ${c}`))
    lines.push(
      saved
        ? "Saved."
        : "Not saved: the workbook has other unsaved changes. The settings apply now; the user saves to keep them."
    )
    if (unassigned.length && unassigned.length < notebook.getCells().filter(isSqlCell).length)
      plan.warnings.push(
        unassigned.length === 1
          ? `SQL cell #${unassigned[0]} has no system and is asked for one when run.`
          : `SQL cells ${unassigned.map(i => `#${i}`).join(", ")} have no system and are asked for one when run.`
      )
  } else lines.push("Nothing to change.")
  if (plan.warnings.length) lines.push("Warnings:", ...plan.warnings.map(w => `- ${w}`))
  return lines
}

// ============================================================================
// TOOL CLASS
// ============================================================================

export class WorkbookCellSettingsTool implements vscode.LanguageModelTool<IWorkbookCellSettingsParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IWorkbookCellSettingsParameters>,
    _token: vscode.CancellationToken
  ) {
    const file = path.basename(options.input?.filePath ?? "") || "workbook"
    const count = options.input?.cells?.length ?? 0
    return {
      invocationMessage: count
        ? `Updating settings of ${count} cell(s) in ${file}`
        : `Reading cell settings of ${file}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IWorkbookCellSettingsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const { filePath, cells = [] } = options.input ?? ({} as IWorkbookCellSettingsParameters)
    logTelemetry("tool_workbook_cell_settings_called")
    if (!Array.isArray(cells)) throw new Error("cells must be a list.")
    const uri = await resolveWorkbookUri(filePath)
    const notebook = await openWorkbook(uri)
    const lines = [`Workbook: ${uri.fsPath} (${notebook.cellCount} cells)`]
    if (cells.length) lines.push(...(await updateCellSettings(notebook, cells)))
    lines.push("Cells:", ...describeCells(notebook))
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join("\n"))])
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerWorkbookCellSettingsTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("abapfs_workbook_cell_settings", new WorkbookCellSettingsTool())
  )
}
