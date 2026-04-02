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
    const text = new TextDecoder().decode(content)
    const parseResult = parseNotebookJson(text)
    const cells = parseResult.doc.cells.map(cellToNotebookCell)

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
    }

    const notebookData = new vscode.NotebookData(cells)
    notebookData.metadata = {
      version: parseResult.doc.version,
      connectionId: parseResult.doc.connectionId || "",
      title: parseResult.doc.title || "",
      ...(parseResult.corrupt ? { [CORRUPT_MARKER]: text } : {})
    }
    return notebookData
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const metadata = (data.metadata as Record<string, any>) || {}

    const realCells = data.cells.filter(c => !c.metadata?.[CORRUPT_WARNING_TAG])

    if (realCells.length === 0 && metadata[CORRUPT_MARKER]) {
      return new TextEncoder().encode(metadata[CORRUPT_MARKER])
    }

    const filteredData = new vscode.NotebookData(realCells)
    filteredData.metadata = data.metadata
    const doc = notebookDataToDocument(filteredData)
    const json = JSON.stringify(doc, null, 2)
    return new TextEncoder().encode(json)
  }
}

interface ParseResult {
  doc: AbapNotebookDocument
  corrupt: boolean
}

function parseNotebookJson(text: string): ParseResult {
  if (!text.trim()) {
    return { doc: { version: 1, cells: [] }, corrupt: false }
  }
  try {
    const raw = JSON.parse(text)
    return {
      doc: {
        version: raw.version ?? 1,
        connectionId: raw.connectionId,
        title: raw.title,
        cells: Array.isArray(raw.cells) ? raw.cells.map(normalizeCell) : []
      },
      corrupt: false
    }
  } catch (e: any) {
    log(`Warning: .sapwb file contains invalid JSON: ${e.message}`)
    vscode.window.showWarningMessage(
      "SAP Data Workbook file contains invalid JSON. Original content will be preserved on save."
    )
    return { doc: { version: 1, cells: [] }, corrupt: true }
  }
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
    const type = LANGUAGE_TO_CELL_TYPE[cell.languageId] ?? "markdown"
    const result: AbapNotebookCell = { type, content: cell.value }
    const maxRows = cell.metadata?.maxRows
    if (typeof maxRows === "number") {
      result.maxRows = maxRows
    }
    return result
  })

  return {
    version: metadata.version ?? 1,
    connectionId: metadata.connectionId !== undefined && metadata.connectionId !== ""
      ? metadata.connectionId
      : undefined,
    title: metadata.title || undefined,
    cells
  }
}

function normalizeCellType(raw: unknown): CellType {
  if (raw === "sql" || raw === "javascript" || raw === "markdown") return raw
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
