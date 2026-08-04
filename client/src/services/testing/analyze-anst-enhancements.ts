import * as fs from "fs/promises"
import * as path from "path"
import ExcelJS, { CellValue } from "exceljs"

type EnhancementClass = "USER_EXIT" | "DEFINITE" | "POTENTIAL" | "STANDARD"

type EnhancementRecord = {
  obj_type?: string
  obj_name?: string
  package?: string
  component?: string
  enh_type?: string
  _class: EnhancementClass
}

export type AnstEnhancementAnalysisResult = {
  inputPath: string
  outputPath: string
  total: number
  counts: Record<EnhancementClass, number>
}

const COLUMN_ALIASES: Record<string, keyof EnhancementRecord> = {
  "obj type": "obj_type",
  objtype: "obj_type",
  "obj name": "obj_name",
  objname: "obj_name",
  "object name": "obj_name",
  package: "package",
  component: "component",
  "enh type": "enh_type",
  enhtype: "enh_type"
}

function isUserExit(objName: string, enhType: string): boolean {
  const upperName = objName.toUpperCase()
  const lowerType = enhType.toLowerCase()
  return (
    upperName.startsWith("EXIT_") ||
    lowerType.includes("user-exit") ||
    lowerType.includes("user exit")
  )
}

function classify(record: Omit<EnhancementRecord, "_class">): EnhancementClass {
  const objName = record.obj_name?.trim() ?? ""
  const packageName = record.package?.trim() ?? ""
  const enhType = record.enh_type?.trim() ?? ""

  if (isUserExit(objName, enhType)) return "USER_EXIT"
  if (/^[ZY]/i.test(objName) || /^[ZY]/i.test(packageName)) return "DEFINITE"
  if (/L[ZY]/i.test(objName)) return "POTENTIAL"
  return "STANDARD"
}

function isCellTruthy(value: CellValue): boolean {
  return value !== null && value !== undefined && value !== "" && value !== 0 && value !== false
}

function formatDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  const hours = String(value.getHours()).padStart(2, "0")
  const minutes = String(value.getMinutes()).padStart(2, "0")
  const seconds = String(value.getSeconds()).padStart(2, "0")
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return formatDate(value)
  if (typeof value !== "object") return String(value).trim()
  if ("richText" in value) {
    return value.richText
      .map(part => part.text)
      .join("")
      .trim()
  }
  if ("text" in value) return value.text.trim()
  if ("result" in value) return cellToString(value.result)
  if ("error" in value) return value.error
  return ""
}

async function readRecords(xlsxPath: string): Promise<EnhancementRecord[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(xlsxPath)
  const activeTab = workbook.views?.[0]?.activeTab ?? 0
  const worksheet = workbook.worksheets[activeTab] ?? workbook.worksheets[0]
  if (!worksheet) return []

  const rows: CellValue[][] = []
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const values: CellValue[] = []
    for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      values.push(row.getCell(columnNumber).value)
    }
    rows.push(values)
  }
  if (!rows.length) return []

  const headerIndex = rows.findIndex(row => row.filter(isCellTruthy).length >= 2)
  if (headerIndex < 0) return []

  const headers = rows[headerIndex].map(value => cellToString(value).toLowerCase())
  const typePositions = headers
    .map((header, index) => (header === "type" ? index : -1))
    .filter(index => index >= 0)
  const columnMap = new Map<number, keyof EnhancementRecord>()

  headers.forEach((header, index) => {
    const alias = COLUMN_ALIASES[header]
    if (alias) {
      columnMap.set(index, alias)
      return
    }
    if (header !== "type") return
    if (typePositions.length === 1) {
      columnMap.set(index, "enh_type")
      return
    }
    if (typePositions.length >= 2) {
      columnMap.set(index, index === typePositions[0] ? "obj_type" : "enh_type")
    }
  })

  const records: EnhancementRecord[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some(isCellTruthy)) continue
    const raw: Omit<EnhancementRecord, "_class"> = {}
    row.forEach((value, index) => {
      const key = columnMap.get(index)
      if (key && key !== "_class") raw[key] = cellToString(value)
    })
    if (!raw.obj_name) continue
    records.push({ ...raw, _class: classify(raw) })
  }
  return records
}

