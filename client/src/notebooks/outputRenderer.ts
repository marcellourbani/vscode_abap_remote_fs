import * as vscode from "vscode"
import {
  type CellResult,
  type DisplayValue,
  type DisplayOptions,
  DISPLAY_ROW_LIMIT,
  MAX_DISPLAY_ROW_LIMIT
} from "./types"
import { DISPLAY_MARKER, formatScalar, prettyXml, statusKind, toXml } from "./display"

export interface RenderSettings {
  /** Wrap long values in table cells instead of widening the table. */
  wrap?: boolean
}

const MAX_FENCED_CHARS = 400_000

export function renderSqlOutput(
  cellResult: CellResult,
  settings: RenderSettings = {}
): vscode.NotebookCellOutput {
  if (!Array.isArray(cellResult.result) || cellResult.result.length === 0) {
    return textOutput("Query returned 0 rows.")
  }

  const rows = cellResult.result as Record<string, unknown>[]
  const columns = cellResult.columns || []
  const totalRows = cellResult.rowCount ?? rows.length

  const colNames =
    columns.length > 0
      ? columns.map(c => c.name)
      : rows[0] && typeof rows[0] === "object"
        ? Object.keys(rows[0])
        : []

  const displayRows = rows.slice(0, DISPLAY_ROW_LIMIT)
  const truncated = rows.length > DISPLAY_ROW_LIMIT

  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(
      buildHtmlTable(colNames, displayRows, totalRows, truncated, {
        wrap: settings.wrap,
        footerPrefix: cellResult.system ? `System: ${cellResult.system} · ` : ""
      }),
      "text/html"
    )
  ])
}

export function renderJsOutput(
  cellResult: CellResult,
  settings: RenderSettings = {}
): vscode.NotebookCellOutput {
  const parts: vscode.NotebookCellOutputItem[] = []
  const logs = cellResult.logs

  if (logs && logs.length > 0) {
    parts.push(vscode.NotebookCellOutputItem.text(logs.join("\n"), "text/plain"))
  }

  const val = cellResult.result
  if (val === undefined) {
    if (parts.length > 0) return new vscode.NotebookCellOutput(parts)
    parts.push(vscode.NotebookCellOutputItem.text("undefined", "text/plain"))
    return new vscode.NotebookCellOutput(parts)
  }

  if (isTabularData(val)) {
    const colNames = Object.keys(val[0])
    const displayRows = val.slice(0, DISPLAY_ROW_LIMIT)
    const truncated = val.length > DISPLAY_ROW_LIMIT
    parts.push(
      vscode.NotebookCellOutputItem.text(
        buildHtmlTable(colNames, displayRows, val.length, truncated, { wrap: settings.wrap }),
        "text/html"
      )
    )
  } else {
    let text: string
    if (typeof val === "string") {
      text = val
    } else {
      try {
        text = JSON.stringify(val, null, 2) ?? "null"
      } catch {
        text = "[Result too complex to display — circular reference or non-serializable value]"
      }
    }
    parts.push(vscode.NotebookCellOutputItem.text(text, "text/plain"))
  }

  return new vscode.NotebookCellOutput(parts)
}

/** JS output including rich `display.*` results; may produce several outputs. */
export function renderJsOutputs(
  cellResult: CellResult,
  settings: RenderSettings = {}
): vscode.NotebookCellOutput[] {
  const display = cellResult.display
  if (!display) return [renderJsOutput(cellResult, settings)]
  const outputs: vscode.NotebookCellOutput[] = []
  if (cellResult.logs && cellResult.logs.length > 0) {
    outputs.push(textOutput(cellResult.logs.join("\n")))
  }
  const list = Array.isArray(display) ? display : [display]
  for (const d of list) outputs.push(renderDisplay(d, settings))
  return outputs
}

export function renderDisplay(
  d: DisplayValue,
  settings: RenderSettings = {}
): vscode.NotebookCellOutput {
  const kind = d[DISPLAY_MARKER]
  const opts: DisplayOptions = d.options || {}
  const title = opts.title ? String(opts.title) : ""
  const item = (text: string, mime: string) =>
    new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(text, mime)])

  switch (kind) {
    case "html":
      return item((title ? `<h3>${esc(title)}</h3>` : "") + String(d.content ?? ""), "text/html")
    case "markdown":
      return item((title ? `### ${title}\n\n` : "") + String(d.content ?? ""), "text/markdown")
    case "text":
      return item((title ? `${title}\n\n` : "") + String(d.content ?? ""), "text/plain")
    case "json": {
      let text: string
      try {
        text =
          typeof d.content === "string"
            ? d.content
            : (JSON.stringify(d.content, jsonReplacer, 2) ?? "null")
      } catch {
        text = String(d.content)
      }
      return fenced(text, "json", title)
    }
    case "xml": {
      const text = typeof d.content === "string" ? prettyXml(d.content) : toXml(d.content, "result")
      return fenced(text, "xml", title)
    }
    case "table": {
      const rows = Array.isArray(d.content) ? (d.content as unknown[]) : []
      if (!isTabularData(rows)) {
        return item(
          title + (rows.length ? JSON.stringify(rows, jsonReplacer, 2) : "(no rows)"),
          "text/plain"
        )
      }
      const limit = Math.min(Math.max(1, opts.limit ?? DISPLAY_ROW_LIMIT), MAX_DISPLAY_ROW_LIMIT)
      const colNames = columnsOf(rows)
      return item(
        buildHtmlTable(colNames, rows.slice(0, limit), rows.length, rows.length > limit, {
          wrap: opts.wrap ?? settings.wrap,
          highlight: opts.highlight,
          title
        }),
        "text/html"
      )
    }
  }
}

