/** Excel (exceljs) and Word (docx) writers for the export model. Both libraries ship with ABAP FS. */
import ExcelJS from "exceljs"
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx"
import { statusKind, STATUS_COLORS } from "../display"
import { cellLabel, type ExportItem, type ExportModel, type ExportTable } from "./exportModel"
import {
  codeCaption,
  itemCodeLang,
  LANG_LABEL,
  langOf,
  splitMarkdown,
  tokenize,
  TOKEN_COLORS,
  type CodeLang
} from "./codeFormat"

export const DOCX_MAX_TABLE_ROWS = 2000

// ------------------------------------------------------------------ Excel

function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet"
  let name = clean
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${clean.slice(0, 27)}_${n}`
  used.add(name.toLowerCase())
  return name
}

function addTableSheet(wb: ExcelJS.Workbook, name: string, item: ExportItem, t: ExportTable) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 2 }] })
  ws.getCell(1, 1).value = cellLabel(item)
  ws.getCell(1, 1).font = { bold: true, color: { argb: "FF555555" } }
  const header = ws.getRow(2)
  t.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c
    cell.font = { bold: true }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAED" } }
    cell.border = { bottom: { style: "thin", color: { argb: "FF888888" } } }
  })
  t.rows.forEach((r, ri) => {
    const row = ws.getRow(ri + 3)
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      const k = statusKind(v)
      if (k) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF" + STATUS_COLORS[k] }
        }
        cell.font = { bold: true }
      }
      if (v.length > 50) cell.alignment = { wrapText: true, vertical: "top" }
    })
  })
  t.columns.forEach((c, i) => {
    const longest = Math.max(c.length, ...t.rows.slice(0, 500).map(r => (r[i] ?? "").length))
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 6), 60)
  })
  if (t.columns.length > 0)
    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2 + t.rows.length, column: t.columns.length }
    }
}

function excelRichText(code: string, lang: CodeLang): ExcelJS.RichText[] {
  const parts: ExcelJS.RichText[] = []
  tokenize(code, lang).forEach((line, li) => {
    if (li > 0) parts.push({ text: "\n", font: { name: "Consolas", size: 10 } })
    for (const t of line)
      parts.push({
        text: t.text,
        font: {
          name: "Consolas",
          size: 10,
          color: { argb: "FF" + TOKEN_COLORS[t.kind] },
          ...(t.kind === "kw" ? { bold: true } : {}),
          ...(t.kind === "com" ? { italic: true } : {})
        }
      })
  })
  return parts.length ? parts : [{ text: "" }]
}

export async function writeXlsx(m: ExportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "ABAP FS SAP Data Workbook"
  wb.created = new Date()
  const used = new Set<string>()

  // Contents
  const contents = wb.addWorksheet(sheetName("Contents", used))
  contents.addRow([m.title]).font = { bold: true, size: 14 }
  contents.addRow([
    `Exported ${m.generated}${m.source ? ` from ${m.source}` : ""}`,
    "",
    m.parts.join(", ")
  ])
  contents.addRow([])
  const head = contents.addRow(["Cell", "Name", "System", "Kind", "Sheet / content"])
  head.font = { bold: true }
  contents.columns = [{ width: 8 }, { width: 28 }, { width: 12 }, { width: 10 }, { width: 100 }]

  const textItems: ExportItem[] = []
  for (const i of m.items) {
    if (i.kind === "data" && i.table && i.table.columns.length > 0) {
      const name = sheetName(`${i.index}_${i.name ?? "result"}`, used)
      addTableSheet(wb, name, i, i.table)
      contents.addRow([
        i.index,
        i.name ?? "",
        i.system ?? "",
        "data",
        `${name} (${i.table.totalRows} rows)`
      ])
    } else {
      textItems.push(i)
      contents.addRow([i.index, i.name ?? "", i.system ?? "", i.kind, "see 'Code & Comments'"])
    }
  }

  if (textItems.length) {
    const ws = wb.addWorksheet(sheetName("Code & Comments", used))
    ws.columns = [
      { header: "Cell", width: 7 },
      { header: "Name", width: 24 },
      { header: "System", width: 10 },
      { header: "Kind", width: 10 },
      { header: "Language", width: 11 },
      { header: "Content", width: 120 }
    ]
    ws.getRow(1).font = { bold: true }
    for (const i of textItems) {
      const lang = itemCodeLang(i)
      const row = ws.addRow([
        i.index,
        i.name ?? "",
        i.system ?? "",
        i.kind,
        lang ? LANG_LABEL[lang] : (i.language ?? i.contentType ?? ""),
        i.text ?? ""
      ])
      row.alignment = { wrapText: true, vertical: "top" }
      const content = row.getCell(6)
      if (!lang) {
        content.font = { name: "Calibri", size: 10 }
        continue
      }
      // code: monospace, light code background, syntax colours (Excel rich text)
      content.value = { richText: excelRichText(i.text ?? "", lang) }
      content.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FA" } }
      content.border = { left: { style: "thick", color: { argb: "FF0B4F9C" } } }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ------------------------------------------------------------------ Word

const thin = { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" }

function docxTable(t: ExportTable): Table {
  const rows = t.rows.slice(0, DOCX_MAX_TABLE_ROWS)
  const size = t.columns.length > 8 ? 14 : 16 // half-points
  const cell = (text: string, header: boolean) => {
    const k = header ? undefined : statusKind(text)
    return new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: header || !!k, size })] })],
      shading: header
        ? { type: ShadingType.CLEAR, color: "auto", fill: "E8EAED" }
        : k
          ? { type: ShadingType.CLEAR, color: "auto", fill: STATUS_COLORS[k] }
          : undefined,
      borders: { top: thin, bottom: thin, left: thin, right: thin }
    })
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: t.columns.map(c => cell(c, true)) }),
      ...rows.map(r => new TableRow({ children: r.map(v => cell(v, false)) }))
    ]
  })
}

const codeBorder = { style: BorderStyle.SINGLE, size: 4, color: "D0D7DE" }

/** Labelled code block: caption + a 1x1 shaded, bordered table with syntax-coloured Consolas runs. */
function codeBlock(text: string, lang: CodeLang, caption: string): Array<Paragraph | Table> {
  const lines = tokenize(text, lang).map(
    tokens =>
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: tokens.length
          ? tokens.map(
              t =>
                new TextRun({
                  text: t.text,
                  font: "Consolas",
                  size: 16,
                  color: TOKEN_COLORS[t.kind],
                  bold: t.kind === "kw",
                  italics: t.kind === "com"
                })
            )
          : [new TextRun({ text: " ", font: "Consolas", size: 16 })]
      })
  )
  return [
    new Paragraph({
      spacing: { before: 60, after: 0 },
      children: [new TextRun({ text: caption, bold: true, size: 15, color: "44546A" })]
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: lines,
              shading: { type: ShadingType.CLEAR, color: "auto", fill: "F6F8FA" },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              borders: {
                top: codeBorder,
                bottom: codeBorder,
                right: codeBorder,
                left: { style: BorderStyle.SINGLE, size: 24, color: "0B4F9C" }
              }
            })
          ]
        })
      ]
    })
  ]
}

function markdownParagraphs(md: string): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = []
  for (const b of splitMarkdown(md)) {
    if (b.type === "code") out.push(...codeBlock(b.code, b.lang, codeCaption(b.lang)))
    else if (b.type === "table")
      out.push(docxTable({ columns: b.columns, rows: b.rows, totalRows: b.rows.length }))
    else out.push(...markdownTextParagraphs(b.lines))
  }
  return out
}

function markdownTextParagraphs(lines: string[]): Paragraph[] {
  const out: Paragraph[] = []
  const levels = [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
  for (const raw of lines) {
    if (/^\s*-{3,}\s*$/.test(raw)) continue
    const h = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (h) {
      out.push(
        new Paragraph({
          text: h[2].replace(/\*\*|`/g, ""),
          heading: levels[Math.min(h[1].length, 3) - 1]
        })
      )
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw)
    const text = (bullet ? bullet[1] : raw.replace(/^>\s?/, "")).replace(/`/g, "")
    // **bold** runs
    const runs = text
      .split(/(\*\*[^*]+\*\*)/)
      .filter(Boolean)
      .map(part =>
        /^\*\*.*\*\*$/.test(part)
          ? new TextRun({ text: part.slice(2, -2), bold: true })
          : new TextRun(part)
      )
    out.push(new Paragraph({ children: runs, ...(bullet ? { bullet: { level: 0 } } : {}) }))
  }
  return out
}

const stripHtml = (html: string) =>
  html.replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")

export async function writeDocx(m: ExportModel): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: m.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported ${m.generated}${m.source ? ` from ${m.source}` : ""} · ${m.parts.join(", ")}`,
          color: "666666",
          size: 18
        })
      ]
    })
  ]
  for (const i of m.items) {
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({
            text: `${cellLabel(i)}  [${i.kind}]`,
            bold: true,
            color: "44546A",
            size: 18
          })
        ]
      })
    )
    if (i.kind === "comment") children.push(...markdownParagraphs(i.text ?? ""))
    else if (i.kind === "code")
      children.push(
        ...codeBlock(
          i.text ?? "",
          langOf(i.language),
          codeCaption(langOf(i.language), i.name, i.system)
        )
      )
    else if (i.table) {
      if (i.table.columns.length === 0) children.push(new Paragraph("(no rows)"))
      else {
        children.push(docxTable(i.table))
        children.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text:
                  `${i.table.totalRows} row(s)` +
                  (i.table.rows.length > DOCX_MAX_TABLE_ROWS
                    ? ` — first ${DOCX_MAX_TABLE_ROWS} shown; export to Excel/CSV for all rows`
                    : ""),
                size: 16,
                color: "666666"
              })
            ]
          })
        )
      }
    } else if (i.contentType === "markdown") children.push(...markdownParagraphs(i.text ?? ""))
    else if (i.contentType === "html")
      children.push(
        ...stripHtml(i.text ?? "")
          .split("\n")
          .map(l => new Paragraph(l))
      )
    else {
      const lang = itemCodeLang(i)
      if (lang) children.push(...codeBlock(i.text ?? "", lang, codeCaption(lang)))
      else children.push(...(i.text ?? "").split(/\r?\n/).map(l => new Paragraph(l))) // plain text: prose
    }
  }
  const doc = new Document({
    creator: "ABAP FS SAP Data Workbook",
    title: m.title,
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 720, right: 720 }
          }
        },
        children
      }
    ]
  })
  return Buffer.from(await Packer.toBuffer(doc))
}
