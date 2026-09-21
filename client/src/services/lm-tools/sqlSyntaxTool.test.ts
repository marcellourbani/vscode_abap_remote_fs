vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../abapCopilotLogger", () => ({
  logCommands: { error: vi.fn() }
}))
vi.mock("../../extension", () => ({
  context: { extensionPath: "/ext" }
}))
vi.mock("path", () => ({
  join: (...args: string[]) => args.join("/")
}))
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { GetABAPSQLSyntaxTool } from "./sqlSyntaxTool"
import { logTelemetry } from "../telemetry"
import * as fs from "fs"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("GetABAPSQLSyntaxTool", () => {
  let tool: GetABAPSQLSyntaxTool

  beforeEach(() => {
    tool = new GetABAPSQLSyntaxTool()
    vi.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(makeOptions(), mockToken)
      expect(result.invocationMessage).toContain("SQL syntax")
    })

    it("returns confirmation messages", async () => {
      const result = await tool.prepareInvocation(makeOptions(), mockToken)
      expect(result.confirmationMessages).toBeDefined()
      expect((result.confirmationMessages as any).title).toBe("Get ABAP SQL Syntax")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue("# ABAP SQL Syntax\n## SELECT")
      await tool.invoke(makeOptions(), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_abap_sql_syntax_called")
    })

    it("returns SQL syntax content from file", async () => {
      const content = "# ABAP SQL Syntax Guide\n## SELECT statement\nABCD"
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue(content)
      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts[0].text).toContain("ABAP SQL Syntax")
      expect(result.parts[0].text).toContain(content)
    })

    it("includes important warning header", async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue("content")
      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts[0].text).toContain("IMPORTANT")
    })

    it("throws when syntax file not found", async () => {
      ;(fs.existsSync as Mock).mockReturnValue(false)
      await expect(tool.invoke(makeOptions(), mockToken)).rejects.toThrow(
        "Failed to load ABAP SQL syntax documentation"
      )
    })

    it("throws when file read fails", async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockImplementation(function () {
        throw new Error("read error")
      })
      await expect(tool.invoke(makeOptions(), mockToken)).rejects.toThrow(
        "Failed to load ABAP SQL syntax documentation"
      )
    })

    it("reads from correct path (extensionPath + client/dist/media/sql_syntax.md)", async () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      ;(fs.readFileSync as Mock).mockReturnValue("content")
      await tool.invoke(makeOptions(), mockToken)
      expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining("sql_syntax.md"))
    })
  })
})
