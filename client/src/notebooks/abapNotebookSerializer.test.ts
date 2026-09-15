vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(function () {
      return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn()
      }
    })
  }
}))
vi.mock("../lib", () => ({
  log: Object.assign(vi.fn(), {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  })
}))

vi.mock("vscode", () => {
  const NotebookCellKind = { Markup: 1, Code: 2 }

  const NotebookCellData = vi.fn().mockImplementation(function (
    kind: number,
    value: string,
    languageId: string
  ) {
    return {
      kind,
      value,
      languageId,
      metadata: {} as Record<string, any>
    }
  })

  const NotebookData = vi.fn().mockImplementation(function (cells: any[]) {
    return {
      cells,
      metadata: {} as Record<string, any>
    }
  })

  return {
    NotebookCellKind,
    NotebookCellData,
    NotebookData,
    workspace: {
      registerNotebookSerializer: vi.fn(function () {
        return { dispose: vi.fn() }
      })
    }
  }
})

import { AbapNotebookSerializer, registerNotebookSerializer } from "./abapNotebookSerializer"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID } from "./types"
import vscode from "vscode"
import * as __$mock_services_funMessenger from "../services/funMessenger"
import * as __$mock_vscode from "vscode"

// We use a real CancellationToken stub — serialize/deserialize ignore it
const stubToken: any = { isCancellationRequested: false, onCancellationRequested: vi.fn() }

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function deserialize(text: string) {
  const serializer = new AbapNotebookSerializer()
  return serializer.deserializeNotebook(encode(text), stubToken)
}

function serialize(data: any) {
  const serializer = new AbapNotebookSerializer()
  return serializer.serializeNotebook(data, stubToken)
}

