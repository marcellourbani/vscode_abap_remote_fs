/**
 * Execute Data Query Tool
 * Jarvis-like SAP Data Access with Dynamic Webviews
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { validateDataQueryInput } from "./dataQueryValidation"
import { logTelemetry } from "../telemetry"
import {
  WebviewManager,
  type RowRange,
  type SortColumn,
  type ColumnFilter
} from "../webviewManager"
import { getClient } from "../../adt/conections"
import { getSAPSystemInfo } from "../sapSystemInfo"
import { funWindow as window } from "../funMessenger"
import { assertToolInvocationAuthorized } from "./toolGuard"
import {
  configureProductionSqlControlForConnection,
  getProductionSqlPreference
} from "../productionSqlControl"
import { buildCsv, buildXlsx } from "../structuredDataExportService"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IExecuteDataQueryParameters {
  sql?: string
  data?: {
    columns: Array<{
      name: string
      type: string
      description?: string
    }>
    values: Array<Record<string, any>>
  }
  displayMode: "internal" | "ui" | "download_to_file"
  webviewId?: string
  connectionId?: string
  title?: string
  maxRows?: number
  /** Required when displayMode = 'download_to_file'. Absolute local path (e.g. 'C:/tmp/mara.xlsx') */
  filePath?: string
  /** Required when displayMode = 'download_to_file'. 'xlsx' or 'csv'. */
  fileType?: "xlsx" | "csv"
  rowRange?: {
    start: number
    end: number
  }
  sortColumns?: Array<{
    column: string
    direction: "asc" | "desc"
  }>
  filters?: Array<{
    column: string
    value: string
  }>
  resetSorting?: boolean
  resetFilters?: boolean
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔍 EXECUTE DATA QUERY TOOL - Jarvis-like SAP Data Access with Dynamic Webviews
 */
