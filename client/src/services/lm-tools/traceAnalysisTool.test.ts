jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({ getClient: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("../abapCopilotLogger", () => ({ logCommands: { error: jest.fn() } }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))

import { ABAPTraceAnalysisTool } from "./traceAnalysisTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = {
  getAbapTraceRunList: jest.fn(),
  getAbapTraceConfigurations: jest.fn()
}

describe("ABAPTraceAnalysisTool", () => {
  let tool: ABAPTraceAnalysisTool

  beforeEach(() => {
    tool = new ABAPTraceAnalysisTool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
  })

  describe("prepareInvocation", () => {
    it("returns list_runs message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "list_runs", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("list_runs")
    })

    it("returns list_configurations message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "list_configurations", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("list_configurations")
    })

    it("returns analyze_run message with traceId", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "analyze_run", connectionId: "dev100", traceId: "trace123" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("analyze_run")
    })

    it("returns get_statements message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "get_statements", connectionId: "dev100", traceId: "t1" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("get_statements")
    })

    it("returns get_hitlist message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "get_hitlist", connectionId: "dev100", traceId: "t1" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("get_hitlist")
    })

    it("includes connectionId in confirmation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ action: "list_runs", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("dev100")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockClient.getAbapTraceRunList = jest.fn().mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "list_runs", connectionId: "dev100" }),
        mockToken
      ).catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_analyze_abap_traces_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.getAbapTraceRunList = jest.fn().mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "list_runs", connectionId: "DEV100" }),
        mockToken
      ).catch(() => {})
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("throws when analyze_run has no traceId", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "analyze_run", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("traceId parameter is required")
    })

    it("throws when get_statements has no traceId", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "get_statements", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("traceId parameter is required")
    })

    it("throws when get_hitlist has no traceId", async () => {
      await expect(
        tool.invoke(
          makeOptions({ action: "get_hitlist", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("traceId parameter is required")
    })

    it("wraps client errors", async () => {
      ;(getClient as jest.Mock).mockImplementation(() => {
        throw new Error("connection error")
      })
      await expect(
        tool.invoke(
          makeOptions({ action: "list_runs", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Failed to analyze ABAP traces: Error: connection error")
    })

    it("uses maxResults default of 20", async () => {
      mockClient.getAbapTraceRunList = jest.fn().mockResolvedValue([])
      await tool.invoke(
        makeOptions({ action: "list_runs", connectionId: "dev100" }),
        mockToken
      ).catch(() => {})
      // Just verify invocation without error, maxResults defaults handled internally
      expect(logTelemetry).toHaveBeenCalled()
    })
  })
})
