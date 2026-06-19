import {
  NOTEBOOK_TYPE,
  FILE_EXTENSION,
  SQL_LANGUAGE_ID,
  DEFAULT_MAX_ROWS,
  DISPLAY_ROW_LIMIT,
  JS_EXECUTION_TIMEOUT_MS,
} from "./types"
import type { CellType, AbapNotebookCell, AbapNotebookDocument, CellResult, CellExecutionContext } from "./types"

describe("types constants", () => {
  test("NOTEBOOK_TYPE is the expected string", () => {
    expect(NOTEBOOK_TYPE).toBe("sap-data-workbook")
  })

  test("FILE_EXTENSION is .sapwb", () => {
    expect(FILE_EXTENSION).toBe(".sapwb")
  })

  test("SQL_LANGUAGE_ID is abap-sql", () => {
    expect(SQL_LANGUAGE_ID).toBe("abap-sql")
  })

  test("DEFAULT_MAX_ROWS is 1000", () => {
    expect(DEFAULT_MAX_ROWS).toBe(1000)
  })

  test("DISPLAY_ROW_LIMIT is 200", () => {
    expect(DISPLAY_ROW_LIMIT).toBe(200)
  })

  test("JS_EXECUTION_TIMEOUT_MS is 30 seconds", () => {
    expect(JS_EXECUTION_TIMEOUT_MS).toBe(30_000)
  })
})

describe("type shapes", () => {
  test("AbapNotebookCell accepts valid sql cell", () => {
    const cell: AbapNotebookCell = { type: "sql", content: "SELECT * FROM mara" }
    expect(cell.type).toBe("sql")
    expect(cell.content).toBe("SELECT * FROM mara")
    expect(cell.maxRows).toBeUndefined()
  })

  test("AbapNotebookCell accepts optional maxRows", () => {
    const cell: AbapNotebookCell = { type: "sql", content: "SELECT 1", maxRows: 500 }
    expect(cell.maxRows).toBe(500)
  })

  test("AbapNotebookDocument has required fields", () => {
    const doc: AbapNotebookDocument = { version: 1, cells: [] }
    expect(doc.version).toBe(1)
    expect(doc.cells).toEqual([])
    expect(doc.title).toBeUndefined()
  })

  test("AbapNotebookDocument with title", () => {
    const doc: AbapNotebookDocument = { version: 2, title: "My Workbook", cells: [] }
    expect(doc.title).toBe("My Workbook")
  })

  test("CellResult structure with all fields", () => {
    const result: CellResult = {
      result: [{ NAME: "Alice" }],
      rowCount: 1,
      columns: [{ name: "NAME", type: "C" }],
      error: undefined,
      logs: ["log line"],
    }
    expect(result.result).toHaveLength(1)
    expect(result.rowCount).toBe(1)
    expect(result.columns).toHaveLength(1)
    expect(result.logs).toEqual(["log line"])
  })

  test("CellResult minimum required field", () => {
    const result: CellResult = { result: null }
    expect(result.result).toBeNull()
    expect(result.rowCount).toBeUndefined()
  })

  test("CellExecutionContext shape", () => {
    const ctx: CellExecutionContext = {
      cellIndex: 2,
      cellResults: new Map(),
      connectionId: "dev100",
    }
    expect(ctx.cellIndex).toBe(2)
    expect(ctx.connectionId).toBe("dev100")
    expect(ctx.cellResults).toBeInstanceOf(Map)
  })

  test("CellType values are valid", () => {
    const validTypes: CellType[] = ["sql", "javascript", "markdown"]
    for (const t of validTypes) {
      expect(["sql", "javascript", "markdown"]).toContain(t)
    }
  })
})
