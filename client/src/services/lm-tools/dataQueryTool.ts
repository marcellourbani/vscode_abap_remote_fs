/**
 * Execute Data Query Tool
 * Jarvis-like SAP Data Access with Dynamic Webviews
 */

import * as vscode from "vscode"
import * as ExcelJS from "exceljs"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { WebviewManager, RowRange, SortColumn, ColumnFilter } from "../webviewManager"
import { getClient } from "../../adt/conections"
import { getSAPSystemInfo } from "../sapSystemInfo"
import { funWindow as window } from "../funMessenger"
import { assertToolInvocationAuthorized } from "./toolGuard"

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
    const {
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
      resetFilters
    } = options.input

    if (!displayMode || !["internal", "ui", "download_to_file"].includes(displayMode)) {
      throw new Error('displayMode must be "internal", "ui", or "download_to_file"')
    }

    // Internal mode validations
    if (displayMode === "internal") {
      if (!sql) {
        throw new Error(
          ' Internal mode requires SQL query. Use displayMode "ui" to display data or work with webviews.'
        )
      }
      if (webviewId) {
        throw new Error(
          ' LOGICAL CONFLICT: displayMode "internal" is for SQL execution without UI. Use displayMode "ui" to work with webviews.'
        )
      }
      if (data) {
        throw new Error(
          ' LOGICAL CONFLICT: displayMode "internal" is for SQL execution only. Use displayMode "ui" to display data to user.'
        )
      }
    }

    // UI mode validations
    if (displayMode === "ui" && !webviewId && !sql && !data) {
      throw new Error("UI mode requires SQL query, direct data, or existing webviewId")
    }

    // download_to_file mode validations
    if (displayMode === "download_to_file") {
      if (!options.input.filePath) {
        throw new Error('download_to_file mode requires "filePath" (absolute path or file:// URI)')
      }
      if (!options.input.fileType || !["xlsx", "csv"].includes(options.input.fileType)) {
        throw new Error('download_to_file mode requires "fileType" to be "xlsx" or "csv"')
      }
      if (/\.[a-z0-9]+$/i.test(options.input.filePath)) {
        throw new Error(
          "filePath must NOT include an extension — we append it from fileType. Pass e.g. 'C:/tmp/mara', not 'C:/tmp/mara.xlsx'."
        )
      }
      if (webviewId) {
        throw new Error(
          "download_to_file mode is for SQL/data → file export; do not pass webviewId"
        )
      }
      if (!sql && !data) {
        throw new Error("download_to_file mode requires either sql or data")
      }
    }

    if (sql && data) {
      throw new Error("Cannot provide both SQL query and direct data - choose one")
    }

    if (sql) {
      if (typeof sql !== "string" || sql.trim().length === 0) {
        throw new Error("SQL query must be a non-empty string if provided")
      }

      const upperSQL = sql.toUpperCase().trim()
      const dangerousPatterns = [
        /\bDROP\s+/i,
        /\bDELETE\s+(?!.*\bFROM\s+@)/i,
        /\bINSERT\s+/i,
        /\bUPDATE\s+/i,
        /\bALTER\s+/i,
        /\bCREATE\s+/i,
        /\bTRUNCATE\s+/i,
        /;\s*(?!$)/i,
        /--/i,
        /\/\*/i
      ]

      for (const pattern of dangerousPatterns) {
        if (pattern.test(upperSQL)) {
          throw new Error(
            `SQL query contains dangerous operation. Only SELECT and WITH statements are allowed.`
          )
        }
      }

      if (!upperSQL.startsWith("SELECT") && !upperSQL.startsWith("WITH")) {
        throw new Error("Only SELECT and WITH statements are allowed")
      }
    }

    if (data) {
      if (!data.columns || !Array.isArray(data.columns) || data.columns.length === 0) {
        throw new Error("data.columns must be a non-empty array")
      }
      if (!data.values || !Array.isArray(data.values)) {
        throw new Error("data.values must be an array")
      }
      for (const col of data.columns) {
        if (!col.name || typeof col.name !== "string") {
          throw new Error("Each column must have a name (string)")
        }
        if (!col.type || typeof col.type !== "string") {
          throw new Error("Each column must have a type (string)")
        }
      }
    }

    if (displayMode === "internal" && !rowRange) {
      throw new Error(
        " CRITICAL: rowRange is MANDATORY for internal mode to prevent accidental large data transfers that could overwhelm the system. You MUST specify start and end rows (e.g., {start: 0, end: 10}) to analyze specific data ranges."
      )
    }

    if (maxRows !== undefined && (typeof maxRows !== "number" || maxRows < 1 || maxRows > 50000)) {
      throw new Error(
        "maxRows must be a number between 1 and 50000 (safety limit, not added to SQL)"
      )
    }

    if (rowRange) {
      if (
        typeof rowRange.start !== "number" ||
        typeof rowRange.end !== "number" ||
        rowRange.start < 0 ||
        rowRange.end <= rowRange.start
      ) {
        throw new Error("rowRange must have valid start and end numbers with end > start >= 0")
      }

      const rowRangeSize = rowRange.end - rowRange.start
      if (displayMode === "internal" && rowRangeSize > 1000) {
        throw new Error(
          ` SAFETY LIMIT: Internal mode rowRange cannot exceed 1000 rows. Requested: ${rowRangeSize} rows (${rowRange.start} to ${rowRange.end}). Break large analysis into smaller chunks.`
        )
      }
    }

    if (sortColumns && !Array.isArray(sortColumns)) {
      throw new Error("sortColumns must be an array")
    }

    if (filters && !Array.isArray(filters)) {
      throw new Error("filters must be an array")
    }

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
          `Query: ${sqlPreview}`,
        { modal: true },
        { title: "Run & Send results to Copilot", action: "proceed" },
        { title: "Run & Show in UI Only", action: "ui_only" },
        { title: "Cancel", action: "cancel", isCloseAffordance: true }
      )

      if (!choice || choice.action === "cancel") {
        return { action: "cancel" }
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
    registerToolWithRegistry("execute_data_query", new ExecuteDataQueryTool())
  )
}

