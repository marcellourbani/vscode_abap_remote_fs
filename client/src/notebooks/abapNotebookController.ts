import * as vscode from "vscode"
import { NOTEBOOK_TYPE, type CellResult, SQL_LANGUAGE_ID } from "./types"
import {
  resolveConnection,
  type ResolvedConnection,
  NotebookConnectionError
} from "./connectionResolver"
import { executeSqlCell } from "./sqlCellExecutor"
import { executeJsCell } from "./jsCellExecutor"
import {
  renderSqlOutput,
  renderJsOutputs,
  renderErrorOutput,
  type RenderSettings
} from "./outputRenderer"
import {
  buildRunPlan,
  describePlan,
  missingSystems,
  normalizeSystem,
  resolveEffectiveSystems
} from "./systemPlan"
import { connectedRoots, formatKey } from "../config"
import {
  applyCellPatches,
  type CellPatch,
  cellName,
  cellSystem,
  effectiveSystems,
  isSqlCell,
  isSystemConnected
} from "./cellMetadata"
import { getOrCreateClient } from "../adt/conections"
import { log } from "../lib"
import { funWindow as window } from "../services/funMessenger"

/** Snapshot of a notebook's results, by current cell position and by name. */
export interface NotebookResultsView {
  byIndex: Map<number, CellResult>
  nameToIndex: Map<string, number>
}

export function renderSettings(): RenderSettings {
  return {
    wrap: vscode.workspace.getConfiguration("abapfs").get<boolean>("workbook.tableWrap", true)
  }
}

/**
 * For each system marker that is not connected, ask which connected system to use instead and
 * rewrite those markers in the workbook. Returns false if the user cancels or nothing is connected.
 */
export async function remapMissingMarkers(
  notebook: vscode.NotebookDocument,
  missing: string[]
): Promise<boolean> {
  const connected = [...connectedRoots().keys()]
  if (connected.length === 0) return false
  const mapping = new Map<string, string>()
  for (const m of missing) {
    const picked = await window.showQuickPick(
      connected.map(id => ({ label: id, description: "connected" })),
      {
        title: `System marker '${m}' is not connected`,
        placeHolder: `Run the cells marked '${m}' on… (the marker in the workbook is updated; save to keep it)`,
        ignoreFocusOut: true
      }
    )
    if (!picked) return false
    mapping.set(m.toLowerCase(), picked.label)
  }
  const patches: CellPatch[] = []
  for (const c of notebook.getCells()) {
    const own = isSqlCell(c) ? cellSystem(c) : undefined
    const target = own ? mapping.get(own.toLowerCase()) : undefined
    if (target) patches.push({ index: c.index, patch: { system: target } })
  }
  return applyCellPatches(notebook, patches)
}

export class AbapNotebookController {
  private readonly controller: vscode.NotebookController
  /** notebook uri -> (cell document uri -> result). Keyed by cell, so inserts/moves do not shift results. */
  private readonly cellResults = new Map<string, Map<string, CellResult>>()
  private readonly executionCounters = new Map<string, number>()
  private readonly runningAbortControllers = new Map<string, AbortController>()
  private readonly runGeneration = new Map<string, number>()

  constructor() {
    this.controller = vscode.notebooks.createNotebookController(
      "sap-data-workbook-controller",
      NOTEBOOK_TYPE,
      "SAP Data Workbook"
    )
    this.controller.supportedLanguages = [SQL_LANGUAGE_ID, "javascript"]
    this.controller.supportsExecutionOrder = true
    this.controller.executeHandler = this.executeHandler.bind(this)
    this.controller.interruptHandler = this.interruptHandler.bind(this)
  }

  dispose(): void {
    this.controller.dispose()
    for (const ac of this.runningAbortControllers.values()) ac.abort()
  }

  /** Results of a notebook by current position / name (used by execution and export). */
  getResultsView(notebook: vscode.NotebookDocument): NotebookResultsView {
    const stored = this.cellResults.get(notebook.uri.toString())
    const byIndex = new Map<number, CellResult>()
    const nameToIndex = new Map<string, number>()
    for (const cell of notebook.getCells()) {
      const r = stored?.get(cell.document.uri.toString())
      if (r) byIndex.set(cell.index, r)
      const n = cellName(cell)
      if (n && !nameToIndex.has(n)) nameToIndex.set(n, cell.index)
    }
    return { byIndex, nameToIndex }
  }

