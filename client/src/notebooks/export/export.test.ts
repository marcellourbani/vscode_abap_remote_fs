import ExcelJS from "exceljs"
import { buildExportModel, type ExportCellInput } from "./exportModel"
import { writeCsvFiles, writeHtml, writeJson, writeMarkdown, writeXml } from "./textWriters"
import { toWinAnsi, wrapText, writePdf } from "./pdfWriter"
import { writeDocx, writeXlsx } from "./officeWriters"
import { createDisplayHelpers } from "../display"

const display = createDisplayHelpers()
const date = new Date("2026-09-01T00:00:00Z")

const cells: ExportCellInput[] = [
  { index: 0, kind: "markdown", source: "# Role check\n\nCompares **DEV** vs QAS." },
  {
    index: 1,
    kind: "sql",
    name: "s1_define",
    system: "DEV",
    source: "SELECT agr_name FROM agr_define",
    result: { result: [{ AGR_NAME: "Z_R", CHANGE_DAT: date }], system: "dev" }
  },
  {
    index: 2,
    kind: "javascript",
    name: "summary",
    source: "return display.table(rows)",
    result: {
      result: [
        { Status: "RED", Check: "Auth", Finding: 'a,"b"' },
        { Status: "GREEN", Check: "Menu", Finding: "—" }
      ],
      display: display.table([
        { Status: "RED", Check: "Auth", Finding: 'a,"b"' },
        { Status: "GREEN", Check: "Menu", Finding: "—" }
      ])
    }
  },
  {
    index: 3,
    kind: "javascript",
    source: "return display.markdown('**ok**')",
    result: { result: "**ok**", display: display.markdown("**ok**") }
  },
  {
    index: 4,
    kind: "javascript",
    source: "return {a:1}",
    result: { result: { a: 1, when: date } }
  },
  { index: 5, kind: "sql", source: "SELECT 1", result: { result: undefined, error: "boom" } }
]

describe("export model", () => {
  test("all parts, in cell order, errors skipped", () => {
    const m = buildExportModel(cells, ["data", "code", "comments"], "T", "x.sapwb", date)
    expect(m.items.map(i => `${i.index}:${i.kind}`)).toEqual([
      "0:comment",
      "1:code",
      "1:data",
      "2:code",
      "2:data",
      "3:code",
      "3:data",
      "4:code",
      "4:data",
      "5:code"
    ])
    const t = m.items.find(i => i.index === 1 && i.kind === "data")!.table!
    expect(t.rows[0]).toEqual(["Z_R", "2026-09-01"])
    expect(m.items.find(i => i.index === 1 && i.kind === "data")!.system).toBe("dev")
  })

  test("pick any subset", () => {
    expect(buildExportModel(cells, ["comments"], "T").items.every(i => i.kind === "comment")).toBe(
      true
    )
    expect(buildExportModel(cells, ["data"], "T").items.every(i => i.kind === "data")).toBe(true)
    expect(
      buildExportModel(cells, ["code", "comments"], "T").items.some(i => i.kind === "data")
    ).toBe(false)
  })
})

