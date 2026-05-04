jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../sapSystemInfo", () => ({
  getSAPSystemInfo: jest.fn(),
  formatSAPSystemInfoAsText: jest.fn()
}))

import { SAPSystemInfoTool } from "./sapSystemInfoTool"
import { getSAPSystemInfo } from "../sapSystemInfo"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSystemInfo = {
  systemType: "S/4HANA",
  sapRelease: "2023",
  currentClient: { clientNumber: "100", clientName: "Test Client" },
  timezone: {
    timezone: "UTC",
    description: "Universal Time",
    utcOffset: "+00:00",
    dstRule: "NONE"
  },
  softwareComponents: [{ name: "SAP_BASIS", version: "756" }]
}

describe("SAPSystemInfoTool", () => {
  let tool: SAPSystemInfoTool

  beforeEach(() => {
    tool = new SAPSystemInfoTool()
    jest.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with connectionId", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("dev100")
      expect(result.confirmationMessages).toBeDefined()
    })

    it("throws when connectionId is missing", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({ connectionId: "" }), mockToken)
      ).rejects.toThrow("connectionId is required")
    })

    it("throws when connectionId is undefined", async () => {
      await expect(
        tool.prepareInvocation(makeOptions({}), mockToken)
      ).rejects.toThrow("connectionId is required")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_sap_system_info_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      await tool.invoke(makeOptions({ connectionId: "DEV100" }), mockToken)
      expect(getSAPSystemInfo).toHaveBeenCalledWith("dev100", false)
    })

    it("returns summary with system type and release", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      const result: any = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const summaryText = result.parts[0].text
      expect(summaryText).toContain("S/4HANA")
      expect(summaryText).toContain("2023")
    })

    it("returns summary with client info", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      const result: any = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const summaryText = result.parts[0].text
      expect(summaryText).toContain("100")
      expect(summaryText).toContain("Test Client")
    })

    it("returns summary with timezone info", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      const result: any = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const summaryText = result.parts[0].text
      expect(summaryText).toContain("UTC")
    })

    it("shows DST rule when not NONE", async () => {
      const infoWithDST = { ...mockSystemInfo, timezone: { ...mockSystemInfo.timezone, dstRule: "EU" } }
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(infoWithDST)
      const result: any = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const summaryText = result.parts[0].text
      expect(summaryText).toContain("DST")
    })

    it("shows component count when includeComponents is true", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", includeComponents: true }),
        mockToken
      )
      expect(getSAPSystemInfo).toHaveBeenCalledWith("dev100", true)
      const summaryText = result.parts[0].text
      expect(summaryText).toContain("1 installed")
    })

    it("defaults includeComponents to false", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(getSAPSystemInfo).toHaveBeenCalledWith("dev100", false)
    })

    it("also returns full JSON in second part", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(mockSystemInfo)
      const result: any = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(result.parts).toHaveLength(2)
      const jsonText = result.parts[1].text
      const parsed = JSON.parse(jsonText)
      expect(parsed.systemType).toBe("S/4HANA")
    })

    it("throws when connectionId is missing", async () => {
      await expect(
        tool.invoke(makeOptions({ connectionId: "" }), mockToken)
      ).rejects.toThrow("connectionId is required")
    })

    it("throws with localizedMessage on error", async () => {
      const err = Object.assign(new Error("base"), { localizedMessage: "localized error" })
      ;(getSAPSystemInfo as jest.Mock).mockRejectedValue(err)
      await expect(
        tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("localized error")
    })

    it("throws with standard message on plain error", async () => {
      ;(getSAPSystemInfo as jest.Mock).mockRejectedValue(new Error("network failure"))
      await expect(
        tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("network failure")
    })

    it("handles info with no client", async () => {
      const noClientInfo = { ...mockSystemInfo, currentClient: undefined }
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue(noClientInfo)
      const result: any = await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      const summaryText = result.parts[0].text
      expect(summaryText).not.toContain("Client:")
    })
  })
})
