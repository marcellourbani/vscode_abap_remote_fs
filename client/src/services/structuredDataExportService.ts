import * as ExcelJS from "exceljs"
import * as fs from "fs"
import { once } from "events"

export interface ExportColumn {
  name: string
  header?: string
  type?: string
}

export const EXCEL_MAX_DATA_ROWS = 1_048_575

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/
const SAP_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/
const SAP_TIME_RE = /^(\d{2})(\d{2})(\d{2})$/

export function formatExportCell(value: unknown, type?: string): string {
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
  const text = String(value).trim()
  if (!text || text === "Invalid Date") return ""
  const iso = ISO_RE.exec(text)
  if (iso) return formatFromParts(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +iso[6], type)
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(text)) {
    const date = new Date(text)
    return isNaN(date.getTime())
      ? ""
      : formatFromParts(
          date.getFullYear(),
          date.getMonth() + 1,
          date.getDate(),
          date.getHours(),
          date.getMinutes(),
          date.getSeconds(),
          type
        )
  }
  if (type === "D") {
    if (text === "00000000") return ""
    const match = SAP_DATE_RE.exec(text)
    return match ? `${match[3]}-${match[2]}-${match[1]}` : ""
  }
  if (type === "T") {
    if (text === "000000") return ""
    const match = SAP_TIME_RE.exec(text)
    return match ? `${match[1]}:${match[2]}:${match[3]}` : ""
  }
  return text
}

export async function buildXlsx(
  columns: ExportColumn[],
  values: Array<Record<string, unknown>>,
  sheetName = "Data"
): Promise<Uint8Array> {
  if (values.length > EXCEL_MAX_DATA_ROWS) {
    throw new Error(
      `XLSX supports at most ${EXCEL_MAX_DATA_ROWS.toLocaleString()} data rows; export CSV instead`
    )
  }
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ABAP FS"
  workbook.created = new Date()
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31))
  const headers = columns.map(column => column.header ?? column.name)
  const header = worksheet.addRow(headers)
  header.font = { bold: true, color: { argb: "FFFFFFFF" } }
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF365F91" }
  }
  header.alignment = { vertical: "middle", wrapText: true }
  header.height = 30
  worksheet.views = [{ state: "frozen", ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  }
  for (const row of values) {
    const output = worksheet.addRow(columns.map(column => xlsxCellValue(row[column.name], column)))
    output.eachCell({ includeEmpty: true }, cell => {
      if (typeof cell.value === "string") cell.numFmt = "@"
      cell.alignment = {
        vertical: "top",
        wrapText: typeof cell.value === "string" && cell.value.includes("\n")
      }
    })
  }
  worksheet.columns.forEach((column, index) => {
    const contentWidth = values.reduce(
      (width, value) => Math.max(width, displayWidth(value[columns[index].name])),
      0
    )
    column.width = Math.min(60, Math.max(12, displayWidth(headers[index]) + 2, contentWidth + 2))
  })
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

export function buildCsv(
  columns: ExportColumn[],
  values: Array<Record<string, unknown>>
): Uint8Array {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const lines = [columns.map(column => escape(column.header ?? column.name)).join(",")]
  for (const row of values) {
    lines.push(
      columns.map(column => escape(formatExportCell(row[column.name], column.type))).join(",")
    )
  }
  return new TextEncoder().encode(`\uFEFF${lines.join("\n")}`)
}

export async function streamCsv(
  filePath: string,
  columns: ExportColumn[],
  values: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
): Promise<number> {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  stream.write(`\uFEFF${columns.map(column => escape(column.header ?? column.name)).join(",")}\n`)
  let count = 0
  for await (const row of values) {
    const line = columns
      .map(column => escape(formatExportCell(row[column.name], column.type)))
      .join(",")
    if (!stream.write(`${line}\n`)) await once(stream, "drain")
    count++
  }
  stream.end()
  await once(stream, "finish")
  return count
}

function xlsxCellValue(value: unknown, column: ExportColumn): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return formatExportCell(value, column.type)
}

function displayWidth(value: unknown): number {
  return String(value ?? "")
    .split(/\r?\n/)
    .reduce((longest, line) => Math.max(longest, line.length), 0)
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function formatFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  type?: string
): string {
  if (type === "D") return `${pad2(day)}-${pad2(month)}-${year}`
  if (type === "T") return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}
