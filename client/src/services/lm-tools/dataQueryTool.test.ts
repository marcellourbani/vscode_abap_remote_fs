// dataQueryTool tests focus purely on prepareInvocation validation logic
// (the SQL guards and input validations) since invoke requires heavy infrastructure.
jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({ getClient: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../webviewManager", () => ({
  WebviewManager: { getInstance: jest.fn(() => ({ executeQuery: jest.fn(), getWebview: jest.fn() })) }
}))
jest.mock("../sapSystemInfo", () => ({ getSAPSystemInfo: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))

import { ExecuteDataQueryTool } from "./dataQueryTool"

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
        tool.prepareInvocation(makeOptions({ sql: "SELECT * FROM mara", displayMode: "invalid" }), mockToken)
      ).rejects.toThrow("displayMode")
    })

    it("accepts 'internal' displayMode", async () => {
      await expect(
        tool.prepareInvocation(
          makeOptions({ sql: "SELECT * FROM mara", displayMode: "internal", rowRange: { start: 0, end: 10 } }),
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
          makeOptions({ displayMode: "ui", sql: "WITH cte AS (SELECT matnr FROM mara) SELECT * FROM cte" }),
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
})
