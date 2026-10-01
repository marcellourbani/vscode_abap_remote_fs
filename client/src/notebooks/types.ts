export const NOTEBOOK_TYPE = "sap-data-workbook"
export const FILE_EXTENSION = ".sapwb"

export type CellType = "sql" | "javascript" | "markdown"

export const SQL_LANGUAGE_ID = "abap-sql"

export interface AbapNotebookCell {
  type: CellType
  content: string
  maxRows?: number
  /** Stable name used to reference this cell: cells.<name> (JS) / ${cells.<name>.result...} (SQL). */
  name?: string
  /**
   * ABAP FS connection id. Applies to this cell and every following cell until the next cell
   * that sets a system ("sticky" marker).
   */
  system?: string
}

export interface AbapNotebookDocument {
  version: number
  title?: string
  cells: AbapNotebookCell[]
}

/** Rich output returned by a JS cell through the `display.*` helpers. */
export type DisplayKind = "html" | "markdown" | "json" | "xml" | "table" | "text"

export interface DisplayOptions {
  /** Wrap long cell values in tables (default: setting abapfs.workbook.tableWrap). */
  wrap?: boolean
  /** Colour cells whose value is RED/YELLOW/GREEN/PASS/WARN/FAIL/ERROR. */
  highlight?: boolean
  /** Maximum rows rendered for tables (data passed to later cells is never cut). */
  limit?: number
  /** Optional heading shown above the output. */
  title?: string
}

export interface DisplayValue {
  __sapwbDisplay: DisplayKind
  content: unknown
  options?: DisplayOptions
  /** Data made available to later cells (defaults to content). */
  data?: unknown
  hasData?: boolean
}

export interface CellResult {
  result: unknown
  rowCount?: number
  columns?: Array<{ name: string; type: string }>
  error?: string
  logs?: string[]
  /** System the cell ran against (SQL cells). */
  system?: string
  /** Rich rendering requested by a JS cell. */
  display?: DisplayValue | DisplayValue[]
}

export interface CellExecutionContext {
  cellIndex: number
  cellResults: Map<number, CellResult>
  connectionId: string
}

export const DEFAULT_MAX_ROWS = 1000
export const DISPLAY_ROW_LIMIT = 200
export const MAX_DISPLAY_ROW_LIMIT = 5000
export const JS_EXECUTION_TIMEOUT_MS = 30_000
