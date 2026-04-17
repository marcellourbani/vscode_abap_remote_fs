jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  extensions: {
    getExtension: jest.fn()
  },
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("path", () => ({
  join: (...args: string[]) => args.join("/")
}))
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}))

import { ABAPFSDocumentationTool } from "./documentationTool"
import { logTelemetry } from "../telemetry"
import * as fs from "fs"
import * as vscode from "vscode"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("ABAPFSDocumentationTool", () => {
  let tool: ABAPFSDocumentationTool

  const mockExtension = { extensionPath: "/ext/path" }

  beforeEach(() => {
    tool = new ABAPFSDocumentationTool()
    jest.clearAllMocks()
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension)
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as jest.Mock).mockReturnValue(
      Array.from({ length: 200 }, (_, i) => `Line ${i + 1} content`).join("\n")
    )
  })

  describe("prepareInvocation", () => {
    it("returns get_documentation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "get_documentation", startLine: 1, lineCount: 50 }),
        mockToken
      )
      expect(result.invocationMessage).toContain("DOCUMENTATION")
    })

    it("returns search message with query", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "search_documentation", searchQuery: "connection" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("connection")
    })

    it("returns get_settings message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "get_settings" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("settings")
    })

    it("returns search_settings message with query", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "search_settings", searchQuery: "timeout" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("timeout")
    })
  })

  describe("invoke - get_documentation", () => {
    it("logs telemetry", async () => {
      await tool.invoke(makeOptions({ action: "get_documentation" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_abapfs_documentation_called")
    })

    it("reads documentation file lines", async () => {
      const result: any = await tool.invoke(
        makeOptions({ action: "get_documentation", startLine: 1, lineCount: 10 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Line 1 content")
    })

    it("defaults to startLine=1, lineCount=50", async () => {
      const result: any = await tool.invoke(
        makeOptions({ action: "get_documentation" }),
        mockToken
      )
      expect(result.parts[0].text).toBeDefined()
      expect(fs.readFileSync).toHaveBeenCalled()
    })

    it("reads from correct file path (DOCUMENTATION.md)", async () => {
      await tool.invoke(makeOptions({ action: "get_documentation" }), mockToken)
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining("DOCUMENTATION.md"),
        "utf-8"
      )
    })

    it("throws when extension not found", async () => {
      ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined)
      await expect(
        tool.invoke(makeOptions({ action: "get_documentation" }), mockToken)
      ).rejects.toThrow("ABAP FS extension not found")
    })

    it("throws when documentation file not found", async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      await expect(
        tool.invoke(makeOptions({ action: "get_documentation" }), mockToken)
      ).rejects.toThrow("DOCUMENTATION.md not found")
    })
  })

  describe("invoke - search_documentation", () => {
    it("returns matches for search query", async () => {
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        "Line 1 connection info\nLine 2 other text\nLine 3 connection again"
      )
      const result: any = await tool.invoke(
        makeOptions({ action: "search_documentation", searchQuery: "connection" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("connection")
    })

    it("returns no-matches message when not found", async () => {
      ;(fs.readFileSync as jest.Mock).mockReturnValue("Line 1\nLine 2\nLine 3")
      const result: any = await tool.invoke(
        makeOptions({ action: "search_documentation", searchQuery: "xyznotfound" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No matches found")
    })

    it("throws when searchQuery not provided", async () => {
      await expect(
        tool.invoke(makeOptions({ action: "search_documentation" }), mockToken)
      ).rejects.toThrow("searchQuery is required")
    })
  })

  describe("invoke - get_settings", () => {
    it("reads settings file", async () => {
      await tool.invoke(makeOptions({ action: "get_settings" }), mockToken)
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining("ABAP-FS-SETTINGS.md"),
        "utf-8"
      )
    })

    it("throws when settings file not found", async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      await expect(
        tool.invoke(makeOptions({ action: "get_settings" }), mockToken)
      ).rejects.toThrow("ABAP-FS-SETTINGS.md not found")
    })
  })

  describe("invoke - search_settings", () => {
    it("searches settings file", async () => {
      ;(fs.readFileSync as jest.Mock).mockReturnValue("setting: timeout value\nother setting")
      const result: any = await tool.invoke(
        makeOptions({ action: "search_settings", searchQuery: "timeout" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("timeout")
    })

    it("throws when searchQuery not provided", async () => {
      await expect(
        tool.invoke(makeOptions({ action: "search_settings" }), mockToken)
      ).rejects.toThrow("searchQuery is required")
    })
  })
})

describe("readFileLines helper (via get_documentation)", () => {
  let tool: ABAPFSDocumentationTool
  const mockExtension = { extensionPath: "/ext/path" }

  beforeEach(() => {
    tool = new ABAPFSDocumentationTool()
    jest.clearAllMocks()
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension)
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
  })

  it("includes line range header in output", async () => {
    ;(fs.readFileSync as jest.Mock).mockReturnValue("Line1\nLine2\nLine3\nLine4\nLine5")
    const result: any = await tool.invoke(
      makeOptions({ action: "get_documentation", startLine: 2, lineCount: 2 }),
      mockToken
    )
    expect(result.parts[0].text).toContain("Lines 2-")
  })

  it("handles startLine beyond file end gracefully", async () => {
    ;(fs.readFileSync as jest.Mock).mockReturnValue("Line1\nLine2")
    const result: any = await tool.invoke(
      makeOptions({ action: "get_documentation", startLine: 100, lineCount: 50 }),
      mockToken
    )
    // Should not throw, just return empty or partial
    expect(result.parts[0].text).toBeDefined()
  })
})

describe("searchFileLines helper (via search_documentation)", () => {
  let tool: ABAPFSDocumentationTool
  const mockExtension = { extensionPath: "/ext/path" }

  beforeEach(() => {
    tool = new ABAPFSDocumentationTool()
    jest.clearAllMocks()
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue(mockExtension)
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
  })

  it("finds lines matching any word in multi-word query", async () => {
    ;(fs.readFileSync as jest.Mock).mockReturnValue("alpha line\nbeta line\ngamma line")
    const result: any = await tool.invoke(
      makeOptions({ action: "search_documentation", searchQuery: "alpha gamma" }),
      mockToken
    )
    expect(result.parts[0].text).toContain("alpha")
    expect(result.parts[0].text).toContain("gamma")
  })

  it("is case-insensitive in search", async () => {
    ;(fs.readFileSync as jest.Mock).mockReturnValue("This is CONNECTION info")
    const result: any = await tool.invoke(
      makeOptions({ action: "search_documentation", searchQuery: "connection" }),
      mockToken
    )
    expect(result.parts[0].text).toContain("CONNECTION")
  })

  it("shows line numbers in output", async () => {
    ;(fs.readFileSync as jest.Mock).mockReturnValue("line1\nfound here\nline3")
    const result: any = await tool.invoke(
      makeOptions({ action: "search_documentation", searchQuery: "found" }),
      mockToken
    )
    expect(result.parts[0].text).toContain("Line 2")
  })
})