describe("writers", () => {
  const m = buildExportModel(cells, ["data", "code", "comments"], "Role <check>", "x.sapwb", date)

  test("JSON is valid and keeps rows as objects", () => {
    const j = JSON.parse(writeJson(m))
    const summary = j.items.find((i: any) => i.name === "summary" && i.kind === "data")
    expect(summary.rows[0]).toEqual({ Status: "RED", Check: "Auth", Finding: 'a,"b"' })
    expect(j.items.find((i: any) => i.cell === 4 && i.kind === "data").content).toEqual({
      a: 1,
      when: "2026-09-01"
    })
  })

  test("XML is well formed and escaped", () => {
    const x = writeXml(m)
    expect(x).toContain('<workbook title="Role &lt;check&gt;"')
    expect(x).toContain('<field name="Finding">a,&quot;b&quot;</field>')
    expect(x).toContain("<![CDATA[SELECT agr_name FROM agr_define]]>")
    // balanced data elements
    expect((x.match(/<data /g) || []).length).toBe(
      (x.match(/<\/data>|<data [^>]*\/>|<data [^>]*>.*<\/data>/g) || []).length
    )
  })

  test("HTML is self-contained with highlighted statuses", () => {
    const h = writeHtml(m, md => `<p>${md}</p>`)
    expect(h.startsWith("<!doctype html>")).toBe(true)
    expect(h).toContain("background:#F8C9CE")
    expect(h).toContain("Role &lt;check&gt;")
    expect(h).not.toContain("<script")
  })

  test("Markdown escapes pipes", () => {
    const md = writeMarkdown(
      buildExportModel(
        [{ index: 0, kind: "javascript", source: "", result: { result: [{ A: "x|y" }] } }],
        ["data"],
        "T"
      )
    )
    expect(md).toContain("| x\\|y |")
  })

  test("CSV: one file per table, quoted, with BOM", () => {
    const files = writeCsvFiles(m)
    expect(files.map(f => f.suffix)).toEqual(["_cell1_s1_define", "_cell2_summary"])
    expect(files[1].content).toBe('﻿Status,Check,Finding\r\nRED,Auth,"a,""b"""\r\nGREEN,Menu,—\r\n')
  })

  test("PDF: valid structure, xref offsets correct, text transliterated", () => {
    const buf = writePdf(m)
    const s = buf.toString("latin1")
    expect(s.startsWith("%PDF-1.4")).toBe(true)
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true)
    const startxref = parseInt(/startxref\n(\d+)/.exec(s)![1], 10)
    expect(s.slice(startxref, startxref + 4)).toBe("xref")
    // every xref entry points at "N 0 obj"
    const entries = s
      .slice(startxref)
      .split("\n")
      .filter(l => / 00000 n $/.test(l))
    entries.forEach((e, i) => {
      const off = parseInt(e.slice(0, 10), 10)
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
    expect(s).toContain("(RED)")
    expect(s).not.toContain("—")
  })

  test("PDF: large table spans pages with repeated header", () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({
      Sev: i % 2 ? "RED" : "GREEN",
      Object: "S_TCODE",
      Value: "ZYFIN_" + i
    }))
    const s = writePdf(
      buildExportModel(
        [{ index: 0, kind: "javascript", source: "", result: { result: rows } }],
        ["data"],
        "Big"
      )
    ).toString("latin1")
    const pages = (s.match(/\/Type \/Page /g) || []).length
    expect(pages).toBeGreaterThan(3)
    expect((s.match(/\(Object\) Tj/g) || []).length).toBe(pages)
  })

  test("wrapText and toWinAnsi", () => {
    const lines = wrapText("Z_ROLE:FI_GENERAL_LEDGER_DISPLAY and more words here", 12)
    expect(lines.every(l => l.length <= 12)).toBe(true)
    expect(lines.join("").replace(/ /g, "")).toBe(
      "Z_ROLE:FI_GENERAL_LEDGER_DISPLAYandmorewordshere"
    )
    expect(wrapText("aaaa bbbb cccc", 9)).toEqual(["aaaa bbbb", "cccc"])
    expect(toWinAnsi("a—b…✓")).toBe("a-b...v")
    expect(toWinAnsi("\u{1F534} RED ⚠️ ✅")).toBe(" RED [!] [OK]")
  })

  test("Excel: contents sheet, one sheet per table, status fill", async () => {
    const buf = await writeXlsx(m)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const names = wb.worksheets.map(w => w.name)
    expect(names).toEqual(["Contents", "1_s1_define", "2_summary", "Code & Comments"])
    const ws = wb.getWorksheet("2_summary")!
    expect(ws.getCell("A2").value).toBe("Status")
    expect(ws.getCell("A3").value).toBe("RED")
    expect((ws.getCell("A3").fill as any).fgColor.argb).toBe("FFF8C9CE")
  })

  test("Word: produces a docx (zip) with the content", async () => {
    const buf = await writeDocx(m)
    expect(buf.subarray(0, 2).toString()).toBe("PK")
    expect(buf.length).toBeGreaterThan(3000)
  })
})

// ── code blocks ──────────────────────────────────────────────────────────────
import { tokenize, langOf } from "./codeFormat"
import { inflateRawSync } from "zlib"

/** Minimal zip reader (central directory + deflate) — enough to read word/document.xml. */
function readZipEntry(buf: Buffer, name: string): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let p = buf.readUInt32LE(eocd + 16)
  const count = buf.readUInt16LE(eocd + 10)
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30)
    const comment = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const entry = buf.toString("utf8", p + 46, p + 46 + nameLen)
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8")
    }
    p += 46 + nameLen + extra + comment
  }
  throw new Error(`${name} not found in zip`)
}

