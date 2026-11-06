import * as ExcelJS from "exceljs"
import * as fs from "fs/promises"
import * as path from "path"
import { createHash } from "crypto"
import { resolveEntries } from "./analysis"
import type {
  InputFile,
  InputKind,
  InventoryObject,
  Observation,
  TransactionMapping,
  FunctionMapping,
  JobOptions
} from "./types"

export const INPUT_COLUMNS: Record<InputKind, string[]> = {
  tadir: ["PGMID", "OBJECT", "OBJ_NAME", "DEVCLASS"],
  enlfdir: ["AREA", "FUNCNAME"],
  transaction: ["ObjectName"],
  "rfc-server": ["ObjectName"],
  "rfc-transaction": ["ObjectName"],
  tbtco: ["JOBNAME", "JOBCOUNT", "STRTDATE", "STRTTIME", "STATUS"],
  tbtcp: ["JOBNAME", "JOBCOUNT", "STEPCOUNT", "PROGNAME"]
}
const headerName = (value: unknown) =>
  String(value ?? "")
    .replace(/[\s_]/g, "")
    .toUpperCase()
const jobKey = (row: Record<string, string>) => `${row.JOBNAME}:${row.JOBCOUNT.padStart(8, "0")}`
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function normalizeRows(matrix: unknown[][], kind: InputKind): Record<string, string>[] {
  const populated = matrix.filter(row => row.some(value => value != null && value !== ""))
  if (!populated.length) throw new Error("The workbook has no header row")
  const headers = populated[0].map(headerName)
  const required =
    kind === "tbtco"
      ? ["JOBNAME", "JOBCOUNT"]
      : kind === "tadir"
        ? ["PGMID", "OBJECT", "OBJNAME", "DEVCLASS"]
        : kind === "enlfdir"
          ? ["AREA", "FUNCNAME"]
          : kind === "tbtcp"
            ? ["JOBNAME", "JOBCOUNT", "PROGNAME"]
            : ["OBJECTNAME"]
  for (const name of required)
    if (!headers.includes(name)) throw new Error(`Missing required column ${name}`)
  if (new Set(headers).size !== headers.length || headers.some(name => !name))
    throw new Error("Blank or duplicate column headers")
  if (required[0] === "OBJECTNAME" && headers.length !== 1)
    throw new Error("ST03N templates require exactly one ObjectName column")
  const result = populated.slice(1).map((cells, index) => {
    if (cells.slice(headers.length).some(value => value != null && value !== ""))
      throw new Error(`Unexpected columns in row ${index + 2}`)
    const row = Object.fromEntries(
      headers.map((name, column) => {
        const value = cells[column]
        if (value && typeof value === "object" && !(value instanceof Date))
          throw new Error(`Unsupported formula or rich cell in row ${index + 2}`)
        const text =
          value instanceof Date
            ? value.toISOString().slice(0, 10).replace(/-/g, "")
            : String(value ?? "")
                .trim()
                .toUpperCase()
        return [name, name === "JOBCOUNT" && /^\d{1,8}$/.test(text) ? text.padStart(8, "0") : text]
      })
    )
    for (const name of required)
      if (!row[name]) throw new Error(`Missing ${name} in row ${index + 2}`)
    return row
  })
  return [...new Map(result.map(row => [JSON.stringify(row), row])).values()]
}

export async function readInput(
  filePath: string,
  kind: InputKind,
  period: string
): Promise<{ input: InputFile; bytes: Uint8Array }> {
  const bytes = await fs.readFile(filePath)
  const workbook = new ExcelJS.Workbook()
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".csv") await workbook.csv.readFile(filePath)
  else if (extension === ".xlsx")
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  else throw new Error("Choose an XLSX or CSV file")
  const sheets = workbook.worksheets.filter(sheet => sheet.actualRowCount > 0)
  if (sheets.length !== 1)
    throw new Error("Each extract must contain exactly one populated worksheet")
  const matrix: unknown[][] = []
  sheets[0].eachRow({ includeEmpty: true }, row => {
    matrix.push(Array.from({ length: row.cellCount }, (_, index) => row.getCell(index + 1).value))
  })
  const id = createHash("sha256").update(kind).update(bytes).digest("hex")
  return {
    bytes,
    input: {
      id,
      kind,
      name: path.basename(filePath),
      period: period.trim(),
      rows: normalizeRows(matrix, kind),
      importedAt: new Date().toISOString(),
      issues: []
    }
  }
}

