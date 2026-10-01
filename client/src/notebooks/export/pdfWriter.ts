/**
 * Minimal, dependency-free PDF writer for workbook exports.
 *
 * Uses the PDF standard fonts (Courier / Courier-Bold / Helvetica-Bold) so nothing has to be
 * embedded. Courier is monospaced, which makes text wrapping exact. A4 landscape, wrapped table
 * cells, repeated table headers on page breaks, status colouring (RED/YELLOW/GREEN).
 * Characters outside WinAnsi (Latin-1) are transliterated or replaced with '?'.
 */
import { statusKind, STATUS_COLORS } from "../display"
import { cellLabel, type ExportModel, type ExportTable } from "./exportModel"
import {
  codeCaption,
  itemCodeLang,
  langOf,
  splitMarkdown,
  tokenize,
  TOKEN_COLORS,
  type CodeLang
} from "./codeFormat"

const PAGE_W = 842
const PAGE_H = 595
const MARGIN = 32
const BOTTOM = MARGIN + 16
export const PDF_MAX_TABLE_ROWS = 3000
const CHAR = 0.6 // Courier glyph width / font size

const TRANSLIT: Record<string, string> = {
  "—": "-",
  "–": "-",
  "…": "...",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "•": "*",
  "▸": ">",
  "→": "->",
  "↳": "->",
  "✓": "v",
  "✗": "x",
  " ": " ",
  "≤": "<=",
  "≥": ">=",
  // status emoji (not in the PDF standard fonts): drop coloured dots, keep a text hint for marks
  "\u{1F534}": "",
  "\u{1F7E1}": "",
  "\u{1F7E2}": "",
  "\u2705": "[OK]",
  "\u274C": "[X]",
  "\u26A0": "[!]",
  "\uFE0F": ""
}

export function toWinAnsi(s: string): string {
  let out = ""
  for (const ch of s) {
    const t = TRANSLIT[ch]
    if (t !== undefined) out += t
    else {
      const c = ch.codePointAt(0)!
      out += c === 9 ? "    " : c < 32 || (c >= 0x7f && c < 0xa0) || c > 0xff ? "?" : ch
    }
  }
  return out
}