function decodeResult(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

// ── Deserialization ──────────────────────────────────────────────────────────

describe("AbapNotebookSerializer.deserializeNotebook", () => {
  beforeEach(() => vi.clearAllMocks())

  test("deserializes empty content to empty notebook with version 1", async () => {
    const data = await deserialize("")
    expect(data.cells).toHaveLength(0)
    expect(data.metadata!.version).toBe(1)
  })

  test("deserializes whitespace-only content to empty notebook", async () => {
    const data = await deserialize("   \n  ")
    expect(data.cells).toHaveLength(0)
  })

  test("deserializes valid JSON with one SQL cell", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "sql", content: "SELECT * FROM mara" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells).toHaveLength(1)
    const cell = data.cells[0]
    expect(cell.value).toBe("SELECT * FROM mara")
    expect(cell.languageId).toBe(SQL_LANGUAGE_ID)
    expect(cell.kind).toBe(2) // Code
  })

  test("deserializes valid JSON with markdown cell as Markup kind", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "markdown", content: "# Title" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].kind).toBe(1) // Markup
    expect(data.cells[0].languageId).toBe("markdown")
  })

  test("deserializes valid JSON with javascript cell", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "javascript", content: "const x = 1" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].languageId).toBe("javascript")
    expect(data.cells[0].kind).toBe(2) // Code
  })

  test("preserves version and title in notebook metadata", async () => {
    const nb = { version: 3, title: "My Workbook", cells: [] }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.metadata!.version).toBe(3)
    expect(data.metadata!.title).toBe("My Workbook")
  })

  test("preserves maxRows in cell metadata", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "sql", content: "SELECT 1", maxRows: 250 }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].metadata!.maxRows).toBe(250)
  })

  test("cell metadata has no maxRows key when not specified", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "sql", content: "SELECT 1" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].metadata!.maxRows).toBeUndefined()
  })

  test("normalizes 'abap-sql' cell type to sql (uses SQL_LANGUAGE_ID)", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "abap-sql", content: "SELECT 1" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].languageId).toBe(SQL_LANGUAGE_ID)
  })

  test("normalizes unknown type to markdown", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "cobol", content: "MOVE X TO Y" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].languageId).toBe("markdown")
    expect(data.cells[0].kind).toBe(1) // Markup
  })

  test("normalizes 'js' type to javascript", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "js", content: "1 + 1" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].languageId).toBe("javascript")
  })

  test("normalizes 'typescript' type to javascript", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "typescript", content: "const x: number = 1" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].languageId).toBe("javascript")
  })

  test("normalizes 'ts' type to javascript", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "ts", content: "let x = 1" }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].languageId).toBe("javascript")
  })

  test("handles missing version — defaults to 1", async () => {
    const nb = { cells: [] }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.metadata!.version).toBe(1)
  })

  test("handles missing cells array — returns empty cells", async () => {
    const nb = { version: 1 }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells).toHaveLength(0)
  })

  test("handles cell with non-string content — normalizes to empty string", async () => {
    const nb = {
      version: 1,
      cells: [{ type: "sql", content: null }]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells[0].value).toBe("")
  })

  test("corrupt JSON returns empty notebook with corrupt metadata", async () => {
    const data = await deserialize("{invalid json{{")
    expect(data.cells.length).toBeGreaterThanOrEqual(1) // warning cell inserted
    expect(data.metadata).toBeDefined()
  })

  test("corrupt JSON adds a warning cell with CORRUPT_WARNING_TAG metadata", async () => {
    const data = await deserialize("{definitely not json}")
    const warningCell = data.cells.find((c: any) => c.metadata?.["[ABAPNB_CORRUPT_FILE_WARNING]"])
    expect(warningCell).toBeDefined()
  })

  test("corrupt JSON stores original text in notebook metadata", async () => {
    const badJson = "{definitely not json}"
    const data = await deserialize(badJson)
    expect(data.metadata!["__abapnb_corrupt_original__"]).toBe(badJson)
  })

  test("fixable JSON with literal newlines in strings is handled", async () => {
    // JSON where string values contain literal newlines (not \\n) — fixJsonNewlines should repair it
    const raw = `{"version":1,"cells":[{"type":"sql","content":"SELECT *\nFROM mara"}]}`
    const data = await deserialize(raw)
    // After fix it should parse, content should contain the newline
    expect(data.cells).toHaveLength(1)
    expect(data.cells[0].value).toContain("\n")
  })

  test("shows warning message when JSON is corrupt and unfixable", async () => {
    const { funWindow: win } = __$mock_services_funMessenger
    await deserialize("{not json at all!!")
    expect(win.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("invalid JSON"))
  })

  test("deserializes multiple cells in order", async () => {
    const nb = {
      version: 1,
      cells: [
        { type: "markdown", content: "# H1" },
        { type: "sql", content: "SELECT 1" },
        { type: "javascript", content: "cells[0]" }
      ]
    }
    const data = await deserialize(JSON.stringify(nb))
    expect(data.cells).toHaveLength(3)
    expect(data.cells[0].languageId).toBe("markdown")
    expect(data.cells[1].languageId).toBe(SQL_LANGUAGE_ID)
    expect(data.cells[2].languageId).toBe("javascript")
  })
})

// ── Serialization ────────────────────────────────────────────────────────────