export function jobObservations(
  headers: Record<string, string>[],
  steps: Record<string, string>[],
  inventory: InventoryObject[],
  mappings: TransactionMapping[],
  options: JobOptions = {}
) {
  const byJob = new Map(headers.map(row => [jobKey(row), row]))
  const observations: Observation[] = []
  const issues: string[] = []
  const stepJobs = new Set(steps.map(jobKey))
  for (const header of headers)
    if (!stepJobs.has(jobKey(header))) issues.push(`No TBTCP steps for ${jobKey(header)}`)
  for (const row of steps) {
    const header = byJob.get(jobKey(row))
    if (!header) {
      issues.push(`No TBTCO header for ${jobKey(row)}`)
      continue
    }
    if (!row.PROGNAME) {
      issues.push(`No ABAP program for ${jobKey(row)} step ${row.STEPCOUNT || "?"}`)
      continue
    }
    const item = resolveEntries([row.PROGNAME], "jobs", inventory, mappings, [])[0]
    const pending = header.STATUS === "S" || header.STATUS === "P"
    if (header.STATUS === "S" && !options.includeReleasedJobs) continue
    if (header.STATUS === "P" && !options.includeScheduledJobs) continue
    const raw = header.STRTDATE || ""
    const candidate = /^\d{8}$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : ""
    const date = validDate(candidate) ? candidate : undefined
    if (!date && !pending) {
      issues.push(
        raw && raw !== "00000000"
          ? `Invalid job date ${raw} for ${jobKey(row)}`
          : `Missing job start date for ${jobKey(row)}`
      )
      continue
    }
    observations.push({
      ...item,
      id: `jobs:${jobKey(row)}:${row.STEPCOUNT || ""}:${row.PROGNAME}`,
      date,
      reason: `${item.reason}; job ${header.JOBNAME}/${header.JOBCOUNT}, step ${row.STEPCOUNT || "?"}, status ${header.STATUS || "unknown"}${date ? `, ${date}` : ""}`
    })
  }
  const latest = new Map<string, Observation>()
  for (const item of observations) {
    const key = item.seeds.find(seed => seed.startsWith("R3TR:PROG:")) || item.id
    const previous = latest.get(key)
    if (!previous || (item.date || "") > (previous.date || "")) latest.set(key, item)
  }
  return { observations: [...latest.values()], issues }
}

export function discoveryInventory(
  objects: Record<string, string>[],
  modules: Record<string, string>[]
) {
  const inventory: InventoryObject[] = objects.map(row => ({
    pgmid: row.PGMID,
    objectType: row.OBJECT,
    objectName: row.OBJNAME || row.OBJ_NAME,
    packageName: row.DEVCLASS
  }))
  const groups = new Map(
    inventory.filter(row => row.objectType === "FUGR").map(row => [row.objectName, row])
  )
  const functions: FunctionMapping[] = []
  const issues: string[] = []
  for (const row of modules) {
    const group = groups.get(row.AREA)
    if (!group) {
      issues.push(`Function group ${row.AREA} for ${row.FUNCNAME} is missing from the TADIR file`)
      continue
    }
    functions.push({ name: row.FUNCNAME, group: row.AREA })
    inventory.push({
      pgmid: "LIMU",
      objectType: "FUNC",
      objectName: row.FUNCNAME,
      packageName: group.packageName,
      functionGroup: row.AREA
    })
  }
  if (!modules.length && groups.size)
    issues.push(
      "No ENLFDIR function-module list was supplied; the function groups are listed without their FMs"
    )
  const unique = [
    ...new Map(
      inventory.map(row => [`${row.pgmid}:${row.objectType}:${row.objectName}`, row])
    ).values()
  ]
  return {
    inventory: unique,
    functions: [...new Map(functions.map(item => [item.name, item])).values()],
    issues
  }
}