const pdfStr = (s: string) =>
  "(" + toWinAnsi(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")"

const hexRgb = (hex: string) =>
  [0, 2, 4].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ")

/** Hard-wrap text to a maximum number of characters per line (prefers spaces / _ as break points). */
export function wrapText(text: string, maxChars: number): string[] {
  const max = Math.max(1, Math.floor(maxChars))
  const lines: string[] = []
  for (const raw of toWinAnsi(text).split(/\r?\n/)) {
    let rest = raw
    if (rest.length === 0) {
      lines.push("")
      continue
    }
    while (rest.length > max) {
      let cut = Math.max(
        rest.lastIndexOf(" ", max),
        rest.lastIndexOf("_", max - 1) + 1,
        rest.lastIndexOf(",", max - 1) + 1
      )
      if (cut < max * 0.5) cut = max
      lines.push(rest.slice(0, cut).trimEnd())
      rest = rest.slice(cut).trimStart()
    }
    lines.push(rest)
  }
  return lines
}

class PdfDoc {
  private pages: string[] = []
  private ops: string[] = []
  private y = 0
  private pageNo = 0

  constructor(private readonly title: string) {
    this.newPage()
  }

  newPage(): void {
    if (this.pageNo > 0) this.pages.push(this.ops.join("\n"))
    this.pageNo++
    this.ops = []
    this.y = PAGE_H - MARGIN
    this.text(MARGIN, 18, `${this.title}`, "F1", 7, "666666")
    this.text(PAGE_W - MARGIN - 50, 18, `Page ${this.pageNo}`, "F1", 7, "666666")
  }

  ensure(h: number): void {
    if (this.y - h < BOTTOM) this.newPage()
  }

  gap(h: number): void {
    this.y -= h
  }

  text(
    x: number,
    y: number,
    s: string,
    font: "F1" | "F2" | "F3",
    size: number,
    color = "000000"
  ): void {
    this.ops.push(
      `BT ${hexRgb(color)} rg /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfStr(s)} Tj ET`
    )
  }

  rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string): void {
    this.ops.push(
      `${hexRgb(fill)} rg ${stroke ? hexRgb(stroke) + " RG 0.4 w " : ""}${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${stroke ? "B" : "f"}`
    )
  }

  hline(x1: number, x2: number, y: number, color = "CCCCCC"): void {
    this.ops.push(
      `${hexRgb(color)} RG 0.4 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`
    )
  }

  heading(s: string, size: number): void {
    const lines = wrapText(s, (PAGE_W - 2 * MARGIN) / (size * 0.62))
    for (const l of lines) {
      this.ensure(size * 1.4)
      this.y -= size * 1.25
      this.text(MARGIN, this.y, l, "F3", size)
    }
    this.y -= size * 0.4
  }

  paragraph(s: string, size = 8.5, font: "F1" | "F2" = "F1", bg?: string, indent = 0): void {
    const width = PAGE_W - 2 * MARGIN - indent - (bg ? 12 : 0)
    const lead = size * 1.3
    for (const l of wrapText(s, width / (size * CHAR))) {
      this.ensure(lead)
      if (bg)
        this.rect(MARGIN + indent, this.y - lead + 0.5, PAGE_W - 2 * MARGIN - indent, lead, bg)
      this.y -= lead
      this.text(MARGIN + indent + (bg ? 6 : 0), this.y + size * 0.3, l, font, size)
    }
  }

  /**
   * Labelled code block: caption bar + framed light box with an accent bar on the left.
   * Lines that fit are drawn token by token (keywords bold, strings/comments coloured);
   * long lines are wrapped and drawn plain.
   */
  codeBlock(code: string, lang: CodeLang, caption: string): void {
    const size = 7.5
    const lead = size * 1.32
    const cw = size * CHAR
    const left = MARGIN
    const width = PAGE_W - 2 * MARGIN
    const textX = left + 10
    const maxChars = Math.floor((width - 16) / cw)
    const capH = 12

    this.ensure(capH + lead * 2)
    this.rect(left, this.y - capH, width, capH, "E8ECF1")
    this.rect(left, this.y - capH, 3, capH, "0B4F9C")
    this.text(textX, this.y - capH + 3.5, caption, "F2", 7, "44546A")
    this.y -= capH

    const lines = tokenize(code, lang)
    for (const tokens of lines) {
      const raw = tokens.map(t => t.text).join("")
      const pieces = raw.length <= maxChars ? [null] : wrapText(raw, maxChars)
      for (const piece of pieces) {
        if (this.y - lead < BOTTOM) {
          this.newPage()
          this.rect(left, this.y - capH, width, capH, "E8ECF1")
          this.rect(left, this.y - capH, 3, capH, "0B4F9C")
          this.text(textX, this.y - capH + 3.5, caption + " (continued)", "F2", 7, "44546A")
          this.y -= capH
        }
        this.rect(left, this.y - lead, width, lead, "F6F8FA")
        this.rect(left, this.y - lead, 3, lead, "0B4F9C")
        const baseY = this.y - lead + size * 0.35
        if (piece === null) {
          let col = 0
          for (const t of tokens) {
            if (t.text.trim())
              this.text(
                textX + col * cw,
                baseY,
                t.text,
                t.kind === "kw" ? "F2" : "F1",
                size,
                TOKEN_COLORS[t.kind]
              )
            col += toWinAnsi(t.text).length
          }
        } else {
          this.text(textX, baseY, piece, "F1", size, TOKEN_COLORS.plain)
        }
        this.y -= lead
      }
    }
    this.gap(4)
  }

  markdown(md: string): void {
    for (const b of splitMarkdown(md)) {
      if (b.type === "code") this.codeBlock(b.code, b.lang, codeCaption(b.lang))
      else if (b.type === "table")
        this.table({ columns: b.columns, rows: b.rows, totalRows: b.rows.length }, false)
      else this.markdownText(b.lines)
    }
  }

  private markdownText(lines: string[]): void {
    for (const raw of lines) {
      const line = raw.replace(/\*\*|__|`/g, "")
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h) {
        this.heading(h[2], Math.max(9, 15 - h[1].length * 1.5))
        continue
      }
      if (/^\s*-{3,}\s*$/.test(line)) continue // horizontal rule
      if (!line.trim()) {
        this.gap(4)
        continue
      }
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
      const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line)
      this.paragraph(
        bullet
          ? "- " + bullet[1]
          : numbered
            ? `${numbered[1]}. ${numbered[2]}`
            : line.replace(/^>\s?/, ""),
        8.5,
        "F1",
        undefined,
        bullet || numbered ? 8 : 0
      )
    }
  }

  table(t: ExportTable, footer = true): void {
    if (t.columns.length === 0) {
      this.paragraph("(no rows)")
      return
    }
    const rows = t.rows.slice(0, PDF_MAX_TABLE_ROWS)
    const size = t.columns.length > 10 ? 6 : 7
    const cw = size * CHAR
    const pad = 3
    const avail = PAGE_W - 2 * MARGIN
    const sample = rows.slice(0, 400)
    let widths = t.columns.map((c, i) => {
      const longest = Math.max(c.length, ...sample.map(r => (r[i] ?? "").length))
      return Math.min(Math.max(longest, 3), 48) * cw + 2 * pad
    })
    const total = widths.reduce((a, b) => a + b, 0)
    if (total > avail) {
      const minW = 4 * cw + 2 * pad
      widths = widths.map(w => Math.max(minW, (w * avail) / total))
      const again = widths.reduce((a, b) => a + b, 0)
      if (again > avail) widths = widths.map(w => (w * avail) / again)
    }
    const lead = size * 1.25
    const cellLines = (vals: string[]) =>
      vals.map((v, i) => wrapText(v ?? "", (widths[i] - 2 * pad) / cw))

    const drawRow = (vals: string[], header: boolean) => {
      const lines = cellLines(vals)
      const h = Math.max(...lines.map(l => l.length)) * lead + 2 * pad - 1
      if (this.y - h < BOTTOM) {
        this.newPage()
        if (!header) drawRow(t.columns, true)
      }
      let x = MARGIN
      const top = this.y
      vals.forEach((v, i) => {
        const k = header ? undefined : statusKind(v)
        if (header) this.rect(x, top - h, widths[i], h, "E8EAED")
        else if (k) this.rect(x, top - h, widths[i], h, STATUS_COLORS[k])
        lines[i].forEach((l, j) =>
          this.text(
            x + pad,
            top - pad - (j + 1) * lead + size * 0.3,
            l,
            header || k ? "F2" : "F1",
            size
          )
        )
        x += widths[i]
      })
      this.y = top - h
      this.hline(
        MARGIN,
        MARGIN + widths.reduce((a, b) => a + b, 0),
        this.y,
        header ? "888888" : "D0D0D0"
      )
    }

    drawRow(t.columns, true)
    for (const r of rows) drawRow(r, false)
    this.gap(3)
    if (!footer) return
    this.paragraph(
      `${t.totalRows} row(s)` +
        (t.rows.length > PDF_MAX_TABLE_ROWS
          ? ` - first ${PDF_MAX_TABLE_ROWS} shown; export to Excel/CSV for all rows`
          : ""),
      7,
      "F1"
    )
  }

  finish(): Buffer {
    this.pages.push(this.ops.join("\n"))
    const objs: string[] = []
    const fontIds = [3, 4, 5]
    const pageIds = this.pages.map((_, i) => 6 + i * 2)
    objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`
    ;["Courier", "Courier-Bold", "Helvetica-Bold"].forEach((f, i) => {
      objs[fontIds[i]] =
        `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`
    })
    this.pages.forEach((content, i) => {
      const pid = pageIds[i]
      objs[pid] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pid + 1} 0 R >>`
      objs[pid + 1] =
        `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`
    })
    objs.push(
      `<< /Title ${pdfStr(this.title)} /Producer (ABAP FS SAP Data Workbook) /CreationDate (D:${new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14)}) >>`
    )
    const infoId = objs.length - 1
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"
    const offsets: number[] = []
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = Buffer.byteLength(out, "latin1")
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`
    }
    const xref = Buffer.byteLength(out, "latin1")
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
    for (let i = 1; i < objs.length; i++)
      out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(out, "latin1")
  }
}

const stripHtml = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")

export function writePdf(m: ExportModel): Buffer {
  const doc = new PdfDoc(m.title)
  doc.heading(m.title, 18)
  doc.paragraph(
    `Exported ${m.generated}${m.source ? ` from ${m.source}` : ""} - ${m.parts.join(", ")}`,
    8,
    "F1"
  )
  doc.gap(6)
  for (const i of m.items) {
    doc.ensure(40)
    doc.gap(6)
    doc.paragraph(`${cellLabel(i)}  [${i.kind}]`, 8, "F2", "EEF1F5")
    doc.gap(3)
    if (i.kind === "comment") doc.markdown(i.text ?? "")
    else if (i.kind === "code")
      doc.codeBlock(
        i.text ?? "",
        langOf(i.language),
        codeCaption(langOf(i.language), i.name, i.system)
      )
    else if (i.table) doc.table(i.table)
    else if (i.contentType === "html") doc.paragraph(stripHtml(i.text ?? ""), 8)
    else if (i.contentType === "markdown") doc.markdown(i.text ?? "")
    else {
      const lang = itemCodeLang(i)
      if (lang) doc.codeBlock(i.text ?? "", lang, codeCaption(lang))
      else doc.paragraph(i.text ?? "", 8.5) // plain text: prose, line breaks kept
    }
  }
  return doc.finish()
}
