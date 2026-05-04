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

import { ABAPDumpAnalysisTool } from "./dumpAnalysisTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = {
  getSt22Dumps: jest.fn(),
  getSt22DumpDetail: jest.fn()
}

describe("ABAPDumpAnalysisTool", () => {
  let tool: ABAPDumpAnalysisTool

  beforeEach(() => {
    tool = new ABAPDumpAnalysisTool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
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
      mockClient.getSt22Dumps = jest.fn().mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "list_dumps", connectionId: "dev100" }),
        mockToken
      ).catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_analyze_abap_dumps_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.getSt22Dumps = jest.fn().mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "list_dumps", connectionId: "DEV100" }),
        mockToken
      ).catch(() => {})
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("throws when analyze_dump called without dumpId", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "analyze_dump", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("dumpId parameter is required")
    })

    it("throws for unknown action", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "unknown_action", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow()
    })

    it("wraps errors from client calls", async () => {
      ;(getClient as jest.Mock).mockImplementation(() => {
        throw new Error("client error")
      })
      await expect(
        tool.invoke(
          makeOptions({ action: "list_dumps", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Failed to analyze ABAP dumps: Error: client error")
    })
  })
})