describe("AbapNotebookSerializer.serializeNotebook", () => {
  beforeEach(() => vi.clearAllMocks())

  function makeData(cells: any[], meta: Record<string, any> = { version: 1 }) {
    return { cells, metadata: meta }
  }

  function makeCell(languageId: string, value: string, metadata?: Record<string, any>): any {
    return { languageId, value, metadata: metadata ?? {}, kind: languageId === "markdown" ? 1 : 2 }
  }

  test("serializes empty notebook to valid JSON with empty cells array", async () => {
    const bytes = await serialize(makeData([]))
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells).toEqual([])
    expect(json.version).toBe(1)
  })

  test("serializes SQL cell correctly", async () => {
    const data = makeData([makeCell(SQL_LANGUAGE_ID, "SELECT * FROM mara")])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells).toHaveLength(1)
    expect(json.cells[0].type).toBe("sql")
    expect(json.cells[0].content).toBe("SELECT * FROM mara")
  })

  test("serializes javascript cell correctly", async () => {
    const data = makeData([makeCell("javascript", "const x = 1")])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells[0].type).toBe("javascript")
  })

  test("serializes markdown cell correctly", async () => {
    const data = makeData([makeCell("markdown", "# Title")])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells[0].type).toBe("markdown")
  })

  test("includes maxRows in serialized cell when present", async () => {
    const data = makeData([makeCell(SQL_LANGUAGE_ID, "SELECT 1", { maxRows: 500 })])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells[0].maxRows).toBe(500)
  })

  test("omits maxRows from cell when not in metadata", async () => {
    const data = makeData([makeCell(SQL_LANGUAGE_ID, "SELECT 1", {})])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells[0].maxRows).toBeUndefined()
  })

  test("preserves version in serialized output", async () => {
    const data = makeData([], { version: 7, title: "Test" })
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.version).toBe(7)
  })

  test("preserves title in serialized output", async () => {
    const data = makeData([], { version: 1, title: "My WB" })
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.title).toBe("My WB")
  })

  test("omits title when empty string", async () => {
    const data = makeData([], { version: 1, title: "" })
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    // Empty title should be omitted (falsy check in notebookDataToDocument)
    expect(json.title).toBeUndefined()
  })

  test("filters out CORRUPT_WARNING_TAG cells before serializing", async () => {
    const warningCell = makeCell("markdown", "Warning: corrupt file")
    warningCell.metadata = { "[ABAPNB_CORRUPT_FILE_WARNING]": true }
    const realCell = makeCell(SQL_LANGUAGE_ID, "SELECT 1")
    const data = makeData([warningCell, realCell], { version: 1 })
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells).toHaveLength(1)
    expect(json.cells[0].type).toBe("sql")
  })

  test("preserves corrupt original content when no real cells remain", async () => {
    const originalText = "{broken json"
    const warningCell = makeCell("markdown", "Warning")
    warningCell.metadata = { "[ABAPNB_CORRUPT_FILE_WARNING]": true }
    const data = makeData([warningCell], {
      version: 1,
      __abapnb_corrupt_original__: originalText
    })
    const bytes = await serialize(data)
    expect(decodeResult(bytes)).toBe(originalText)
  })

  test("serializes 'sql' languageId cell to type 'sql'", async () => {
    const data = makeData([makeCell("sql", "SELECT 1")])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells[0].type).toBe("sql")
  })

  test("unknown language gets normalized to markdown type", async () => {
    const data = makeData([makeCell("cobol", "MOVE X TO Y")])
    const bytes = await serialize(data)
    const json = JSON.parse(decodeResult(bytes))
    expect(json.cells[0].type).toBe("markdown")
  })

  test("serialized output is valid JSON", async () => {
    const data = makeData([
      makeCell("markdown", "# Title"),
      makeCell(SQL_LANGUAGE_ID, "SELECT * FROM mara")
    ])
    const bytes = await serialize(data)
    expect(() => JSON.parse(decodeResult(bytes))).not.toThrow()
  })

  test("produces pretty-printed JSON (indented)", async () => {
    const data = makeData([])
    const bytes = await serialize(data)
    const text = decodeResult(bytes)
    expect(text).toContain("\n")
  })
})

// ── registerNotebookSerializer ───────────────────────────────────────────────

describe("registerNotebookSerializer", () => {
  beforeEach(() => vi.clearAllMocks())

  test("calls vscode.workspace.registerNotebookSerializer", () => {
    const context = { subscriptions: { push: vi.fn() } } as any
    registerNotebookSerializer(context)
    const vscode = __$mock_vscode
    expect(vscode.workspace.registerNotebookSerializer).toHaveBeenCalledWith(
      NOTEBOOK_TYPE,
      expect.any(AbapNotebookSerializer),
      expect.objectContaining({ transientOutputs: true })
    )
  })

  test("returns a disposable", () => {
    const context = { subscriptions: { push: vi.fn() } } as any
    const disposable = registerNotebookSerializer(context)
    expect(disposable).toBeDefined()
    expect(typeof disposable.dispose).toBe("function")
  })
})
