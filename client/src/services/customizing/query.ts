import type { ADTClient, QueryResult } from "abap-adt-api"
import { getOrCreateClient } from "../../adt/conections"

export async function ensureConnected(connectionId?: string, clone = true): Promise<ADTClient> {
  if (!connectionId?.trim())
    throw new Error("connectionId is required. Choose an SAP connection explicitly.")
  return getOrCreateClient(connectionId.trim().toLowerCase(), clone)
}

export function objectName(value: string): string {
  const name = value.trim().toUpperCase()
  if (!/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/.test(name) || name.length > 120)
    throw new Error("Invalid SAP object or field name")
  return name
}

export function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

/** ADT already owns authentication and SQL execution. Stateless queries avoid subpool exhaustion. */
export async function runSql(client: ADTClient, sql: string, maxRows = 200): Promise<QueryResult> {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000)
    throw new Error("maxRows must be an integer between 1 and 10000")
  return client.statelessClone.runQuery(sql, maxRows, false)
}

export function tableRows(result: QueryResult): Record<string, string>[] {
  return (result.values ?? []).map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.toUpperCase(), String(value ?? "").trimEnd()])
    )
  )
}

export function col(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) if (row[name] !== undefined) return row[name]
  return ""
}

export function formatQueryResult(result: QueryResult): string {
  return JSON.stringify({ columns: result.columns, rows: result.values }, null, 2)
}
