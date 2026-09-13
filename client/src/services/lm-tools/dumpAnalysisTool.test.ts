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

vi.mock("../../adt/conections", () => ({ getClient: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { ABAPDumpAnalysisTool } from "./dumpAnalysisTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = {
  getSt22Dumps: vi.fn(),
  getSt22DumpDetail: vi.fn()
}

describe("ABAPDumpAnalysisTool", () => {
  let tool: ABAPDumpAnalysisTool

  beforeEach(() => {
    tool = new ABAPDumpAnalysisTool()
    vi.clearAllMocks()
    ;(getClient as Mock).mockReturnValue(mockClient)
  })

  describe("prepareInvocation", () => {
    it("returns list_dumps message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "list_dumps", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("list_dumps")
    })

    it("returns analyze_dump message with dumpId", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "analyze_dump", connectionId: "dev100", dumpId: "DUMP123" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("analyze_dump")
    })

    it("includes connectionId in confirmation", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "list_dumps", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("dev100")
    })
  })

  describe("invoke", () => {
    it("logs telemetry with connectionId", async () => {
      mockClient.getSt22Dumps = vi.fn().mockResolvedValue([])
      await tool
        .invoke(makeOptions({ action: "list_dumps", connectionId: "dev100" }), mockToken)
        .catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_analyze_abap_dumps_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.getSt22Dumps = vi.fn().mockResolvedValue([])
      await tool
        .invoke(makeOptions({ action: "list_dumps", connectionId: "DEV100" }), mockToken)
        .catch(() => {})
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("throws when analyze_dump called without dumpId", async () => {
      await expect(
        tool.invoke(makeOptions({ action: "analyze_dump", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("dumpId parameter is required")
    })

    it("throws for unknown action", async () => {
      await expect(
        tool.invoke(makeOptions({ action: "unknown_action", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow()
    })

    it("wraps errors from client calls", async () => {
      ;(getClient as Mock).mockImplementation(function () {
        throw new Error("client error")
      })
      await expect(
        tool.invoke(makeOptions({ action: "list_dumps", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("Failed to analyze ABAP dumps: Error: client error")
    })
  })
})