function reportLines(records: EnhancementRecord[], xlsxName: string): string[] {
  const buckets: Record<EnhancementClass, EnhancementRecord[]> = {
    USER_EXIT: [],
    DEFINITE: [],
    POTENTIAL: [],
    STANDARD: []
  }
  records.forEach(record => buckets[record._class].push(record))

  const lines = [
    `# Enhancement Analysis — ${xlsxName}`,
    "",
    `Source: \`${xlsxName}\`  `,
    `Total objects: **${records.length}**  `,
    "",
    "## Classification summary",
    "",
    "| Bucket | Count | Meaning |",
    "|--------|-------|---------|",
    `| USER_EXIT | ${buckets.USER_EXIT.length} | Classic EXIT_ user-exit FMs — contains Z-include with custom code |`,
    `| DEFINITE  | ${buckets.DEFINITE.length}  | Name or package starts with Z/Y — definitely custom |`,
    `| POTENTIAL | ${buckets.POTENTIAL.length} | Name contains LZ/LY pattern — likely custom include |`,
    `| STANDARD  | ${buckets.STANDARD.length}  | Standard SAP objects — need regex scan for embedded enhancements |`,
    "",
    "---",
    ""
  ]

  const titles: Record<EnhancementClass, string> = {
    USER_EXIT: "## 1. User Exits (EXIT_* FMs)",
    DEFINITE: "## 2. Definite Customer Objects (Z*/Y* name or package)",
    POTENTIAL: "## 3. Potential Custom Includes (LZ/LY name pattern)",
    STANDARD: "## 4. Standard SAP Objects — scan for embedded enhancements"
  }
  const descriptions: Record<EnhancementClass, string> = {
    USER_EXIT:
      "These are classic SMOD/CMOD exits. Each FM contains one or more `INCLUDE Z*` statements where the actual customer logic lives.\n**AI action:** For each FM below — read its source, find all `INCLUDE Z*` lines, then read those includes and summarise what they do.\n",
    DEFINITE:
      "Object name or package is in the Z/Y namespace — this IS customer code.\n**AI action:** Read the source of each object below and summarise the custom logic.\n",
    POTENTIAL:
      "Object name contains the LZ/LY convention used for local enhancement includes.\n**AI action:** Read the source of each object below to confirm and summarise custom content.\n",
    STANDARD:
      "Standard SAP objects that may contain embedded customer enhancements.\n**AI action:** Use `search_abap_object_lines` with `isRegexp: true` and pattern `ENHANCEMENT\\s+\\d+\\s+[ZY]|CUSTOMER-FUNCTION\\s+'|INCLUDE\\s+[ZY]` on the objects listed in the batch section below. Report every hit.\n"
  }

  const order: EnhancementClass[] = ["USER_EXIT", "DEFINITE", "POTENTIAL", "STANDARD"]
  for (const bucket of order) {
    lines.push(titles[bucket], "", descriptions[bucket])
    if (!buckets[bucket].length) {
      lines.push("_None_", "", "---", "")
      continue
    }
    for (const record of buckets[bucket]) {
      const details = [
        record.package ? ` · pkg \`${record.package}\`` : "",
        record.component ? ` · comp \`${record.component}\`` : "",
        record.enh_type ? ` · ${record.enh_type}` : ""
      ].join("")
      lines.push(`- \`${record.obj_name ?? "?"}\`${details}`, "")
    }
    lines.push("---", "")
  }
  return lines
}

export async function analyzeAnstEnhancements(
  inputPath: string
): Promise<AnstEnhancementAnalysisResult> {
  const xlsxPath = path.resolve(inputPath)
  let stat
  try {
    stat = await fs.stat(xlsxPath)
  } catch {
    throw new Error(`File not found: ${xlsxPath}`)
  }
  if (!stat.isFile()) throw new Error(`Not a file: ${xlsxPath}`)
  if (path.extname(xlsxPath).toLowerCase() !== ".xlsx") {
    throw new Error(`Expected an .xlsx file, got: ${path.extname(xlsxPath) || "(none)"}`)
  }

  const records = await readRecords(xlsxPath)
  if (!records.length) throw new Error("No data rows found in the xlsx.")

  const outputPath = path.join(
    path.dirname(xlsxPath),
    `${path.basename(xlsxPath, path.extname(xlsxPath))}_analysis.md`
  )
  await fs.writeFile(outputPath, reportLines(records, path.basename(xlsxPath)).join("\n"), "utf8")

  const counts: Record<EnhancementClass, number> = {
    USER_EXIT: 0,
    DEFINITE: 0,
    POTENTIAL: 0,
    STANDARD: 0
  }
  records.forEach(record => {
    counts[record._class] += 1
  })
  return {
    inputPath: xlsxPath,
    outputPath,
    total: records.length,
    counts
  }
}
