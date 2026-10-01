/**
 * Format-independent export model. Built from the notebook cells (+ their in-memory results) and
 * the parts the user picked: data (results), code (SQL/JS sources) and comments (markdown cells).
 * Every writer (HTML, JSON, XML, CSV, Markdown, PDF, Excel, Word) consumes this model.
 */
import { type CellResult, type DisplayValue } from "../types"
import { DISPLAY_MARKER, formatScalar, isDisplayValue, toXml } from "../display"

export type ExportPart = "data" | "code" | "comments"
export type ExportFormat = "pdf" | "html" | "json" | "xml" | "xlsx" | "csv" | "docx" | "md"

export const FORMAT_INFO: Record<
  ExportFormat,
  { label: string; ext: string; description: string }
> = {
  pdf: { label: "PDF", ext: "pdf", description: "Printable report (landscape, tables wrapped)" },
  html: { label: "HTML", ext: "html", description: "Self-contained web page" },
  json: { label: "JSON", ext: "json", description: "Structured data" },
  xml: { label: "XML", ext: "xml", description: "Structured data" },
  xlsx: { label: "Excel", ext: "xlsx", description: "One sheet per result + code/comments sheet" },
  csv: { label: "CSV", ext: "csv", description: "Data only — one file per result table" },
  docx: { label: "Word", ext: "docx", description: "Formatted document" },
  md: { label: "Markdown", ext: "md", description: "Plain-text report" }
}

export interface ExportCellInput {
  index: number
  kind: "markdown" | "sql" | "javascript"
  source: string
  name?: string
  system?: string
  result?: CellResult
}

export interface ExportTable {
  columns: string[]
  /** Values already formatted as display strings. */
  rows: string[][]
  totalRows: number
}

export interface ExportItem {
  index: number
  name?: string
  system?: string
  kind: "comment" | "code" | "data"
  language?: "sql" | "javascript" | "markdown"
  text?: string
  table?: ExportTable
  /** Raw result value (JSON/XML exports). */
  value?: unknown
  /** Result is html / markdown / xml content produced with display.*. */
  contentType?: "html" | "markdown" | "xml" | "text" | "json"
}

export interface ExportModel {
  title: string
  source?: string
  generated: string
  parts: ExportPart[]
  items: ExportItem[]
}

export function isTable(v: unknown): v is Record<string, unknown>[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(r => typeof r === "object" && r !== null && !Array.isArray(r)) &&
    Object.prototype.toString.call(v[0]) !== "[object Date]"
  )
}

export function toExportTable(rows: Record<string, unknown>[]): ExportTable {
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k)
  const columns = [...seen]
  return {
    columns,
    rows: rows.map(r => columns.map(c => formatScalar(r[c]))),
    totalRows: rows.length
  }
}

export function cellLabel(item: { index: number; name?: string; system?: string }): string {
  return `Cell #${item.index}${item.name ? ` · ${item.name}` : ""}${item.system ? ` · ${item.system}` : ""}`
}

/**
 * Data items of a cell, one per displayed output, in order.
 * - display.table / plain arrays of objects -> table
 * - display.html / markdown / text and plain strings -> prose (never a code block)
 * - display.json / display.xml (and plain objects, which the notebook shows as JSON) -> code
 *   blocks, written exactly as produced: XML strings unchanged, JSON as the cell showed it
 */
function dataItems(cell: ExportCellInput): ExportItem[] {
  const r = cell.result
  if (!r || r.error) return []
  const base = {
    index: cell.index,
    name: cell.name,
    system: r.system ?? cell.system,
    kind: "data" as const
  }
  const displays = (Array.isArray(r.display) ? r.display : r.display ? [r.display] : []).filter(
    isDisplayValue
  )
  if (displays.length)
    return displays.map(d => displayItem(base, d)).filter(Boolean) as ExportItem[]

  const v = r.result
  if (v === undefined) return []
  if (isTable(v)) return [{ ...base, table: toExportTable(v), value: v }]
  if (Array.isArray(v) && v.length === 0)
    return [{ ...base, table: { columns: [], rows: [], totalRows: 0 }, value: v }]
  if (typeof v === "string") return [{ ...base, contentType: "text", text: v, value: v }]
  return [{ ...base, contentType: "json", text: safeJson(v), value: v }]
}

type DataBase = Pick<ExportItem, "index" | "name" | "system" | "kind">

function displayItem(base: DataBase, d: DisplayValue): ExportItem | undefined {
  const kind = d[DISPLAY_MARKER]
  const c = d.content
  switch (kind) {
    case "table": {
      const rows = Array.isArray(c) ? c : []
      if (isTable(rows)) return { ...base, table: toExportTable(rows), value: rows }
      return { ...base, table: { columns: [], rows: [], totalRows: 0 }, value: rows }
    }
    case "json":
      return {
        ...base,
        contentType: "json",
        text: typeof c === "string" ? c : safeJson(c),
        value: c
      }
    case "xml":
      return {
        ...base,
        contentType: "xml",
        text: typeof c === "string" ? c : toXml(c, "result"),
        value: c
      }
    case "html":
    case "markdown":
    case "text":
      return { ...base, contentType: kind, text: String(c ?? ""), value: c }
  }
  return undefined
}

export function safeJson(v: unknown): string {
  try {
    return (
      JSON.stringify(
        v,
        function (this: Record<string, unknown>, k: string, val: unknown) {
          const raw = k === "" ? val : this[k]
          return Object.prototype.toString.call(raw) === "[object Date]" ? formatScalar(raw) : val
        },
        2
      ) ?? "null"
    )
  } catch {
    return String(v)
  }
}

export function buildExportModel(
  cells: ExportCellInput[],
  parts: ExportPart[],
  title: string,
  source?: string,
  now: Date = new Date()
): ExportModel {
  const want = new Set(parts)
  const items: ExportItem[] = []
  for (const cell of cells) {
    const common = { index: cell.index, name: cell.name, system: cell.system }
    if (cell.kind === "markdown") {
      if (want.has("comments") && cell.source.trim())
        items.push({ ...common, kind: "comment", language: "markdown", text: cell.source })
      continue
    }
    if (want.has("code") && cell.source.trim())
      items.push({ ...common, kind: "code", language: cell.kind, text: cell.source })
    if (want.has("data")) {
      items.push(...dataItems(cell))
    }
  }
  return { title, source, generated: formatScalar(now), parts, items }
}

/** Human-friendly one-line summary of what an export contains. */
export function describeModel(m: ExportModel): string {
  const n = (k: ExportItem["kind"]) => m.items.filter(i => i.kind === k).length
  return [`${n("data")} result(s)`, `${n("code")} code cell(s)`, `${n("comment")} comment(s)`].join(
    ", "
  )
}
