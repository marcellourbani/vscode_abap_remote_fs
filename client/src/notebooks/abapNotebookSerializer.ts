import * as vscode from "vscode"
import { NOTEBOOK_TYPE, AbapNotebookDocument, AbapNotebookCell, CellType, SQL_LANGUAGE_ID } from "./types"
import { log } from "../lib"

const CELL_TYPE_TO_LANGUAGE: Record<CellType, string> = {
  sql: SQL_LANGUAGE_ID,
  javascript: "javascript",
  markdown: "markdown"
}

const LANGUAGE_TO_CELL_TYPE: Record<string, CellType> = {
  [SQL_LANGUAGE_ID]: "sql",
  sql: "sql",
  javascript: "javascript",
  markdown: "markdown"
}

const CORRUPT_MARKER = "__abapnb_corrupt_original__"
const CORRUPT_WARNING_TAG = "[ABAPNB_CORRUPT_FILE_WARNING]"

export class AbapNotebookSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    log.debug(`📒 [Serializer] deserializeNotebook called, content length: ${content.byteLength} bytes`)
    const text = new TextDecoder().decode(content)
    log.debug(`📒 [Serializer] decoded text length: ${text.length} chars`)
    if (text.length < 500) {
      log.debug(`📒 [Serializer] full content: ${JSON.stringify(text)}`)
    } else {
      log.debug(`📒 [Serializer] first 500 chars: ${JSON.stringify(text.substring(0, 500))}`)
    }

    const parseResult = parseNotebookJson(text)
    log.debug(`📒 [Serializer] parseResult: corrupt=${parseResult.corrupt}, cells=${parseResult.doc.cells.length}, version=${parseResult.doc.version}`)
    for (let i = 0; i < parseResult.doc.cells.length; i++) {
      const c = parseResult.doc.cells[i]
      log.debug(`📒 [Serializer]   cell[${i}]: type=${c.type}, content length=${c.content.length}, content preview=${JSON.stringify(c.content.substring(0, 80))}`)
    }

    const cells = parseResult.doc.cells.map(cellToNotebookCell)
    log.debug(`📒 [Serializer] mapped to ${cells.length} NotebookCellData items`)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      log.debug(`📒 [Serializer]   nbCell[${i}]: kind=${c.kind}, languageId=${c.languageId}, value length=${c.value.length}, value preview=${JSON.stringify(c.value.substring(0, 80))}`)
    }

    if (cells.length === 0 && parseResult.corrupt) {
      const warningCell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        `**Warning:** This file contained invalid JSON and could not be parsed.\n\n` +
        `If you save now without adding any cells, the original file content will be preserved. ` +
        `If you add new cells and save, the file will be replaced with valid notebook JSON.`,
        "markdown"
      )
      warningCell.metadata = { [CORRUPT_WARNING_TAG]: true }
      cells.push(warningCell)
      log.debug(`📒 [Serializer] added corrupt warning cell`)
    }

    const notebookData = new vscode.NotebookData(cells)
    notebookData.metadata = {
      version: parseResult.doc.version,
      title: parseResult.doc.title || "",
      ...(parseResult.corrupt ? { [CORRUPT_MARKER]: text } : {})
    }
    log.debug(`📒 [Serializer] returning NotebookData with ${cells.length} cells, metadata: version=${notebookData.metadata.version}, title=${notebookData.metadata.title}`)
    return notebookData
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    log.debug(`📒 [Serializer] serializeNotebook called, ${data.cells.length} cells`)
    const metadata = (data.metadata as Record<string, any>) || {}

    const realCells = data.cells.filter(c => !c.metadata?.[CORRUPT_WARNING_TAG])
    log.debug(`📒 [Serializer] realCells after filtering: ${realCells.length}`)

    if (realCells.length === 0 && metadata[CORRUPT_MARKER]) {
      log.debug(`📒 [Serializer] preserving corrupt original content`)
      return new TextEncoder().encode(metadata[CORRUPT_MARKER])
    }

    for (let i = 0; i < realCells.length; i++) {
      const c = realCells[i]
      log.debug(`📒 [Serializer]   serialize cell[${i}]: kind=${c.kind}, languageId=${c.languageId}, value length=${c.value.length}, value preview=${JSON.stringify(c.value.substring(0, 80))}`)
    }

    const filteredData = new vscode.NotebookData(realCells)
    filteredData.metadata = data.metadata
    const doc = notebookDataToDocument(filteredData)
    const json = JSON.stringify(doc, null, 2)
    log.debug(`📒 [Serializer] serialized JSON length: ${json.length}`)
    return new TextEncoder().encode(json)
  }
}

interface ParseResult {
  doc: AbapNotebookDocument
  corrupt: boolean
}

