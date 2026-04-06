/**
 * SQL cell executor. Runs ABAP SQL via ADT's datapreview API.
 *
 * NOTE: ADT HTTP requests cannot be aborted mid-flight. When a user
 * cancels execution, the UI shows "Interrupted" immediately but the
 * SAP-side query runs to completion. The result is discarded by the
 * controller (not stored in cellResults). This matches the behavior
 * of SE16N and the existing execute_data_query LM tool.
 */

import { ADTClient } from "abap-adt-api"
import { CellResult, DEFAULT_MAX_ROWS } from "./types"
import { interpolateSql } from "./interpolation"

export async function executeSqlCell(
  rawSql: string,
  client: ADTClient,
  cellIndex: number,
  cellResults: Map<number, CellResult>,
  maxRows?: number
): Promise<CellResult> {
  const sql = interpolateSql(rawSql, cellResults)

  validateSql(sql)

  const ADT_MAX_ROWS_LIMIT = 10_000_000
  const limit = typeof maxRows === "number" && maxRows > 0 && isFinite(maxRows)
    ? Math.min(Math.floor(maxRows), ADT_MAX_ROWS_LIMIT)
    : DEFAULT_MAX_ROWS
  const result = await client.runQuery(sql, limit, true)

  if (!result || !result.columns) {
    return { result: [], rowCount: 0, columns: [] }
  }

  const columns = result.columns.map((col: any) => ({
    name: typeof col === "string" ? col : col.name || col.COLUMN_NAME || String(col),
    type: typeof col === "object" ? col.type || "C" : "C"
  }))

  const values = result.values || []

  return {
    result: values,
    rowCount: values.length,
    columns
  }
}

function validateSql(sql: string): void {
  const trimmed = sql.trim()
  if (!trimmed) {
    throw new Error("SQL cell is empty")
  }

  const withoutComments = stripComments(trimmed)
  const firstWord = withoutComments.trim().split(/\s/)[0]?.toUpperCase()

  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    throw new Error("Only SELECT and WITH statements are allowed in SQL cells")
  }

  const stripped = stripStringLiterals(withoutComments)

  const dangerousKeywords = [
    "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE"
  ]

  for (const kw of dangerousKeywords) {
    const pattern = new RegExp(`\\b${kw}\\b`, "i")
    if (pattern.test(stripped)) {
      throw new Error(
        `SQL contains '${kw}'. Only SELECT and WITH statements are allowed.`
      )
    }
  }

  if (stripped.includes(";")) {
    throw new Error(
      "Semicolons are not allowed in ABAP SQL queries. Remove any trailing semicolons."
    )
  }
}

function stripComments(sql: string): string {
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ")
  result = result.replace(/--[^\n]*/g, " ")
  return result
}

function stripStringLiterals(sql: string): string {
  return sql.replace(/'([^']|'')*'/g, "''")
}