function fenced(text: string, lang: string, title: string): vscode.NotebookCellOutput {
  if (text.length > MAX_FENCED_CHARS) {
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text((title ? title + "\n\n" : "") + text, "text/plain")
    ])
  }
  const fence = text.includes("```") ? "~~~~" : "```"
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(
      (title ? `### ${title}\n\n` : "") + `${fence}${lang}\n${text}\n${fence}`,
      "text/markdown"
    )
  ])
}

function jsonReplacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = key === "" ? value : this[key]
  if (Object.prototype.toString.call(raw) === "[object Date]") return formatScalar(raw)
  return value
}

/** Union of keys over the first rows, in first-seen order. */
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) seen.add(k)
  return [...seen]
}

export function renderErrorOutput(error: Error | string): vscode.NotebookCellOutput {
  const message = typeof error === "string" ? error : error.message || String(error)
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(`❌ ${message}`, "text/plain")
  ])
}

function textOutput(text: string): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(text, "text/plain")])
}

function isTabularData(val: unknown): val is Record<string, unknown>[] {
  if (!Array.isArray(val) || val.length === 0) return false
  const first = val[0]
  return (
    typeof first === "object" &&
    first !== null &&
    !Array.isArray(first) &&
    !(first instanceof Date) &&
    !(first instanceof RegExp)
  )
}

function esc(s: unknown): string {
  return formatScalar(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function statusClass(v: unknown): string | undefined {
  const k = statusKind(v)
  return k ? `st-${k}` : undefined
}

interface TableOptions {
  wrap?: boolean
  highlight?: boolean
  title?: string
  footerPrefix?: string
}

function buildHtmlTable(
  colNames: string[],
  rows: Record<string, unknown>[],
  totalRows: number,
  truncated: boolean,
  options: TableOptions = {}
): string {
  const headerCells = colNames.map(c => `<th>${esc(c)}</th>`).join("")
  const bodyRows = rows
    .map(row => {
      const tds = colNames
        .map(c => {
          const cls = options.highlight ? statusClass(row[c]) : undefined
          return `<td${cls ? ` class="${cls}"` : ""}>${esc(row[c])}</td>`
        })
        .join("")
      return `<tr>${tds}</tr>`
    })
    .join("\n")

  const prefix = options.footerPrefix || ""
  const footerNote = truncated
    ? `<p style="color:#888;font-size:12px;">${esc(prefix)}Showing ${rows.length} of ${totalRows} rows. Full data available to subsequent cells.</p>`
    : `<p style="color:#888;font-size:12px;">${esc(prefix)}${totalRows} row${totalRows !== 1 ? "s" : ""}</p>`

  const wrapCss = options.wrap
    ? "white-space:normal;overflow-wrap:break-word;word-break:normal;max-width:60ch;vertical-align:top"
    : "white-space:nowrap"

  return `<style>
.sapwb-table{border-collapse:collapse;width:100%;font-family:var(--vscode-editor-font-family);font-size:13px}
.sapwb-table th{background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-foreground);padding:6px 10px;text-align:left;border-bottom:2px solid var(--vscode-panel-border);white-space:nowrap;position:sticky;top:0}
.sapwb-table td{padding:4px 10px;border-bottom:1px solid var(--vscode-panel-border);${wrapCss}}
.sapwb-table tr:hover td{background:var(--vscode-list-hoverBackground)}
.sapwb-table td.st-red{background:rgba(220,53,69,.28);font-weight:600}
.sapwb-table td.st-yellow{background:rgba(255,193,7,.28);font-weight:600}
.sapwb-table td.st-green{background:rgba(40,167,69,.25);font-weight:600}
.sapwb-table td.st-info{background:rgba(23,162,184,.18)}
.sapwb-title{font-weight:600;margin:4px 0 6px}
</style>
${options.title ? `<div class="sapwb-title">${esc(options.title)}</div>` : ""}<table class="sapwb-table">
<thead><tr>${headerCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
${footerNote}`
}