export class ExecuteDataQueryTool implements vscode.LanguageModelTool<IExecuteDataQueryParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IExecuteDataQueryParameters>,
    _token: vscode.CancellationToken
  ) {
    const { data, displayMode, webviewId } = options.input
    validateDataQueryInput(options.input)

    const action = webviewId
      ? "manipulating existing data"
      : data
        ? "displaying provided data"
        : "executing new query"
    let msg: string
    if (displayMode === "ui") {
      msg = `${action} and displaying results in ${webviewId ? "existing" : "new"} webview...`
    } else if (displayMode === "download_to_file") {
      msg = `${action} and writing results to ${options.input.filePath} (${options.input.fileType})...`
    } else {
      msg = `${action} and returning specific rows internally...`
    }
    return { invocationMessage: msg }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IExecuteDataQueryParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    validateDataQueryInput(options.input)
    try {
      let {
        sql,
        data,
        displayMode,
        webviewId,
        connectionId,
        title,
        maxRows,
        rowRange,
        sortColumns,
        filters,
        resetSorting,
        resetFilters,
        filePath,
        fileType
      } = options.input
      logTelemetry("tool_execute_data_query_called", { connectionId })

      if (connectionId) {
        connectionId = connectionId.toLowerCase()
      }

      // ========================================================================
      // PRODUCTION SYSTEM GUARD
      // Only check in internal mode - that's when data is sent back to Copilot
      // UI mode is fine - user sees data directly, not sent to Copilot
      // ========================================================================
      let switchedToUiMode = false
      if (sql && connectionId && displayMode === "internal") {
        const guardResult = await this.checkProductionGuard(sql, connectionId)
        if (guardResult.action === "cancel") {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              "Query cancelled by user. The system is a production system and user chose not to run the query."
            )
          ])
        }
        if (guardResult.action === "ui_only") {
          displayMode = "ui"
          switchedToUiMode = true
          // Adjust rowRange since UI mode doesn't require it
          rowRange = undefined
        }
        // action === 'proceed' means continue as normal
      }

      const isNewData = !webviewId || !!sql || !!data

      if (displayMode === "download_to_file") {
        return await this.downloadToFile(
          sql,
          data,
          connectionId,
          maxRows,
          rowRange,
          filePath!,
          fileType!
        )
      }

      if (displayMode === "internal") {
        // ====================================================================
        // INTERNAL MODE: Direct SQL execution WITHOUT webview
        // No UI involved - execute query and return results to Copilot
        // ====================================================================
        return await this.executeQueryDirectly(sql!, connectionId, rowRange, maxRows)
      } else {
        // UI MODE
        const webviewManager = WebviewManager.getInstance()

        let result
        if (isNewData && (sql || data)) {
          if (data) {
            result = await webviewManager.createOrUpdateWebview(
              data,
              "DATA_INPUT",
              "",
              webviewId,
              title,
              maxRows,
              rowRange as RowRange,
              sortColumns as SortColumn[],
              filters as ColumnFilter[],
              resetSorting,
              resetFilters
            )
          } else if (sql) {
            let targetConnectionId = connectionId || "default"
            const client = getClient(targetConnectionId)
            if (!client) {
              throw new Error(`No client found for connection: ${targetConnectionId}`)
            }

            result = await webviewManager.createOrUpdateWebview(
              client,
              sql,
              targetConnectionId,
              webviewId,
              title,
              maxRows,
              rowRange as RowRange,
              sortColumns as SortColumn[],
              filters as ColumnFilter[],
              resetSorting,
              resetFilters
            )
          } else {
            throw new Error("Either SQL or data must be provided for new data")
          }
        } else {
          result = await webviewManager.manipulateWebview(
            webviewId!,
            rowRange as RowRange,
            sortColumns as SortColumn[],
            filters as ColumnFilter[],
            resetSorting,
            resetFilters
          )
        }

        const rowCount = result.data?.values?.length || 0
        const columnCount = result.data?.columns?.length || 0
        const action = webviewId && !sql ? "manipulated" : webviewId ? "updated" : "created"

        const response = {
          webviewId: result.webviewId,
          action,
          state: result.state || {
            returnedRows: rowCount,
            totalRows: rowCount,
            appliedSorting: sortColumns || [],
            appliedFilters: filters || []
          }
        }

        // If user chose "UI only" due to production guard, inform Copilot
        const guardNote = switchedToUiMode
          ? `\n\n PRODUCTION SYSTEM: User chose to view results in UI only. Data was NOT sent back to you for security reasons. The user can see the results in the webview.`
          : ""

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Webview ${action} successfully (ID: ${result.webviewId}). ` +
              `Displaying ${rowCount} rows with ${columnCount} columns.${guardNote}`
          ),
          new vscode.LanguageModelTextPart(
            `Current state: ${(sortColumns || []).length} sort(s), ${(filters || []).length} filter(s) applied.`
          ),
          new vscode.LanguageModelTextPart(JSON.stringify(response, null, 2))
        ])
      }
    } catch (error: any) {
      const errorMsg = error?.localizedMessage || error?.message || String(error)
      const webviewId = error?.webviewId

      const errorWithWebviewId = webviewId
        ? `Failed to execute data query: ${errorMsg} (webviewId: ${webviewId})`
        : `Failed to execute data query: ${errorMsg}`

      throw new Error(errorWithWebviewId)
    }
  }

  /**
   * Check if running SQL on a production system and prompt user for action
   * Only called for internal mode (when data is sent back to Copilot)
   * Returns: 'proceed' | 'ui_only' | 'cancel'
   */
  private async checkProductionGuard(
    sql: string,
    connectionId: string
  ): Promise<{ action: "proceed" | "ui_only" | "cancel" }> {
    try {
      if (getProductionSqlPreference(connectionId) === "allow") {
        return { action: "proceed" }
      }

      // Get system info (cached, so fast)
      const systemInfo = await getSAPSystemInfo(connectionId)

      // Check if production (category 'P' or contains 'Production')
      const isProduction =
        systemInfo.currentClient?.category === "Production" ||
        systemInfo.currentClient?.category?.startsWith("P")

      if (!isProduction) {
        return { action: "proceed" } // Not production, allow
      }

      // Production system detected - show dialog
      const clientInfo = systemInfo.currentClient
        ? `${connectionId.toUpperCase()} (Client ${systemInfo.currentClient.clientNumber}: ${systemInfo.currentClient.clientName})`
        : connectionId.toUpperCase()

      const sqlPreview = sql.length > 100 ? sql.substring(0, 100) + "..." : sql

      const choice = await window.showWarningMessage(
        ` PRODUCTION SYSTEM DETECTED\n\n` +
          `Copilot wants to run SQL on: ${clientInfo}\n\n` +
          `Query: ${sqlPreview}\n\n` +
          `To avoid this prompt in future, choose "Configure for this connection" or run ` +
          `"ABAP FS: Configure Production SQL Permission" from the Command Palette.`,
        { modal: true },
        { title: "Run & Send results to Copilot", action: "proceed" },
        { title: "Run & Show in UI Only", action: "ui_only" },
        { title: "Configure for this connection", action: "configure" },
        { title: "Cancel", action: "cancel", isCloseAffordance: true }
      )

      if (!choice || choice.action === "cancel") {
        return { action: "cancel" }
      }

      if (choice.action === "configure") {
        const preference = await configureProductionSqlControlForConnection(connectionId)
        return { action: preference === "allow" ? "proceed" : "cancel" }
      }

      return { action: choice.action as "proceed" | "ui_only" }
    } catch (error) {
      // If check fails, block query execution (fail-closed for security)
      console.warn("Production guard check failed:", error)
      return { action: "cancel" }
    }
  }

  /**
   * download_to_file mode: execute SQL (or take supplied data), write results
   * to a local xlsx or csv file. Cross-platform: uses vscode.workspace.fs.
   */
  private async downloadToFile(
    sql: string | undefined,
    data: IExecuteDataQueryParameters["data"],
    connectionId: string | undefined,
    maxRows: number | undefined,
    rowRange: { start: number; end: number } | undefined,
    filePath: string,
    fileType: "xlsx" | "csv"
  ): Promise<vscode.LanguageModelToolResult> {
    let columns: Array<{ name: string; type?: string }>
    let values: Array<Record<string, any>>

    if (data) {
      columns = data.columns
      values = data.values
    } else {
      const targetConnectionId = connectionId || "default"
      const client = getClient(targetConnectionId)
      if (!client) throw new Error(`No client found for connection: ${targetConnectionId}`)
      const limit = maxRows ?? 10000
      const result = await client.runQuery(sql!, limit, true)
      if (!result || !result.columns) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart("Query returned no results — file not written.")
        ])
      }
      columns = result.columns as Array<{ name: string; type?: string }>
      values = result.values ?? []
    }

    // Apply rowRange AFTER fetch (same semantics as internal/ui modes).
    if (rowRange) {
      values = values.slice(rowRange.start, rowRange.end)
    }

    if (values.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart("Query returned 0 rows — file not written.")
      ])
    }

    const finalPath = `${filePath}.${fileType}`
    const targetUri = finalPath.startsWith("file://")
      ? vscode.Uri.parse(finalPath)
      : vscode.Uri.file(finalPath)

    const bytes = fileType === "xlsx" ? await buildXlsx(columns, values) : buildCsv(columns, values)

    await vscode.workspace.fs.writeFile(targetUri, bytes)

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Wrote ${values.length} rows × ${columns.length} columns to ${targetUri.fsPath} (${fileType}).`
      )
    ])
  }

  /**
   * Execute SQL query directly without webview - for internal mode
   */
  private async executeQueryDirectly(
    sql: string,
    connectionId: string | undefined,
    rowRange: { start: number; end: number } | undefined,
    maxRows: number | undefined
  ): Promise<vscode.LanguageModelToolResult> {
    const targetConnectionId = connectionId || "default"
    const client = getClient(targetConnectionId)

    if (!client) {
      throw new Error(`No client found for connection: ${targetConnectionId}`)
    }

    // Calculate limit based on rowRange
    const limit = rowRange ? rowRange.end + 1 : maxRows || 100

    try {
      // Execute query directly
      const result = await client.runQuery(sql, limit, true)

      if (!result || !result.columns) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart("Query returned no results or empty result set.")
        ])
      }

      // Apply row range if specified
      let values = result.values || []
      const totalRows = values.length

      if (rowRange) {
        values = values.slice(rowRange.start, rowRange.end)
      }

      const response = {
        data: {
          columns: result.columns,
          values: values
        },
        state: {
          totalRows,
          returnedRows: values.length,
          rowRange
        }
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Query executed. Returned ${values.length} of ${totalRows} rows with ${result.columns.length} columns.`
        ),
        new vscode.LanguageModelTextPart(JSON.stringify(response, null, 2))
      ])
    } catch (error: any) {
      // Return SQL error to Copilot so it can fix and retry
      const errorMessage = error?.message || String(error)
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(` SQL Error: ${errorMessage}`)
      ])
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerDataQueryTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("abapfs_run_sql_query", new ExecuteDataQueryTool())
  )
}