  private interruptHandler(notebook: vscode.NotebookDocument): void {
    const key = notebook.uri.toString()
    const ac = this.runningAbortControllers.get(key)
    if (ac) ac.abort()
    log.debug(`SAP Data Workbook: interrupted execution for ${key}`)
  }

  private async executeHandler(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    const notebookKey = notebook.uri.toString()

    const existing = this.runningAbortControllers.get(notebookKey)
    if (existing) existing.abort()

    const generation = (this.runGeneration.get(notebookKey) ?? 0) + 1
    this.runGeneration.set(notebookKey, generation)

    if (!this.cellResults.has(notebookKey)) {
      this.cellResults.set(notebookKey, new Map())
    }

    const abortController = new AbortController()
    this.runningAbortControllers.set(notebookKey, abortController)
    const finish = () => {
      if (this.runGeneration.get(notebookKey) === generation) {
        this.runningAbortControllers.delete(notebookKey)
      }
    }

    // ---- system plan -------------------------------------------------------------
    let effective = effectiveSystems(notebook)
    const sqlCells = cells.filter(c => c.document.languageId === SQL_LANGUAGE_ID)
    const isMultiCellRun = cells.length > 1
    const planFor = () =>
      buildRunPlan(
        cells.map(c => ({
          index: c.index,
          needsSystem: c.document.languageId === SQL_LANGUAGE_ID
        })),
        effective
      )
    let plan = planFor()

    const missing = missingSystems(plan, isSystemConnected)
    if (sqlCells.length > 0 && missing.length > 0) {
      // Offer to point each unknown marker at a connected system (and save it in the workbook).
      const remapped = await remapMissingMarkers(notebook, missing)
      if (!remapped) {
        const connected = [...connectedRoots().keys()]
        const msg =
          `System marker${missing.length > 1 ? "s" : ""} ${missing.map(m => `'${m}'`).join(", ")} ` +
          `${missing.length > 1 ? "are" : "is"} not connected in this window` +
          (connected.length
            ? ` (connected: ${connected.join(", ")})`
            : " (no SAP system connected)") +
          `. Click the marker in the cell status bar to pick a connected system, or connect it with 'ABAP FS: Connect to an SAP system'.`
        window.showErrorMessage(msg)
        for (const c of sqlCells) this.markCellAs(c, msg)
        finish()
        return
      }
      effective = effectiveSystems(notebook)
      plan = planFor()
    }

    const assignedSql = sqlCells.filter(c => effective[c.index]?.system)
    const unassignedSql = sqlCells.filter(c => !effective[c.index]?.system)

    // Multi-cell run with system assignments: one confirmation showing the whole plan.
    if (isMultiCellRun && assignedSql.length > 0) {
      const confirm = await window.showWarningMessage(
        `Run ${cells.length} cells with this system plan?`,
        { modal: true, detail: describePlan(plan) },
        "Yes, run"
      )
      if (confirm !== "Yes, run") {
        finish()
        return
      }
    }

    // Cells without an assigned system keep the original behaviour: pick a system
    // (once for multi-cell runs, per cell for single runs).
    let sharedConnection: ResolvedConnection | undefined
    if (isMultiCellRun && unassignedSql.length > 0) {
      try {
        sharedConnection = await resolveConnection()
      } catch (error: any) {
        if (!(error instanceof NotebookConnectionError)) {
          vscode.window.showErrorMessage(`Connection failed: ${error.message || error}`)
        }
        finish()
        return
      }
    }

    let failed = false
    for (const cell of cells) {
      if (abortController.signal.aborted) {
        this.markCellAs(cell, "Interrupted by user.")
        continue
      }

      if (failed) {
        this.markCellAs(cell, "Skipped — a previous cell failed.")
        continue
      }

      const success = await this.executeCell(
        cell,
        notebook,
        notebookKey,
        abortController.signal,
        effective[cell.index]?.system,
        sharedConnection
      )
      if (!success) failed = true
    }

    finish()
  }

  private markCellAs(cell: vscode.NotebookCell, message: string): void {
    const exec = this.controller.createNotebookCellExecution(cell)
    exec.start(Date.now())
    exec.replaceOutput([renderErrorOutput(message)])
    exec.end(false, Date.now())
  }