function parseNotebookJson(text: string): ParseResult {
  if (!text.trim()) {
    log.debug(`📒 [Parser] empty/whitespace-only content — returning empty doc`)
    return { doc: { version: 1, cells: [] }, corrupt: false }
  }

  log.debug(`📒 [Parser] attempting JSON.parse on ${text.length} chars`)
  let raw: any
  try {
    raw = JSON.parse(text)
    log.debug(`📒 [Parser] JSON.parse succeeded. typeof raw=${typeof raw}, isArray=${Array.isArray(raw)}`)
  } catch (e1: any) {
    log.debug(`📒 [Parser] JSON.parse failed: ${e1.message}`)
    try {
      log.debug(`📒 [Parser] attempting fixJsonNewlines...`)
      const fixed = fixJsonNewlines(text)
      log.debug(`📒 [Parser] fixJsonNewlines produced ${fixed.length} chars`)
      raw = JSON.parse(fixed)
      log.debug(`📒 [Parser] JSON.parse after fix succeeded`)
    } catch (e2: any) {
      log.debug(`📒 [Parser] JSON.parse after fix also failed: ${e2.message}`)
      log.debug(`Warning: .sapwb file contains invalid JSON: ${e2.message}`)
      vscode.window.showWarningMessage(
        "SAP Data Workbook file contains invalid JSON. Original content will be preserved on save."
      )
      return { doc: { version: 1, cells: [] }, corrupt: true }
    }
  }

  const hasCells = Array.isArray(raw.cells)
  log.debug(`📒 [Parser] raw.version=${raw.version}, raw.connectionId=${raw.connectionId}, raw.title=${raw.title}, raw.cells isArray=${hasCells}, raw.cells length=${hasCells ? raw.cells.length : "N/A"}`)
  if (hasCells && raw.cells.length > 0) {
    for (let i = 0; i < Math.min(raw.cells.length, 5); i++) {
      const c = raw.cells[i]
      log.debug(`📒 [Parser]   raw.cells[${i}]: type=${c?.type}, content type=${typeof c?.content}, content length=${typeof c?.content === "string" ? c.content.length : "N/A"}`)
    }
  }

  return {
    doc: {
      version: raw.version ?? 1,
      title: raw.title,
      cells: Array.isArray(raw.cells) ? raw.cells.map(normalizeCell) : []
    },
    corrupt: false
  }
}

function fixJsonNewlines(text: string): string {
  let result = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      result += ch
      escaped = false
      continue
    }

    if (ch === "\\" && inString) {
      escaped = true
      result += ch
      continue
    }

    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }

    if (inString) {
      if (ch === "\n") { result += "\\n"; continue }
      if (ch === "\r") { result += "\\r"; continue }
      if (ch === "\t") { result += "\\t"; continue }
    }

    result += ch
  }

  return result
}

function normalizeCell(raw: any): AbapNotebookCell {
  const type = normalizeCellType(raw.type)
  return {
    type,
    content: typeof raw.content === "string" ? raw.content : "",
    ...(typeof raw.maxRows === "number" ? { maxRows: raw.maxRows } : {})
  }
}

function cellToNotebookCell(cell: AbapNotebookCell): vscode.NotebookCellData {
  const language = CELL_TYPE_TO_LANGUAGE[cell.type] || "plaintext"
  const kind =
    cell.type === "markdown" ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code

  const cellData = new vscode.NotebookCellData(kind, cell.content, language)
  cellData.metadata = {
    ...(cell.maxRows !== undefined ? { maxRows: cell.maxRows } : {})
  }
  return cellData
}

function notebookDataToDocument(data: vscode.NotebookData): AbapNotebookDocument {
  const metadata = (data.metadata as Record<string, any>) || {}
  const cells: AbapNotebookCell[] = data.cells.map(cell => {
    const lang = cell.languageId === "sql" ? SQL_LANGUAGE_ID : cell.languageId
    const type = LANGUAGE_TO_CELL_TYPE[lang] ?? "markdown"
    const result: AbapNotebookCell = { type, content: cell.value }
    const maxRows = cell.metadata?.maxRows
    if (typeof maxRows === "number") {
      result.maxRows = maxRows
    }
    return result
  })

  return {
    version: metadata.version ?? 1,
    title: metadata.title || undefined,
    cells
  }
}

function normalizeCellType(raw: unknown): CellType {
  if (raw === "sql" || raw === "abap-sql" || raw === "javascript" || raw === "markdown") return raw === "abap-sql" ? "sql" : raw as CellType
  if (raw === "typescript" || raw === "ts" || raw === "js") return "javascript"
  return "markdown"
}

export function registerNotebookSerializer(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.workspace.registerNotebookSerializer(
    NOTEBOOK_TYPE,
    new AbapNotebookSerializer(),
    { transientOutputs: true }
  )
}