// ============================================================================
// FILE WRITERS (cross-platform: return bytes, caller writes via workspace.fs)
// ============================================================================

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/
const SAP_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/ // YYYYMMDD (SAP raw DATS)
const SAP_TIME_RE = /^(\d{2})(\d{2})(\d{2})$/ // HHMMSS   (SAP raw TIMS)

/**
 * Format one raw cell value the same way the UI does, defensively.
 *
 * The ADT client has been observed to return date/time columns as:
 *   - a Date object,
 *   - an ISO string "2024-12-05T00:00:00.000Z",
 *   - a Date.prototype.toString() output "Thu Dec 05 2024 05:30:00 GMT+0530 (…)",
 *   - the raw SAP form ("20241205" / "141859"),
 *   - empty string / null for missing values.
 *
 * We do NOT call `new Date(anyString)` speculatively — SAP "141859" would be
 * parsed as year 141859, producing garbage.
 */
function formatCell(value: any, type: string | undefined): string {
  if (value == null) return ""
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return ""
    return formatFromParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      type
    )
  }
  const s = String(value).trim()
  if (!s || s === "Invalid Date") return ""

  // 1. ISO string
  const iso = ISO_RE.exec(s)
  if (iso) {
    return formatFromParts(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +iso[6], type)
  }

  // 2. Date.prototype.toString() output — parse defensively, only when it
  //    starts with a weekday abbreviation. Handled before SAP raw so a stringified
  //    Date in a D/T column isn't dropped as junk.
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(s)) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      return formatFromParts(
        d.getFullYear(),
        d.getMonth() + 1,
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
        type
      )
    }
    return ""
  }

  // 3. Raw SAP forms — trust the column type over the shape
  if (type === "D") {
    if (s === "00000000") return "" // SAP null-date marker
    const m = SAP_DATE_RE.exec(s)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return "" // unknown junk in a date column: drop it
  }
  if (type === "T") {
    if (s === "000000") return "" // SAP null-time marker
    const m = SAP_TIME_RE.exec(s)
    if (m) return `${m[1]}:${m[2]}:${m[3]}`
    return ""
  }

  // 4. Anything else: pass through untouched (numbers, text, material numbers, etc.)
  return s
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n)
}

function formatFromParts(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  se: number,
  type: string | undefined
): string {
  if (type === "D") return `${pad2(d)}-${pad2(mo)}-${y}`
  if (type === "T") return `${pad2(h)}:${pad2(mi)}:${pad2(se)}`
  // TIMESTAMP or unknown — keep an unambiguous, locale-free ISO-ish form.
  return `${y}-${pad2(mo)}-${pad2(d)} ${pad2(h)}:${pad2(mi)}:${pad2(se)}`
}

async function buildXlsx(
  columns: Array<{ name: string; type?: string }>,
  values: Array<Record<string, any>>
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Data")
  const names = columns.map(c => c.name)
  ws.addRow(names)
  // Every cell as text (numFmt '@') so Excel does not reinterpret SAP values —
  // leading-zero material numbers stay intact, dates keep their dd-mm-yyyy form.
  for (const row of values) {
    const r = ws.addRow(columns.map(c => formatCell(row[c.name], c.type)))
    r.eachCell({ includeEmpty: true }, cell => {
      cell.numFmt = "@"
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

function buildCsv(
  columns: Array<{ name: string; type?: string }>,
  values: Array<Record<string, any>>
): Uint8Array {
  const esc = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)
  const names = columns.map(c => c.name)
  const lines: string[] = [names.map(esc).join(",")]
  for (const row of values) {
    lines.push(columns.map(c => esc(formatCell(row[c.name], c.type))).join(","))
  }
  // BOM for Excel compatibility, LF line endings
  return new TextEncoder().encode("\uFEFF" + lines.join("\n"))
}
