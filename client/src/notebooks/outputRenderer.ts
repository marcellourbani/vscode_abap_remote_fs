import * as vscode from "vscode"
import { CellResult, DISPLAY_ROW_LIMIT } from "./types"

export function renderSqlOutput(cellResult: CellResult): vscode.NotebookCellOutput {
  if (!Array.isArray(cellResult.result) || cellResult.result.length === 0) {
    return textOutput("Query returned 0 rows.")
  }

  const rows = cellResult.result as Record<string, unknown>[]
  const columns = cellResult.columns || []
  const totalRows = cellResult.rowCount ?? rows.length

  const colNames = columns.length > 0
    ? columns.map(c => c.name)
    : (rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [])

  const displayRows = rows.slice(0, DISPLAY_ROW_LIMIT)
  const truncated = rows.length > DISPLAY_ROW_LIMIT

  const CSV_INLINE_LIMIT = 100_000
  const items: vscode.NotebookCellOutputItem[] = [
    vscode.NotebookCellOutputItem.text(
      buildHtmlTable(colNames, displayRows, totalRows, truncated, rows.length > CSV_INLINE_LIMIT),
      "text/html"
    )
  ]

  if (rows.length <= CSV_INLINE_LIMIT) {
    items.push(vscode.NotebookCellOutputItem.text(buildCsv(colNames, rows), "text/csv"))
  }

  return new vscode.NotebookCellOutput(items)
}

export function renderJsOutput(cellResult: CellResult): vscode.NotebookCellOutput {
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
    const CSV_INLINE_LIMIT = 100_000
    const colNames = Object.keys(val[0])
    const displayRows = val.slice(0, DISPLAY_ROW_LIMIT)
    const truncated = val.length > DISPLAY_ROW_LIMIT
    const csvSkipped = val.length > CSV_INLINE_LIMIT
    parts.push(
      vscode.NotebookCellOutputItem.text(
        buildHtmlTable(colNames, displayRows, val.length, truncated, csvSkipped),
        "text/html"
      )
    )
    if (!csvSkipped) {
      parts.push(
        vscode.NotebookCellOutputItem.text(buildCsv(colNames, val), "text/csv")
      )
    }
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

export function renderErrorOutput(error: Error | string): vscode.NotebookCellOutput {
  const err = typeof error === "string" ? new Error(error) : error
  return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)])
}

function textOutput(text: string): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(text, "text/plain")
  ])
}

function isTabularData(val: unknown): val is Record<string, unknown>[] {
  if (!Array.isArray(val) || val.length === 0) return false
  const first = val[0]
  return typeof first === "object" && first !== null && !Array.isArray(first) && !(first instanceof Date) && !(first instanceof RegExp)
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildHtmlTable(
  colNames: string[],
  rows: Record<string, unknown>[],
  totalRows: number,
  truncated: boolean,
  csvSkipped = false
): string {
  const headerCells = colNames.map(c => `<th>${esc(c)}</th>`).join("")
  const bodyRows = rows.map(row => {
    const tds = colNames.map(c => `<td>${esc(row[c])}</td>`).join("")
    return `<tr>${tds}</tr>`
  }).join("\n")

  const footerNote = truncated
    ? `<p style="color:#888;font-size:12px;">Showing ${rows.length} of ${totalRows} rows. Full data in CSV output and available to subsequent cells.</p>`
    : `<p style="color:#888;font-size:12px;">${totalRows} row${totalRows !== 1 ? "s" : ""}</p>`

  return `<style>
.sapwb-table{border-collapse:collapse;width:100%;font-family:var(--vscode-editor-font-family);font-size:13px}
.sapwb-table th{background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-foreground);padding:6px 10px;text-align:left;border-bottom:2px solid var(--vscode-panel-border);white-space:nowrap}
.sapwb-table td{padding:4px 10px;border-bottom:1px solid var(--vscode-panel-border);white-space:nowrap}
.sapwb-table tr:hover td{background:var(--vscode-list-hoverBackground)}
</style>
<table class="sapwb-table">
<thead><tr>${headerCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
${footerNote}
${csvSkipped
    ? `<p style="font-size:11px;color:#888;">Result set too large for inline CSV (${totalRows} rows). Use a JavaScript cell to process or export the data.</p>`
    : `<p style="font-size:11px;color:#888;">Right-click the cell output → "Save Cell Output As..." to export all ${totalRows} rows as CSV.</p>`}`
}

function buildCsv(colNames: string[], rows: Record<string, unknown>[]): string {
  const header = colNames.map(c => csvEscape(c)).join(",")
  const dataRows = rows.map(row =>
    colNames.map(c => csvEscape(String(row[c] ?? ""))).join(",")
  )
  return [header, ...dataRows].join("\n")
}

function csvEscape(val: string): string {
  let safe = val
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = "'" + safe
  }
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
    return '"' + safe.replace(/"/g, '""') + '"'
  }
  return safe
}
