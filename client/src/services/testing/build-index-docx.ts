import {
  Document,
  Header,
  HeadingLevel,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TextRun,
  WidthType
} from "docx"
import * as fs from "fs/promises"
import * as path from "path"
import { borderedTable, borderedTableCell } from "./docx-table"

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  const cells: string[] = []
  let current = ""
  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed[index]
    if (character === "\\" && trimmed[index + 1] === "|") {
      current += "|"
      index++
    } else if (character === "|") {
      cells.push(current.trim())
      current = ""
    } else {
      current += character
    }
  }
  cells.push(current.trim())
  return cells
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function plainMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^_([^]+)_$/, "$1")
}

function markdownTable(lines: string[]): Table | undefined {
  const rows = lines.map(tableCells)
  if (rows.length < 2 || !isSeparatorRow(rows[1])) return undefined
  const dataRows = [rows[0], ...rows.slice(2)]
  return borderedTable({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: dataRows.map(
      (cells, rowIndex) =>
        new TableRow({
          children: cells.map(cell =>
            borderedTableCell({
              shading: rowIndex === 0 ? { fill: "D9EAF7" } : undefined,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: plainMarkdown(cell),
                      bold: rowIndex === 0,
                      size: 16
                    })
                  ],
                  spacing: { before: 20, after: 20 }
                })
              ]
            })
          )
        })
    )
  })
}

function markdownChildren(markdown: string): Array<Paragraph | Table> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  let start = 0
  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    if (closing >= 0) start = closing + 1
  }

  const children: Array<Paragraph | Table> = []
  for (let index = start; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (!trimmed || trimmed === "---") continue

    if (trimmed.startsWith("|")) {
      const tableLines = [trimmed]
      while (index + 1 < lines.length && lines[index + 1].trim().startsWith("|")) {
        tableLines.push(lines[++index].trim())
      }
      const table = markdownTable(tableLines)
      if (table) {
        children.push(table, new Paragraph(""))
      } else {
        children.push(new Paragraph(plainMarkdown(tableLines.join(" "))))
      }
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      const level =
        heading[1].length === 1
          ? HeadingLevel.TITLE
          : heading[1].length === 2
            ? HeadingLevel.HEADING_1
            : HeadingLevel.HEADING_2
      children.push(
        new Paragraph({
          text: plainMarkdown(heading[2]),
          heading: level
        })
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      children.push(
        new Paragraph({
          text: plainMarkdown(trimmed.replace(/^[-*]\s+/, "")),
          bullet: { level: 0 }
        })
      )
      continue
    }

    children.push(
      new Paragraph({
        text: plainMarkdown(trimmed),
        spacing: { after: 120 }
      })
    )
  }
  return children
}

export async function buildTestIndexDocx(testFolder: string, program: string): Promise<string> {
  const testCasesDir = path.resolve(testFolder, "tests", program, "test-cases")
  const indexPath = path.join(testCasesDir, "_index.md")
  let markdown: string
  try {
    markdown = await fs.readFile(indexPath, "utf8")
  } catch {
    throw new Error(`Test-case index does not exist: ${indexPath}`)
  }
  if (!markdown.trim()) throw new Error(`Test-case index is empty: ${indexPath}`)

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, right: 540, bottom: 720, left: 540 }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: `${program}  •  Test-case index`, bold: true })]
              })
            ]
          })
        },
        children: markdownChildren(markdown)
      }
    ]
  })
  const outputPath = path.join(testCasesDir, "_index.docx")
  const buffer = await Packer.toBuffer(document)
  return writeDocxResiliently(outputPath, buffer)
}

/**
 * Write the DOCX even when the target is momentarily locked by another process
 * (the classic case: the user is previewing `_index.docx` in Word/WordPad, which
 * takes an exclusive lock on Windows). Strategy, in order:
 *
 *   1. Write to a temp sibling, then atomically rename over the target. The rename
 *      is what actually touches the locked file, so retry it a few times with a short
 *      backoff to ride out a transient lock (e.g. Word releasing between refreshes).
 *   2. If the target is still locked after all retries, DO NOT fail the whole tool —
 *      write a timestamped fallback file beside it and return that path with a clear
 *      note, so the caller/user still gets a fresh document instead of a hard error.
 *
 * The old behavior threw straight from `fs.writeFile`, which surfaced as an opaque
 * EBUSY/EPERM and forced the user to hunt down and kill the lock by hand.
 */
async function writeDocxResiliently(outputPath: string, buffer: Buffer): Promise<string> {
  const dir = path.dirname(outputPath)
  const tmpPath = path.join(dir, `.${path.basename(outputPath)}.${process.pid}.tmp`)
  await fs.writeFile(tmpPath, buffer)

  const isLockError = (e: unknown): boolean => {
    const code = (e as NodeJS.ErrnoException)?.code
    return code === "EBUSY" || code === "EPERM" || code === "EACCES"
  }

  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(tmpPath, outputPath)
      return outputPath
    } catch (e) {
      if (!isLockError(e) || attempt === maxAttempts) break
      await new Promise(resolve => setTimeout(resolve, 400 * attempt))
    }
  }

  // Target still locked — publish a timestamped fallback instead of failing.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const fallbackPath = outputPath.replace(/\.docx$/i, `.${stamp}.docx`)
  try {
    await fs.rename(tmpPath, fallbackPath)
  } catch {
    await fs.writeFile(fallbackPath, buffer)
    await fs.rm(tmpPath, { force: true }).catch(() => {})
  }
  throw new Error(
    `Could not overwrite ${outputPath} — it is locked by another program ` +
      `(most likely open in Word/WordPad). Close it and rebuild, or use the freshly ` +
      `written copy at ${fallbackPath}.`
  )
}
