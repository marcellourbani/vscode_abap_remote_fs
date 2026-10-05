import * as vscode from "vscode"
import { SQL_LANGUAGE_ID } from "./types"
import { findCellReferences } from "./cellReferences"
import { resolveEffectiveSystems } from "./systemPlan"
import { connectedRoots, formatKey, getConfig } from "../config"

/**
 * Per-cell settings stored in the cell metadata (and in the .sapwb file): name, system marker and
 * row limit. Shared by the status bar, the controller, export and the cell settings tool.
 */

export const MAX_ROWS_LIMIT = 100_000

export function cellName(cell: vscode.NotebookCell): string | undefined {
  const n = cell.metadata?.name
  return typeof n === "string" && n.trim() ? n.trim() : undefined
}

export function cellSystem(cell: vscode.NotebookCell): string | undefined {
  const s = cell.metadata?.system
  return typeof s === "string" && s.trim() ? s.trim() : undefined
}

export const isSqlCell = (cell: vscode.NotebookCell) =>
  cell.kind === vscode.NotebookCellKind.Code && cell.document.languageId === SQL_LANGUAGE_ID

/**
 * Effective system of every cell. Only SQL cells carry or inherit a system marker.
 * `pending` overrides cell markers by index (undefined = no marker), to preview a change.
 */
export function effectiveSystems(
  notebook: vscode.NotebookDocument,
  pending: Map<number, string | undefined> = new Map()
) {
  return resolveEffectiveSystems(
    notebook.getCells().map(c => ({
      system: pending.has(c.index) ? pending.get(c.index) : cellSystem(c),
      sql: isSqlCell(c)
    }))
  )
}

export function isSystemConnected(system: string): boolean {
  return connectedRoots().has(formatKey(system))
}

/** Connected and configured connection ids, without case duplicates, sorted. */
export function knownSystems(): string[] {
  const configured = Object.keys((getConfig().get("remote") as Record<string, unknown>) || {})
  const connected = [...connectedRoots().keys()]
  const seen = new Map<string, string>()
  for (const s of [...connected, ...configured])
    if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s)
  return [...seen.values()].sort()
}

/** Error message for an invalid row limit, undefined when valid. */
export function validateMaxRows(n: unknown): string | undefined {
  if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_ROWS_LIMIT)
    return undefined
  return "Enter a whole number between 1 and 100,000"
}

/** Apply a patch to cell metadata: undefined or "" removes the key. */
export function patchMetadata(
  metadata: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete next[k]
    else next[k] = v
  }
  return next
}

export interface CellPatch {
  index: number
  patch: Record<string, unknown>
}

/** Apply metadata patches to several cells as one edit (one undo step). */
export async function applyCellPatches(
  notebook: vscode.NotebookDocument,
  patches: CellPatch[]
): Promise<boolean> {
  if (patches.length === 0) return false
  const cells = notebook.getCells()
  const edit = new vscode.WorkspaceEdit()
  edit.set(
    notebook.uri,
    patches.map(p =>
      vscode.NotebookEdit.updateCellMetadata(
        p.index,
        patchMetadata(cells[p.index]?.metadata, p.patch)
      )
    )
  )
  return vscode.workspace.applyEdit(edit)
}

export function setCellMetadata(cell: vscode.NotebookCell, patch: Record<string, unknown>) {
  return applyCellPatches(cell.notebook, [{ index: cell.index, patch }])
}

/** Code cells (other than `exceptIndex`) whose source references the cell named `name`. */
export function cellsReferencingName(
  notebook: vscode.NotebookDocument,
  name: string,
  exceptIndex?: number
): vscode.NotebookCell[] {
  return notebook
    .getCells()
    .filter(c => c.kind === vscode.NotebookCellKind.Code && c.index !== exceptIndex)
    .filter(c => findCellReferences(c.document.getText()).names.has(name))
}
