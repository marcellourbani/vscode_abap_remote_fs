export interface QueryClient {
  runQuery(
    sql: string,
    maxRows: number,
    decode?: boolean
  ): Promise<{ values?: Record<string, unknown>[] }>
}
export const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`
export const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error("Analysis paused")
}
export const queryRowLimit = (count: number) => {
  const limit = count + 1000
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(limit))
    throw new Error("SAP returned an invalid row count")
  return limit
}
export const verifyFetchedRowCount = (actual: number, count: number) => {
  if (actual < count)
    throw new Error(
      `Incomplete extraction: expected at least ${count} rows, received ${actual}; the data changed or SAP truncated the result`
    )
  const limit = queryRowLimit(count)
  if (actual >= limit)
    throw new Error(
      `The result reached the ${limit}-row request limit and may be incomplete. Run the query again.`
    )
}

export async function countedQuery(
  client: QueryClient,
  table: string,
  columns: string[],
  where = "",
  signal?: AbortSignal,
  progress?: (completed: number, total: number) => void | Promise<void>
): Promise<Record<string, string>[]> {
  const execute = async (sql: string, limit: number) => {
    abortIfNeeded(signal)
    if (sql.length > 255)
      throw new Error(`SAP query exceeds the 255-character limit (${sql.length}); narrow the scope`)
    const result = await client.runQuery(sql, limit, true)
    abortIfNeeded(signal)
    if (!Array.isArray(result?.values)) throw new Error("SAP query did not return a result set")
    return result.values.map(row =>
      Object.fromEntries(
        Object.entries(row).map(([name, value]) => [name.toUpperCase(), String(value ?? "").trim()])
      )
    )
  }
  const count = await execute(
    `SELECT COUNT(*) AS total FROM ${table}${where ? ` WHERE ${where}` : ""}`,
    1
  )
  const total = Number(count[0]?.TOTAL)
  const limit = queryRowLimit(total)
  await progress?.(0, total)
  abortIfNeeded(signal)
  const rows = await execute(
    `SELECT ${columns.join(",")} FROM ${table}${where ? ` WHERE ${where}` : ""}`,
    limit
  )
  verifyFetchedRowCount(rows.length, total)
  await progress?.(rows.length, rows.length)
  abortIfNeeded(signal)
  return rows
}
