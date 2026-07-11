// dataQueryTool tests focus purely on prepareInvocation validation logic
// (the SQL guards and input validations) since invoke requires heavy infrastructure.
jest.mock(
  "vscode",
  () => ({
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
    lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
    Uri: {
      parse: (s: string) => ({ scheme: s.split("://")[0], fsPath: s.replace(/^[a-z]+:\/\//, "") }),
      file: (p: string) => ({ scheme: "file", fsPath: p })
    },
    workspace: {
      fs: {
        writeFile: jest.fn().mockResolvedValue(undefined)
      }
    }
  }),
  { virtual: true }
)

jest.mock("../../adt/conections", () => ({ getClient: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../webviewManager", () => ({
  WebviewManager: {
    getInstance: jest.fn(() => ({ executeQuery: jest.fn(), getWebview: jest.fn() }))
  }
}))
jest.mock("../sapSystemInfo", () => ({ getSAPSystemInfo: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: jest.fn() }))

import * as vscode from "vscode"
import { ExecuteDataQueryTool } from "./dataQueryTool"
import { getClient } from "../../adt/conections"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("ExecuteDataQueryTool - prepareInvocation validation", () => {
  let tool: ExecuteDataQueryTool

  beforeEach(() => {
    tool = new ExecuteDataQueryTool()
  })

  describe("displayMode validation", () => {
    it("throws for missing displayMode", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ sql: "SELECT * FROM mara" }), mockToken)
      ).rejects.toThrow("displayMode")
    })

    it("throws for invalid displayMode value", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ sql: "SELECT * FROM mara", displayMode: "invalid" }),
          mockToken
        )
      ).rejects.toThrow("displayMode")
    })

    it("accepts 'internal' displayMode", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            sql: "SELECT * FROM mara",
            displayMode: "internal",
            rowRange: { start: 0, end: 10 }
          }),
          mockToken
        )
      ).resolves.toBeDefined()
    })

    it("accepts 'ui' displayMode", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ sql: "SELECT * FROM mara", displayMode: "ui" }),
          mockToken
        )
      ).resolves.toBeDefined()
    })
  })

  describe("internal mode validations", () => {
    it("throws when internal mode has no SQL", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "internal", rowRange: { start: 0, end: 10 } }),
          mockToken
        )
      ).rejects.toThrow("Internal mode requires SQL query")
    })

    it("throws when internal mode has webviewId", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "internal",
            sql: "SELECT * FROM mara",
            webviewId: "wv1",
            rowRange: { start: 0, end: 10 }
          }),
          mockToken
        )
      ).rejects.toThrow("LOGICAL CONFLICT")
    })

    it("throws when internal mode has data instead of sql", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "internal",
            data: { columns: [{ name: "A", type: "C" }], values: [] },
            rowRange: { start: 0, end: 10 }
          }),
          mockToken
        )
      ).rejects.toThrow("Internal mode requires SQL query")
    })
  })

  describe("ui mode validations", () => {
    it("throws when ui mode has no sql, data, or webviewId", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ displayMode: "ui" }), mockToken)
      ).rejects.toThrow("UI mode requires SQL query, direct data, or existing webviewId")
    })

    it("accepts ui mode with webviewId only", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ displayMode: "ui", webviewId: "wv1" }), mockToken)
      ).resolves.toBeDefined()
    })

    it("accepts ui mode with data", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "ui",
            data: {
              columns: [{ name: "ID", type: "C" }],
              values: [{ ID: "1" }]
            }
          }),
          mockToken
        )
      ).resolves.toBeDefined()
    })
  })

  describe("SQL validation", () => {
    it("accepts valid SELECT statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "SELECT matnr FROM mara WHERE matnr = 'TEST'" }),
          mockToken
        )
      ).resolves.toBeDefined()
    })

    it("accepts WITH statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "ui",
            sql: "WITH cte AS (SELECT matnr FROM mara) SELECT * FROM cte"
          }),
          mockToken
        )
      ).resolves.toBeDefined()
    })

    it("throws for DROP statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "DROP TABLE mara" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for DELETE statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "DELETE FROM mara WHERE matnr = 'X'" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for INSERT statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "INSERT INTO mara VALUES ('X')" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for UPDATE statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "UPDATE mara SET matnr = 'X'" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for TRUNCATE statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "TRUNCATE TABLE mara" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for SQL with line comment --", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "SELECT * FROM mara -- comment" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for SQL with block comment /*", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "SELECT /* comment */ * FROM mara" }),
          mockToken
        )
      ).rejects.toThrow("dangerous operation")
    })

    it("throws for non-SELECT/WITH statement", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ displayMode: "ui", sql: "EXEC sp_something" }),
          mockToken
        )
      ).rejects.toThrow("Only SELECT and WITH statements are allowed")
    })

    it("throws when both sql and data provided", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "ui",
            sql: "SELECT * FROM mara",
            data: { columns: [{ name: "A", type: "C" }], values: [] }
          }),
          mockToken
        )
      ).rejects.toThrow("Cannot provide both SQL query and direct data")
    })
  })

  describe("data validation", () => {
    it("throws when data.columns is empty", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "ui",
            data: { columns: [], values: [] }
          }),
          mockToken
        )
      ).rejects.toThrow("columns must be a non-empty array")
    })

    it("throws when data.values is not an array", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "ui",
            data: { columns: [{ name: "A", type: "C" }], values: null }
          }),
          mockToken
        )
      ).rejects.toThrow("values must be an array")
    })

    it("throws when column has no name", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "ui",
            data: { columns: [{ name: "", type: "C" }], values: [] }
          }),
          mockToken
        )
      ).rejects.toThrow("name")
    })
  })

  describe("download_to_file mode validations", () => {
    it("throws when filePath is missing", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            fileType: "xlsx",
            sql: "SELECT * FROM mara"
          }),
          mockToken
        )
      ).rejects.toThrow(/filePath/)
    })

    it("throws when fileType is missing", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara",
            sql: "SELECT * FROM mara"
          }),
          mockToken
        )
      ).rejects.toThrow(/fileType/)
    })

    it("throws when fileType is not xlsx/csv", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara",
            fileType: "json",
            sql: "SELECT * FROM mara"
          }),
          mockToken
        )
      ).rejects.toThrow(/fileType/)
    })

    it("throws when filePath contains an extension", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara.csv",
            fileType: "xlsx",
            sql: "SELECT * FROM mara"
          }),
          mockToken
        )
      ).rejects.toThrow(/must NOT include an extension/)
    })

    it("throws when webviewId is passed", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara",
            fileType: "xlsx",
            sql: "SELECT * FROM mara",
            webviewId: "wv1"
          }),
          mockToken
        )
      ).rejects.toThrow(/webviewId/)
    })

    it("throws when neither sql nor data is provided", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara",
            fileType: "xlsx"
          }),
          mockToken
        )
      ).rejects.toThrow(/sql or data/)
    })

    it("accepts a valid xlsx download config", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara",
            fileType: "xlsx",
            sql: "SELECT * FROM mara"
          }),
          mockToken
        )
      ).resolves.toBeDefined()
    })

    it("accepts a valid csv download config with data", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({
            displayMode: "download_to_file",
            filePath: "C:/tmp/mara",
            fileType: "csv",
            data: {
              columns: [{ name: "MATNR", type: "C" }],
              values: [{ MATNR: "000123" }]
            }
          }),
          mockToken
        )
      ).resolves.toBeDefined()
    })
  })
})