  private async connectionFor(
    system: string | undefined,
    sharedConnection: ResolvedConnection | undefined
  ): Promise<ResolvedConnection> {
    if (system) {
      const key = formatKey(system)
      if (!connectedRoots().has(key)) {
        throw new NotebookConnectionError(
          `SAP system '${system}' is not connected in this window. Connect it and run again.`
        )
      }
      return { connectionId: key, client: await getOrCreateClient(key) }
    }
    if (sharedConnection) return sharedConnection
    return resolveConnection()
  }

  private async executeCell(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    notebookKey: string,
    abortSignal: AbortSignal,
    system: string | undefined,
    sharedConnection?: ResolvedConnection
  ): Promise<boolean> {
    const exec = this.controller.createNotebookCellExecution(cell)
    let ended = false
    let success = false

    const counter = (this.executionCounters.get(notebookKey) ?? 0) + 1
    this.executionCounters.set(notebookKey, counter)

    exec.start(Date.now())
    exec.executionOrder = counter

    const endExec = (
      ok: boolean,
      output: vscode.NotebookCellOutput | vscode.NotebookCellOutput[]
    ) => {
      if (ended) return
      ended = true
      success = ok
      exec.replaceOutput(Array.isArray(output) ? output : [output])
      exec.end(ok, Date.now())
    }

    const cancelListener = exec.token.onCancellationRequested(() => {
      endExec(false, renderErrorOutput("Cancelled by user."))
      const ac = this.runningAbortControllers.get(notebookKey)
      if (ac) ac.abort()
    })

    const onAbort = () => {
      endExec(false, renderErrorOutput("Interrupted by user."))
    }
    abortSignal.addEventListener("abort", onAbort, { once: true })

    const cleanup = () => {
      cancelListener.dispose()
      abortSignal.removeEventListener("abort", onAbort)
    }

    if (exec.token.isCancellationRequested || abortSignal.aborted) {
      endExec(false, renderErrorOutput("Interrupted by user."))
      cleanup()
      return false
    }

    try {
      const language = cell.document.languageId
      const code = cell.document.getText()
      const maxRows = cell.metadata?.maxRows as number | undefined

      if (language !== SQL_LANGUAGE_ID && language !== "javascript") {
        endExec(
          false,
          renderErrorOutput(
            `Unsupported cell language "${language}". Only "abap-sql" and "javascript" cells can be executed.`
          )
        )
        cleanup()
        return false
      }

      const view = this.getResultsView(notebook)
      const settings = renderSettings()
      let cellResult: CellResult
      const isSql = language === SQL_LANGUAGE_ID

      if (isSql) {
        let connection: ResolvedConnection
        try {
          connection = await this.connectionFor(system, sharedConnection)
        } catch (error: any) {
          endExec(
            false,
            renderErrorOutput(
              error instanceof NotebookConnectionError
                ? error
                : new Error(`Connection failed: ${error.message || error}`)
            )
          )
          cleanup()
          return false
        }
        cellResult = await executeSqlCell(
          code,
          connection.client,
          cell.index,
          view.byIndex,
          maxRows,
          view.nameToIndex
        )
        cellResult.system = connection.connectionId
      } else {
        cellResult = await executeJsCell(
          code,
          cell.index,
          view.byIndex,
          abortSignal,
          view.nameToIndex
        )
      }

      if (!ended) {
        this.cellResults.get(notebookKey)?.set(cell.document.uri.toString(), cellResult)
        if (!isSql && cellResult.error) {
          // JS errors used to render as a bare "undefined"; show the actual message.
          const logs = cellResult.logs?.length ? cellResult.logs.join("\n") + "\n" : ""
          endExec(false, renderErrorOutput(logs + cellResult.error))
        } else {
          endExec(
            true,
            isSql ? renderSqlOutput(cellResult, settings) : renderJsOutputs(cellResult, settings)
          )
        }
      }
    } catch (error: any) {
      const msg = error?.message || String(error)
      log.debug(`SAP Data Workbook cell ${cell.index} error: ${msg}`)
      endExec(false, renderErrorOutput(error instanceof Error ? error : new Error(msg)))
    }

    cleanup()
    return success
  }

  clearResults(notebookUri: string): void {
    log.debug(`📒 [Controller] clearResults: ${notebookUri}`)
    this.cellResults.delete(notebookUri)
    this.executionCounters.delete(notebookUri)
    const ac = this.runningAbortControllers.get(notebookUri)
    if (ac) ac.abort()
    this.runningAbortControllers.delete(notebookUri)
    this.runGeneration.delete(notebookUri)
  }
}

export { normalizeSystem }
