import type { IExecuteDataQueryParameters } from "./dataQueryTool"

/** Shared validation for Copilot preparation and direct MCP invocation. */
export function validateDataQueryInput(input: IExecuteDataQueryParameters): void {
  const { sql, data, displayMode, webviewId, maxRows, rowRange, sortColumns, filters } = input

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
    if (!input.filePath) {
      throw new Error('download_to_file mode requires "filePath" (absolute path or file:// URI)')
    }
    if (!input.fileType || !["xlsx", "csv"].includes(input.fileType)) {
      throw new Error('download_to_file mode requires "fileType" to be "xlsx" or "csv"')
    }
    if (/\.[a-z0-9]+$/i.test(input.filePath)) {
      throw new Error(
        "filePath must NOT include an extension — we append it from fileType. Pass e.g. 'C:/tmp/mara', not 'C:/tmp/mara.xlsx'."
      )
    }
    if (webviewId) {
      throw new Error("download_to_file mode is for SQL/data → file export; do not pass webviewId")
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

  if (maxRows !== undefined && (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 50000)) {
    throw new Error("maxRows must be a number between 1 and 50000 (safety limit, not added to SQL)")
  }

  if (rowRange) {
    if (
      !Number.isSafeInteger(rowRange.start) ||
      !Number.isSafeInteger(rowRange.end) ||
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
}
