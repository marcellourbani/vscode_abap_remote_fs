jest.mock("vscode", () => {
  const mockCellOutputItem = {
    text: jest.fn((value: string, mime: string) => ({ data: Buffer.from(value), mime })),
    json: jest.fn((value: unknown) => ({ data: Buffer.from(JSON.stringify(value)), mime: "application/json" })),
    error: jest.fn((err: any) => ({ data: Buffer.from(JSON.stringify(err)), mime: "application/vnd.code.notebook.error" })),
  }
  const mockNotebookCellOutput = jest.fn().mockImplementation((items: any[]) => ({ items }))
  return {
    NotebookCellOutput: mockNotebookCellOutput,
    NotebookCellOutputItem: mockCellOutputItem,
  }
}, { virtual: true })

import { renderSqlOutput, renderJsOutput, renderErrorOutput } from "./outputRenderer"
import type { CellResult } from "./types"
import { DISPLAY_ROW_LIMIT } from "./types"

describe("renderSqlOutput", () => {
  beforeEach(() => jest.clearAllMocks())

  test("returns text output for empty result array", () => {
    const result: CellResult = { result: [], rowCount: 0, columns: [] }
    const output = renderSqlOutput(result)
    expect(output).toBeDefined()
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith(
      "Query returned 0 rows.",
      "text/plain"
    )
  })

  test("returns text output when result is not an array", () => {
    const result: CellResult = { result: null, rowCount: 0 }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith(
      "Query returned 0 rows.",
      "text/plain"
    )
  })

  test("builds HTML table for rows", () => {
    const result: CellResult = {
      result: [{ NAME: "Alice", AGE: 30 }],
      rowCount: 1,
      columns: [{ name: "NAME", type: "C" }, { name: "AGE", type: "I" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const call = NotebookCellOutputItem.text.mock.calls[0]
    expect(call[1]).toBe("text/html")
    expect(call[0]).toContain("sapwb-table")
    expect(call[0]).toContain("Alice")
    expect(call[0]).toContain("30")
    expect(call[0]).toContain("NAME")
    expect(call[0]).toContain("AGE")
  })

  test("uses row keys as column names when columns array is empty", () => {
    const result: CellResult = {
      result: [{ FOO: "bar" }],
      rowCount: 1,
      columns: [],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).toContain("FOO")
    expect(html).toContain("bar")
  })

  test("shows truncation note when rows exceed DISPLAY_ROW_LIMIT", () => {
    const rows = Array.from({ length: DISPLAY_ROW_LIMIT + 5 }, (_, i) => ({ ID: i }))
    const result: CellResult = {
      result: rows,
      rowCount: rows.length,
      columns: [{ name: "ID", type: "I" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).toContain("Showing")
    expect(html).toContain("of")
  })

  test("shows singular 'row' for 1 row total", () => {
    const result: CellResult = {
      result: [{ X: "y" }],
      rowCount: 1,
      columns: [{ name: "X", type: "C" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).toMatch(/1 row[^s]/)
  })

  test("shows plural 'rows' for 2 rows", () => {
    const result: CellResult = {
      result: [{ X: "a" }, { X: "b" }],
      rowCount: 2,
      columns: [{ name: "X", type: "C" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).toContain("2 rows")
  })

  test("escapes HTML special characters in cell values", () => {
    const result: CellResult = {
      result: [{ CODE: "<script>alert(1)</script>" }],
      rowCount: 1,
      columns: [{ name: "CODE", type: "C" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  test("escapes ampersands in cell values", () => {
    const result: CellResult = {
      result: [{ TEXT: "A & B" }],
      rowCount: 1,
      columns: [{ name: "TEXT", type: "C" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).toContain("A &amp; B")
  })

  test("escapes quotes in cell values", () => {
    const result: CellResult = {
      result: [{ TEXT: 'say "hello"' }],
      rowCount: 1,
      columns: [{ name: "TEXT", type: "C" }],
    }
    renderSqlOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const html = NotebookCellOutputItem.text.mock.calls[0][0]
    expect(html).toContain("&quot;")
  })
})

describe("renderJsOutput", () => {
  beforeEach(() => jest.clearAllMocks())

  test("renders undefined result as 'undefined' text", () => {
    const result: CellResult = { result: undefined }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith("undefined", "text/plain")
  })

  test("renders string result as plain text", () => {
    const result: CellResult = { result: "hello world" }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith(
      expect.stringContaining("hello world"),
      "text/plain"
    )
  })

  test("renders number as JSON text", () => {
    const result: CellResult = { result: 42 }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith("42", "text/plain")
  })

  test("renders object as JSON text", () => {
    const result: CellResult = { result: { key: "value" } }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const call = NotebookCellOutputItem.text.mock.calls[0]
    expect(call[1]).toBe("text/plain")
    expect(call[0]).toContain('"key"')
    expect(call[0]).toContain('"value"')
  })

  test("renders array of objects as HTML table", () => {
    const result: CellResult = { result: [{ NAME: "Bob" }, { NAME: "Carol" }] }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const htmlCall = NotebookCellOutputItem.text.mock.calls.find((c: any[]) => c[1] === "text/html")
    expect(htmlCall).toBeDefined()
    expect(htmlCall[0]).toContain("Bob")
    expect(htmlCall[0]).toContain("Carol")
  })

  test("includes log lines as plain text before the main output", () => {
    const result: CellResult = { result: "done", logs: ["log1", "log2"] }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const plainCalls = NotebookCellOutputItem.text.mock.calls.filter((c: any[]) => c[1] === "text/plain")
    const logCall = plainCalls.find((c: any[]) => c[0].includes("log1"))
    expect(logCall).toBeDefined()
    expect(logCall[0]).toBe("log1\nlog2")
  })

  test("renders only logs when result is undefined but logs exist", () => {
    const result: CellResult = { result: undefined, logs: ["info line"] }
    const output = renderJsOutput(result)
    expect(output).toBeDefined()
    const { NotebookCellOutputItem } = require("vscode")
    const calls = NotebookCellOutputItem.text.mock.calls
    const logCall = calls.find((c: any[]) => c[0] === "info line")
    expect(logCall).toBeDefined()
  })

  test("array of non-objects is rendered as JSON, not HTML table", () => {
    const result: CellResult = { result: [1, 2, 3] }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const htmlCall = NotebookCellOutputItem.text.mock.calls.find((c: any[]) => c[1] === "text/html")
    expect(htmlCall).toBeUndefined()
  })

  test("empty array is rendered as JSON, not HTML table", () => {
    const result: CellResult = { result: [] }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const htmlCall = NotebookCellOutputItem.text.mock.calls.find((c: any[]) => c[1] === "text/html")
    expect(htmlCall).toBeUndefined()
  })

  test("array with null item is not treated as tabular", () => {
    const result: CellResult = { result: [null] }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const htmlCall = NotebookCellOutputItem.text.mock.calls.find((c: any[]) => c[1] === "text/html")
    expect(htmlCall).toBeUndefined()
  })

  test("truncation note appears when JS array result exceeds DISPLAY_ROW_LIMIT", () => {
    const rows = Array.from({ length: DISPLAY_ROW_LIMIT + 1 }, (_, i) => ({ I: i }))
    const result: CellResult = { result: rows }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    const htmlCall = NotebookCellOutputItem.text.mock.calls.find((c: any[]) => c[1] === "text/html")
    expect(htmlCall[0]).toContain("Showing")
  })

  test("null result renders as JSON 'null'", () => {
    const result: CellResult = { result: null }
    renderJsOutput(result)
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith("null", "text/plain")
  })
})

describe("renderErrorOutput", () => {
  beforeEach(() => jest.clearAllMocks())

  test("renders Error object with its message prefixed by ❌", () => {
    const err = new Error("something went wrong")
    renderErrorOutput(err)
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith(
      "❌ something went wrong",
      "text/plain"
    )
  })

  test("renders string error prefixed by ❌", () => {
    renderErrorOutput("bad input")
    const { NotebookCellOutputItem } = require("vscode")
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith("❌ bad input", "text/plain")
  })

  test("renders Error with empty message — falls back to String(error)", () => {
    const err = new Error("")
    renderErrorOutput(err)
    const { NotebookCellOutputItem } = require("vscode")
    // When message is empty, the code uses `String(error)` which produces "Error"
    expect(NotebookCellOutputItem.text).toHaveBeenCalledWith(
      expect.stringMatching(/^❌ /),
      "text/plain"
    )
  })
})
