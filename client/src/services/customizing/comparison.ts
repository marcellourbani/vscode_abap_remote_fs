// Adapted from abap-config-mcp, Copyright (c) 2026 Geert Steyaert (MIT).
import { ensureConnected, runSql, tableRows, objectName, sqlLiteral, col } from "./query"
import { resolveMaint } from "./resolver"

export interface ComparisonInput {
  connectionId: string
  objectName: string
  keyField: string
  sourceKey: string
  targetKey: string
  onlyMissing?: boolean
  maxRows?: number
}
export type Row = Record<string, string>

/** Array serialization avoids delimiter collisions and preserves blank versus missing fields. */
export function fingerprint(row: Row, fields: string[]): string {
  return JSON.stringify(fields.map(field => row[field] ?? null))
}

export function compareRows(source: Row[], target: Row[], keyFields: string[], scopeField: string) {
  const keys = keyFields.filter(field => field !== scopeField && field !== "MANDT")
  const targetIndex = new Map(target.map(row => [fingerprint(row, keys), row]))
  const sourceIndex = new Map(source.map(row => [fingerprint(row, keys), row]))
  const missing: Row[] = [],
    changed: { source: Row; target: Row }[] = [],
    identical: Row[] = []
  for (const row of source) {
    const other = targetIndex.get(fingerprint(row, keys))
    if (!other) {
      missing.push(row)
      continue
    }
    const fields = [...new Set([...Object.keys(row), ...Object.keys(other)])]
      .filter(field => field !== scopeField && field !== "MANDT")
      .sort()
    if (fingerprint(row, fields) === fingerprint(other, fields)) identical.push(row)
    else changed.push({ source: row, target: other })
  }
  return {
    missing,
    changed,
    identical,
    targetOnly: target.filter(row => !sourceIndex.has(fingerprint(row, keys)))
  }
}

async function compare(input: ComparisonInput) {
  const client = await ensureConnected(input.connectionId)
  const table = objectName(input.objectName),
    field = objectName(input.keyField)
  if (input.sourceKey === input.targetKey) throw new Error("Source and target keys must differ")
  const maintenance = await resolveMaint(client, table)
  const fields = tableRows(
    await runSql(
      client,
      `SELECT FIELDNAME, KEYFLAG FROM DD03L WHERE TABNAME = '${maintenance.rootTable}' AND AS4LOCAL = 'A' ORDER BY POSITION`,
      1000
    )
  )
  if (!fields.some(row => col(row, "FIELDNAME") === field))
    throw new Error("Scope field does not exist on the resolved base table")
  const keys = fields.filter(row => col(row, "KEYFLAG") === "X").map(row => col(row, "FIELDNAME"))
  if (!keys.includes(field))
    throw new Error("Scope field must be a key field for configuration comparison")
  const limit = input.maxRows ?? 1000
  if (!Number.isInteger(limit) || limit < 1 || limit > 9999)
    throw new Error("maxRows must be between 1 and 9999")
  const fetchRows = async (value: string) =>
    tableRows(
      await runSql(
        client,
        `SELECT * FROM ${maintenance.rootTable} WHERE ${field} = '${sqlLiteral(value)}'`,
        limit + 1
      )
    )
  const [source, target] = await Promise.all([
    fetchRows(input.sourceKey),
    fetchRows(input.targetKey)
  ])
  if (source.length > limit || target.length > limit)
    throw new Error(
      "Comparison exceeds maxRows. Narrow the scope or raise the limit; partial data cannot produce a reliable plan."
    )
  return {
    maintenance,
    field,
    source,
    target,
    comparison: compareRows(source, target, keys, field)
  }
}

export async function handleCustomizingDiff(input: ComparisonInput) {
  const result = await compare(input)
  return {
    object: result.maintenance,
    sourceRows: result.source.length,
    targetRows: result.target.length,
    ...result.comparison,
    complete: true
  }
}

export async function handleCustomizingPlanChange(input: ComparisonInput) {
  const result = await compare(input)
  const onlyMissing = input.onlyMissing !== false
  const candidates = onlyMissing ? result.comparison.missing : result.source
  return {
    dryRun: true,
    object: result.maintenance,
    onlyMissing,
    inserts: result.comparison.missing.length,
    updates: onlyMissing ? 0 : result.comparison.changed.length,
    rows: candidates.map(row => ({ ...row, [result.field]: input.targetKey })),
    note: "Read-only preview. Apply performs a fresh SAP-side evaluation; this is not a frozen or committed change."
  }
}
