export const NOTEBOOK_TYPE = "sap-data-workbook"
export const FILE_EXTENSION = ".sapwb"

export type CellType = "sql" | "javascript" | "markdown"

export const SQL_LANGUAGE_ID = "abap-sql"

export interface AbapNotebookCell {
  type: CellType
  content: string
  maxRows?: number
}

export interface AbapNotebookDocument {
  version: number
  connectionId?: string
  title?: string
  cells: AbapNotebookCell[]
}

export interface CellResult {
  result: unknown
  rowCount?: number
  columns?: Array<{ name: string; type: string }>
  error?: string
  logs?: string[]
}

export interface CellExecutionContext {
  cellIndex: number
  cellResults: Map<number, CellResult>
  connectionId: string
}

export const DEFAULT_MAX_ROWS = 1000
export const DISPLAY_ROW_LIMIT = 200
export const JS_EXECUTION_TIMEOUT_MS = 30_000
