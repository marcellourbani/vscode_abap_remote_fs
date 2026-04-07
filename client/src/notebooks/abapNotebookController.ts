import * as vscode from "vscode"
import { NOTEBOOK_TYPE, CellResult, SQL_LANGUAGE_ID } from "./types"
import { resolveConnection, ResolvedConnection } from "./connectionResolver"
import { executeSqlCell } from "./sqlCellExecutor"
import { executeJsCell } from "./jsCellExecutor"
import { renderSqlOutput, renderJsOutput, renderErrorOutput } from "./outputRenderer"
import { log } from "../lib"
import { funWindow as window } from "../services/funMessenger"

export class AbapNotebookController {
  private readonly controller: vscode.NotebookController
  private readonly cellResults = new Map<string, Map<number, CellResult>>()
  private readonly notebookConnections = new Map<string, ResolvedConnection>()
  private readonly executionCounters = new Map<string, number>()
  private readonly runningAbortControllers = new Map<string, AbortController>()
  private readonly runGeneration = new Map<string, number>()
  private statusBarItem: vscode.StatusBarItem | undefined
  private editorListener: vscode.Disposable | undefined
  private lastActiveNotebookKey: string | undefined

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

    this.editorListener = window.onDidChangeActiveNotebookEditor(editor => {
      if (editor && editor.notebook.notebookType === NOTEBOOK_TYPE) {
        const notebookKey = editor.notebook.uri.toString()
        if (this.lastActiveNotebookKey && this.lastActiveNotebookKey !== notebookKey) {
          // Switched to a different notebook — clear the old one
          this.notebookConnections.delete(this.lastActiveNotebookKey)
        }
        if (!this.lastActiveNotebookKey || this.lastActiveNotebookKey !== notebookKey) {
          // Coming back from a non-notebook or a different notebook — clear this one too
          this.notebookConnections.delete(notebookKey)
        }
        this.lastActiveNotebookKey = notebookKey
        const conn = this.notebookConnections.get(notebookKey)
        if (conn) this.updateStatusBar(conn.connectionId)
        else this.hideStatusBar()
      } else {
        // Left the notebook — mark it so next return clears cache
        this.lastActiveNotebookKey = undefined
        this.hideStatusBar()
      }
    })
  }

  dispose(): void {
    this.controller.dispose()
    this.statusBarItem?.dispose()
    this.editorListener?.dispose()
    for (const ac of this.runningAbortControllers.values()) ac.abort()
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
    const results = this.cellResults.get(notebookKey)!

    const abortController = new AbortController()
    this.runningAbortControllers.set(notebookKey, abortController)

    let connection: ResolvedConnection | undefined
    try {
      connection = await this.ensureConnection(notebook)
    } catch (error: any) {
      window.showErrorMessage(error.message)
      if (this.runGeneration.get(notebookKey) === generation) {
        this.runningAbortControllers.delete(notebookKey)
      }
      return
    }

    this.updateStatusBar(connection.connectionId)

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
        cell, connection, results, notebookKey, abortController.signal
      )
      if (!success) failed = true
    }

    if (this.runGeneration.get(notebookKey) === generation) {
      this.runningAbortControllers.delete(notebookKey)
    }
  }

  private markCellAs(cell: vscode.NotebookCell, message: string): void {
    const exec = this.controller.createNotebookCellExecution(cell)
    exec.start(Date.now())
    exec.replaceOutput([renderErrorOutput(message)])
    exec.end(false, Date.now())
  }

  private async executeCell(
    cell: vscode.NotebookCell,
    connection: ResolvedConnection,
    results: Map<number, CellResult>,
    notebookKey: string,
    abortSignal: AbortSignal
  ): Promise<boolean> {
    const exec = this.controller.createNotebookCellExecution(cell)
    let ended = false
    let success = false

    const counter = (this.executionCounters.get(notebookKey) ?? 0) + 1
    this.executionCounters.set(notebookKey, counter)

    exec.start(Date.now())
    exec.executionOrder = counter

    const endExec = (ok: boolean, output: vscode.NotebookCellOutput) => {
      if (ended) return
      ended = true
      success = ok
      exec.replaceOutput([output])
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

    if (exec.token.isCancellationRequested || abortSignal.aborted) {
      endExec(false, renderErrorOutput("Interrupted by user."))
      cancelListener.dispose()
      abortSignal.removeEventListener("abort", onAbort)
      return false
    }

    try {
      const language = cell.document.languageId
      const code = cell.document.getText()
      const maxRows = cell.metadata?.maxRows as number | undefined

      if (language !== SQL_LANGUAGE_ID && language !== "javascript") {
        endExec(false, renderErrorOutput(
          `Unsupported cell language "${language}". Only "abap-sql" and "javascript" cells can be executed.`
        ))
        cancelListener.dispose()
        abortSignal.removeEventListener("abort", onAbort)
        return false
      }

      let cellResult: CellResult

      const isSql = language === SQL_LANGUAGE_ID
      if (isSql) {
        cellResult = await executeSqlCell(
          code, connection.client, cell.index, results, maxRows
        )
      } else {
        cellResult = await executeJsCell(code, cell.index, results, abortSignal)
      }

      if (!ended) {
        results.set(cell.index, cellResult)
        const output = isSql
          ? renderSqlOutput(cellResult)
          : renderJsOutput(cellResult)
        endExec(true, output)
      }
    } catch (error: any) {
      const msg = error?.message || String(error)
      log.debug(`SAP Data Workbook cell ${cell.index} error: ${msg}`)
      endExec(false, renderErrorOutput(error instanceof Error ? error : new Error(msg)))
    }

    cancelListener.dispose()
    abortSignal.removeEventListener("abort", onAbort)
    return success
  }

  private async ensureConnection(
    notebook: vscode.NotebookDocument
  ): Promise<ResolvedConnection> {
    const notebookKey = notebook.uri.toString()
    const existing = this.notebookConnections.get(notebookKey)
    if (existing) return existing

    const connection = await resolveConnection()
    this.notebookConnections.set(notebookKey, connection)
    return connection
  }

  private updateStatusBar(connectionId: string): void {
    if (!this.statusBarItem) {
      this.statusBarItem = window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
      )
    }
    this.statusBarItem.text = `$(database) SAP Data Notebook System: ${connectionId}`
    this.statusBarItem.tooltip = `Connected to: ${connectionId} — click to disconnect`
    this.statusBarItem.command = "abapfs.notebookClearConnection"
    this.statusBarItem.show()
    log.debug(`📒 [Controller] statusBar shown: SAP: ${connectionId}`)
  }

  private hideStatusBar(): void {
    this.statusBarItem?.hide()
    log.debug(`📒 [Controller] statusBar hidden`)
  }

  clearCachedConnection(notebookUri: string): void {
    log.debug(`📒 [Controller] clearCachedConnection: ${notebookUri}`)
    this.notebookConnections.delete(notebookUri)
    this.hideStatusBar()
  }

  clearResults(notebookUri: string): void {
    log.debug(`📒 [Controller] clearResults: ${notebookUri}`)
    this.cellResults.delete(notebookUri)
    this.notebookConnections.delete(notebookUri)
    this.executionCounters.delete(notebookUri)
    const ac = this.runningAbortControllers.get(notebookUri)
    if (ac) ac.abort()
    this.runningAbortControllers.delete(notebookUri)
    this.runGeneration.delete(notebookUri)
  }
}