describe("ExecuteDataQueryTool - download_to_file invoke", () => {
  const fs = (vscode as any).workspace.fs
  let tool: ExecuteDataQueryTool

  beforeEach(() => {
    tool = new ExecuteDataQueryTool()
    jest.clearAllMocks()
  })

  it("does not write file when query returns 0 rows", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({ columns: [{ name: "MATNR" }], values: [] })
    })
    const result: any = await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/mara",
        fileType: "csv",
        sql: "SELECT matnr FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(result.parts[0].text).toMatch(/0 rows/)
  })

  it("does not write file when rowRange slices to empty", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [{ name: "MATNR" }],
        values: [{ MATNR: "000001" }, { MATNR: "000002" }]
      })
    })
    const result: any = await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/mara",
        fileType: "csv",
        sql: "SELECT matnr FROM mara",
        connectionId: "ged100",
        rowRange: { start: 5, end: 10 }
      }),
      mockToken
    )
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(result.parts[0].text).toMatch(/0 rows/)
  })

  it("appends fileType extension to the written path", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [{ name: "MATNR" }],
        values: [{ MATNR: "000001" }]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/mara",
        fileType: "xlsx",
        sql: "SELECT matnr FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const targetUri = fs.writeFile.mock.calls[0][0]
    expect(targetUri.fsPath).toBe("C:/tmp/mara.xlsx")
  })

  it("applies rowRange slice before writing", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [{ name: "MATNR" }],
        values: [{ MATNR: "A" }, { MATNR: "B" }, { MATNR: "C" }, { MATNR: "D" }]
      })
    })
    const result: any = await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/mara",
        fileType: "csv",
        sql: "SELECT matnr FROM mara",
        connectionId: "ged100",
        rowRange: { start: 1, end: 3 }
      }),
      mockToken
    )
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("MATNR")
    expect(text).toContain("B")
    expect(text).toContain("C")
    expect(text).not.toContain("\nA")
    expect(text).not.toContain("\nD")
    expect(result.parts[0].text).toMatch(/2 rows/)
  })

  it("writes CSV with BOM and preserves leading zeros as-is", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [{ name: "MATNR" }, { name: "ERSDA" }],
        values: [{ MATNR: "000123", ERSDA: "20241231" }]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/x",
        fileType: "csv",
        sql: "SELECT matnr, ersda FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    expect(text.charCodeAt(0)).toBe(0xfeff) // BOM
    expect(text).toContain("000123")
    expect(text).toContain("20241231")
  })

  it("writes xlsx with all cells as text (numFmt @)", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [{ name: "MATNR" }, { name: "ERSDA" }],
        values: [{ MATNR: "000123", ERSDA: "20241231" }]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/y",
        fileType: "xlsx",
        sql: "SELECT * FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    // Parse back with exceljs to verify cell types and formats
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes.buffer as ArrayBuffer)
    const ws = wb.getWorksheet(1)!
    // Row 1 = header, Row 2 = data
    const dataRow = ws.getRow(2)
    const matnr = dataRow.getCell(1)
    const ersda = dataRow.getCell(2)
    expect(matnr.value).toBe("000123")
    expect(ersda.value).toBe("20241231")
    expect(matnr.numFmt).toBe("@")
    expect(ersda.numFmt).toBe("@")
  })

  it("formats ADT ISO date/time strings the same way the UI does", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [
          { name: "ERSDA", type: "D" },
          { name: "ERZET", type: "T" },
          { name: "AEDAT", type: "P" } // TIMESTAMP: render as "YYYY-MM-DD HH:MM:SS"
        ],
        values: [
          {
            ERSDA: "2024-12-05T00:00:00.000Z",
            ERZET: "1970-01-01T14:35:12.000Z",
            AEDAT: "2024-12-05T09:30:45.000Z"
          }
        ]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/z",
        fileType: "csv",
        sql: "SELECT ersda, erzet, aedat FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    const dataLine = text.split("\n")[1]
    expect(dataLine).toBe("05-12-2024,14:35:12,2024-12-05 09:30:45")
  })

  it("formats Date objects (ADT client may return real Dates, not ISO strings)", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [
          { name: "ERSDA", type: "D" },
          { name: "ERZET", type: "T" }
        ],
        values: [
          {
            ERSDA: new Date("2024-12-05T00:00:00.000Z"),
            ERZET: new Date("1970-01-01T14:35:12.000Z")
          }
        ]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/dates",
        fileType: "csv",
        sql: "SELECT ersda, erzet FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    expect(text.split("\n")[1]).toBe("05-12-2024,14:35:12")
  })

  it("formats stringified Date output (Date.toString()) when column type says D/T", async () => {
    // Reproduces the real-world case where the value arrived as
    // "Thu Dec 05 2024 05:30:00 GMT+0530 (India Standard Time)".
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [{ name: "ERSDA", type: "D" }],
        values: [{ ERSDA: new Date("2024-12-05T00:00:00.000Z").toString() }]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/strdate",
        fileType: "csv",
        sql: "SELECT ersda FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    expect(text.split("\n")[1]).toBe("05-12-2024")
  })

  it("formats SAP raw YYYYMMDD / HHMMSS values from CDHDR-style tables", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [
          { name: "UDATE", type: "D" },
          { name: "UTIME", type: "T" }
        ],
        values: [{ UDATE: "20180227", UTIME: "141859" }]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/cdhdr",
        fileType: "csv",
        sql: "SELECT udate, utime FROM cdhdr",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    expect(text.split("\n")[1]).toBe("27-02-2018,14:18:59")
  })

  it("renders blanks / invalid date / SAP null-dates as empty cells", async () => {
    ;(getClient as jest.Mock).mockReturnValue({
      runQuery: jest.fn().mockResolvedValue({
        columns: [
          { name: "LAEDA", type: "D" },
          { name: "AEZET", type: "T" }
        ],
        values: [
          { LAEDA: "", AEZET: "" },
          { LAEDA: null, AEZET: null },
          { LAEDA: "00000000", AEZET: "000000" },
          { LAEDA: "Invalid Date", AEZET: "Invalid Date" }
        ]
      })
    })
    await tool.invoke(
      makeOptions({
        displayMode: "download_to_file",
        filePath: "C:/tmp/blanks",
        fileType: "csv",
        sql: "SELECT laeda, aezet FROM mara",
        connectionId: "ged100"
      }),
      mockToken
    )
    const bytes: Uint8Array = fs.writeFile.mock.calls[0][1]
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    const lines = text.split("\n")
    // header + 4 data lines
    expect(lines[1]).toBe(",")
    expect(lines[2]).toBe(",")
    // SAP zero-date "00000000" / zero-time "000000" are "no value" markers.
    expect(lines[3]).toBe(",")
    expect(lines[4]).toBe(",")
  })
})