describe("code blocks in exports", () => {
  const sql =
    "SELECT agr_name, low\n  FROM agr_1251\n  WHERE agr_name = ${cells.params.result.ROLE_NAME}\n    AND low = 'it''s'\n  ORDER BY agr_name ASCENDING"
  const js =
    "// summary\nconst rows = cells.s1.result\n/* block\n comment */\nreturn `n=${rows.length}`"
  const codeCells: ExportCellInput[] = [
    { index: 3, kind: "sql", name: "s1_auth", system: "erp100", source: sql },
    { index: 4, kind: "javascript", name: "summary", source: js }
  ]
  const m = buildExportModel(codeCells, ["code"], "Code")
  const kinds = (line: any[]) =>
    line.map(t => `${t.kind}:${t.text.trim()}`).filter(s => !s.endsWith(":"))

  test("ABAP SQL tokens: keywords, ${...} interpolation, doubled-quote strings", () => {
    const l = tokenize(sql, "sql")
    expect(kinds(l[0])).toEqual(["kw:SELECT", "plain:agr_name, low"])
    expect(kinds(l[2])).toEqual([
      "kw:WHERE",
      "plain:agr_name =",
      "var:${cells.params.result.ROLE_NAME}"
    ])
    expect(kinds(l[3])).toEqual(["kw:AND", "plain:low =", "str:'it''s'"])
    expect(kinds(l[4])).toContain("kw:ASCENDING")
  })

  test("JavaScript tokens: line + block comments over lines, template strings", () => {
    const l = tokenize(js, "javascript")
    expect(kinds(l[0])).toEqual(["com:// summary"])
    expect(kinds(l[2])).toEqual(["com:/* block"])
    expect(kinds(l[3])).toEqual(["com:comment */"])
    expect(kinds(l[4])).toEqual(["kw:return", "str:`n=${rows.length}`"])
    expect(langOf("abap-sql")).toBe("sql")
  })

  test("HTML: labelled, highlighted code block", () => {
    const h = writeHtml(m, md => md)
    expect(h).toContain("<figcaption>ABAP SQL · s1_auth · erp100</figcaption>")
    expect(h).toContain('<code class="language-sql"><span class="tok-kw">SELECT</span>')
    expect(h).toContain("<figcaption>JavaScript · summary</figcaption>")
    expect(h).toContain('<span class="tok-var">${cells.params.result.ROLE_NAME}</span>')
  })

  test("Markdown: caption + sql / javascript fences", () => {
    const md = writeMarkdown(m)
    expect(md).toContain("*ABAP SQL · s1_auth · erp100*\n\n```sql\nSELECT agr_name, low")
    expect(md).toContain("*JavaScript · summary*\n\n```javascript\n// summary")
    // a fence grows when the code itself contains ```
    const tricky = buildExportModel(
      [{ index: 0, kind: "javascript", source: "const md = '```x```'" }],
      ["code"],
      "T"
    )
    expect(writeMarkdown(tricky)).toContain("````javascript\nconst md = '```x```'\n````")
  })

  test("JSON / XML mark code cells", () => {
    const j = JSON.parse(writeJson(m))
    expect(j.items[0]).toMatchObject({ kind: "code", format: "code", language: "abap-sql" })
    expect(writeXml(m)).toContain('language="abap-sql" format="code"><![CDATA[SELECT')
  })

  test("PDF: caption bar and keyword drawn bold", () => {
    const s = writePdf(m).toString("latin1")
    expect(s).toContain("(ABAP SQL - s1_auth - erp100) Tj".replace(/ - /g, " \xB7 "))
    expect(s).toMatch(/\/F2 7\.5 Tf [\d.]+ [\d.]+ Td \(SELECT\) Tj/)
  })

  test("Word: caption and Consolas code box with coloured keywords", async () => {
    const xml = readZipEntry(await writeDocx(m), "word/document.xml")
    expect(xml).toContain("ABAP SQL · s1_auth · erp100")
    expect(xml).toMatch(/w:ascii="Consolas"/)
    expect(xml).toMatch(/<w:b\/>.*?<w:color w:val="0B4F9C"\/>.*?SELECT/s)
    expect(xml).toContain('w:fill="F6F8FA"')
  })

  test("Excel: code as rich text with language label", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await writeXlsx(m)) as any)
    const ws = wb.getWorksheet("Code & Comments")!
    expect(ws.getCell("E2").value).toBe("ABAP SQL")
    const rt = (ws.getCell("F2").value as any).richText
    expect(rt[0]).toMatchObject({ text: "SELECT", font: { bold: true, name: "Consolas" } })
  })
})

