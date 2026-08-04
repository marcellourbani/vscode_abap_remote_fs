/**
 * FixtureBuilder — generic, deterministic file-fixture generator.
 *
 * Problem this replaces: before this existed, a `.data.md` that needed an upload
 * file (Excel, CSV, ...) either hardcoded a path to a fixture nobody had generated,
 * or embedded ad hoc Python/openpyxl snippets in prose for the AI to run by hand.
 * Both are non-deterministic (depends on the AI remembering/copying correctly) and
 * both bake ABSOLUTE dates into a file that goes stale the moment "today" moves past
 * whatever was baked in at generation time.
 *
 * This module is the deterministic replacement: a declarative JSON spec (columns +
 * rows, with `{{key}}` templating and relative-date tokens) goes in, a real file
 * comes out — built fresh, with dates computed against the CURRENT run time, every
 * single call. No business logic lives here; it is pure spreadsheet/text mechanics,
 * reusable for any report's upload fixture.
 *
 * Usage (usually invoked automatically by `resolveTestData` for `source: "generated"`
 * requirements — see test-data.ts):
 *
 *   const path = await buildFixture(
 *     {
 *       format: "xlsx",
 *       filename: "upload.xlsx",
 *       columns: ["Article", "Site", "Start Date", "End Date"],
 *       rows: [["{{article_number}}", "{{site}}", "+30d", "+31d"]],
 *     },
 *     { article_number: "000000000000011911", site: "1000" },
 *     "tests/Z_MY_REPORT/test-results/DEV/TC-001",
 *   )
 */
import * as fs from "fs/promises"
import * as path from "path"
import ExcelJS from "exceljs"
import { isRelativeDateToken, relativeDate, DateFormat } from "./format"

export type FixtureCell = string | number

export type FixtureSpec = {
  /** Output file format. */
  format: "xlsx" | "csv"
  /** Filename only (no directory) — the caller decides the output directory. */
  filename: string
  /** Header row, written verbatim as the first row. */
  columns: string[]
  /**
   * Data rows. Each cell may be:
   *   - a literal string/number, written as-is
   *   - a "{{key}}" placeholder, substituted from `context`
   *   - a relative-date token ("today", "+30d", "-5d"), resolved against "now"
   *     at the moment buildFixture() runs
   */
  rows: FixtureCell[][]
  /** Date format used when rendering relative-date tokens. Default MM/DD/YYYY. */
  dateFormat?: DateFormat
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

function resolveCell(
  cell: FixtureCell,
  context: Record<string, string>,
  dateFormat: DateFormat
): string | number {
  if (typeof cell === "number") return cell
  const withPlaceholders = cell.replace(PLACEHOLDER_RE, (_, key) => {
    if (!(key in context)) {
      throw new Error(
        `Fixture template references "{{${key}}}" but no such key was resolved. ` +
          `Available keys: ${Object.keys(context).join(", ") || "(none)"}.`
      )
    }
    return context[key]
  })
  if (isRelativeDateToken(withPlaceholders)) {
    return relativeDate(withPlaceholders, dateFormat)
  }
  return withPlaceholders
}

/**
 * Build the fixture file described by `spec`, substituting `context` values and
 * resolving relative-date tokens against the current time, and write it under
 * `outDir`. Returns the absolute path to the written file.
 *
 * Deliberately NOT cached anywhere — call this fresh every time you need the file
 * (each Playwright run, each `prepare-data` pass). The whole point is that it is
 * cheap and deterministic enough that caching would only introduce staleness risk
 * for no benefit.
 */
export async function buildFixture(
  spec: FixtureSpec,
  context: Record<string, string>,
  outDir: string
): Promise<string> {
  const dateFormat = spec.dateFormat ?? "MM/DD/YYYY"
  const rows = spec.rows.map(row => row.map(cell => resolveCell(cell, context, dateFormat)))

  await fs.mkdir(outDir, { recursive: true })
  const outPath = path.join(outDir, spec.filename)

  if (spec.format === "csv") {
    await writeCsv(outPath, spec.columns, rows)
  } else {
    await writeXlsx(outPath, spec.columns, rows)
  }
  return outPath
}

function csvEscape(value: string | number): string {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function writeCsv(
  outPath: string,
  columns: string[],
  rows: (string | number)[][]
): Promise<void> {
  const lines = [columns, ...rows].map(r => r.map(csvEscape).join(","))
  await fs.writeFile(outPath, lines.join("\r\n") + "\r\n", "utf8")
}

async function writeXlsx(
  outPath: string,
  columns: string[],
  rows: (string | number)[][]
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Sheet1")
  ws.addRow(columns)
  for (const row of rows) ws.addRow(row)
  await wb.xlsx.writeFile(outPath)
}