describe("what becomes a code block in exports", () => {
  const rawXml = '<role name="Z_R"><auth obj="S_TCODE"/></role>'
  const rawJson = '{"a":1,   "kept":"as is"}'
  const cells: ExportCellInput[] = [
    {
      index: 0,
      kind: "markdown",
      source:
        "# Notes\n\n| Check | Rule |\n|---|---|\n| Menu | YELLOW |\n\n```sql\nSELECT 1 FROM t000\n```\nafter"
    },
    {
      index: 1,
      kind: "javascript",
      name: "compare",
      source: "",
      result: {
        result: { summary: [{ Status: "RED" }] },
        display: display.all(
          display.markdown("## RED verdict"),
          display.table([{ Status: "RED", Check: "Auth" }])
        )
      }
    },
    {
      index: 2,
      kind: "javascript",
      name: "x",
      source: "",
      result: { result: rawXml, display: display.xml(rawXml) }
    },
    {
      index: 3,
      kind: "javascript",
      name: "j",
      source: "",
      result: { result: rawJson, display: display.json(rawJson) }
    },
    {
      index: 4,
      kind: "javascript",
      name: "s",
      source: "",
      result: { result: "Just a sentence.\nSecond line." }
    },
    {
      index: 5,
      kind: "javascript",
      name: "h",
      source: "",
      result: { result: "<b>hi</b>", display: display.html("<b>hi</b>") }
    },
    {
      index: 6,
      kind: "javascript",
      name: "xo",
      source: "",
      result: { result: [{ A: 1 }], display: display.xml([{ A: 1 }]) }
    }
  ]
  const m = buildExportModel(cells, ["data", "comments"], "T")
  const data = m.items.filter(i => i.kind === "data")

  test("every output of a cell is exported, in order", () => {
    expect(data.filter(i => i.index === 1).map(i => (i.table ? "table" : i.contentType))).toEqual([
      "markdown",
      "table"
    ])
  })

  test("JSON / XML exported verbatim; XML objects converted; strings are text", () => {
    expect(data.find(i => i.name === "x")).toMatchObject({ contentType: "xml", text: rawXml })
    expect(data.find(i => i.name === "j")).toMatchObject({ contentType: "json", text: rawJson })
    expect(data.find(i => i.name === "xo")!.text).toContain("<row>")
    expect(data.find(i => i.name === "s")).toMatchObject({ contentType: "text" })
  })

  test("HTML: JSON/XML are code blocks; string, html, markdown, tables are not", () => {
    const h = writeHtml(m, md => `<p>${md}</p>`)
    expect(h).toContain("<figcaption>XML</figcaption>")
    expect(h).toContain("<figcaption>JSON</figcaption>")
    expect(h).toContain('<div class="text">Just a sentence.\nSecond line.</div>')
    expect(h).not.toContain("<figcaption>Text</figcaption>")
    expect(h).toContain('<div class="html"><b>hi</b></div>')
  })

  test("Markdown: fences only for JSON/XML; raw XML not reformatted", () => {
    const md = writeMarkdown(m)
    expect(md).toContain("*XML*\n\n```xml\n" + rawXml + "\n```")
    expect(md).toContain("*JSON*\n\n```json\n" + rawJson + "\n```")
    expect(md).toContain("Just a sentence.\nSecond line.")
    expect(md).not.toContain("```text")
  })

  test("PDF: markdown tables and fenced code in comments; strings as prose", () => {
    const s = writePdf(m).toString("latin1")
    expect(s).toContain("(Check) Tj") // markdown table header drawn as a table
    expect(s).not.toContain("(| Check | Rule |) Tj")
    expect(s).toContain("(ABAP SQL) Tj") // fenced ```sql in a comment -> labelled code block
    expect(s).toContain("(XML) Tj")
    expect(s).not.toContain("(Text) Tj")
  })

  test("Word: markdown table becomes a table; string is not Consolas", async () => {
    const xml = readZipEntry(await writeDocx(m), "word/document.xml")
    expect(xml).toMatch(/<w:tbl>.*?Check.*?Rule.*?<\/w:tbl>/s)
    expect(xml).not.toContain("| Check |")
    const sentence = xml.slice(
      Math.max(0, xml.indexOf("Just a sentence") - 300),
      xml.indexOf("Just a sentence")
    )
    expect(sentence).not.toContain("Consolas")
  })
})
