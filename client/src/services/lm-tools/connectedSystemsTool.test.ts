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
jest.mock("../../config", () => ({
  connectedRoots: jest.fn()
}))

import { ConnectedSystemsTool } from "./connectedSystemsTool"
import { connectedRoots } from "../../config"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("ConnectedSystemsTool", () => {
  let tool: ConnectedSystemsTool

  beforeEach(() => {
    tool = new ConnectedSystemsTool()
    jest.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(makeOptions(), mockToken)
      expect(result.invocationMessage).toContain("connected SAP systems")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      const mockMap = new Map([["dev100", {}]])
      ;(connectedRoots as jest.Mock).mockReturnValue(mockMap)

      await tool.invoke(makeOptions(), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_connected_systems_called")
    })

    it("returns comma-separated connection IDs when systems are connected", async () => {
      const mockMap = new Map([["dev100", {}], ["qas200", {}]])
      ;(connectedRoots as jest.Mock).mockReturnValue(mockMap)

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text = result.parts[0].text
      expect(text).toContain("dev100")
      expect(text).toContain("qas200")
    })

    it("returns no-connection message when no systems connected", async () => {
      ;(connectedRoots as jest.Mock).mockReturnValue(new Map())

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text = result.parts[0].text
      expect(text).toMatch(/No SAP systems/i)
    })

    it("returns single connection ID when one system connected", async () => {
      ;(connectedRoots as jest.Mock).mockReturnValue(new Map([["prd300", {}]]))

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text = result.parts[0].text
      expect(text).toContain("prd300")
    })

    it("throws wrapped error when connectedRoots throws", async () => {
      ;(connectedRoots as jest.Mock).mockImplementation(() => {
        throw new Error("config error")
      })

      await expect(tool.invoke(makeOptions(), mockToken)).rejects.toThrow(
        "Failed to get connected systems: config error"
      )
    })

    it("handles non-Error exceptions", async () => {
      ;(connectedRoots as jest.Mock).mockImplementation(() => {
        throw "string error"
      })

      await expect(tool.invoke(makeOptions(), mockToken)).rejects.toThrow(
        "Failed to get connected systems: string error"
      )
    })

    // ====================================================================
    // BEHAVIOR-FOCUSED TESTS: actual output format & content verification
    // ====================================================================

    it("produces exact comma-separated format with multiple connections", async () => {
      const mockMap = new Map([["dev100", {}], ["qas200", {}], ["prd300", {}]])
      ;(connectedRoots as jest.Mock).mockReturnValue(mockMap)

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text: string = result.parts[0].text

      // The output must be "Connected SAP systems: dev100, qas200, prd300"
      expect(text).toBe("Connected SAP systems: dev100, qas200, prd300")
    })

    it("does not include comma for a single connection", async () => {
      ;(connectedRoots as jest.Mock).mockReturnValue(new Map([["solo100", {}]]))

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text: string = result.parts[0].text

      expect(text).toBe("Connected SAP systems: solo100")
      expect(text).not.toContain(",")
    })

    it("preserves Map insertion order in output", async () => {
      const mockMap = new Map<string, any>()
      mockMap.set("zzz999", {})
      mockMap.set("aaa111", {})
      mockMap.set("mmm555", {})
      ;(connectedRoots as jest.Mock).mockReturnValue(mockMap)

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text: string = result.parts[0].text

      // Map preserves insertion order, so output should match
      expect(text).toBe("Connected SAP systems: zzz999, aaa111, mmm555")
    })

    it("extracts only the keys (connection IDs) from the Map, not values", async () => {
      const mockMap = new Map([
        ["conn_a", { uri: "adt://conn_a", some: "data" }],
        ["conn_b", { uri: "adt://conn_b", other: "stuff" }]
      ])
      ;(connectedRoots as jest.Mock).mockReturnValue(mockMap)

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text: string = result.parts[0].text

      // Must contain keys only, not values
      expect(text).toContain("conn_a")
      expect(text).toContain("conn_b")
      expect(text).not.toContain("adt://")
      expect(text).not.toContain("data")
      expect(text).not.toContain("stuff")
    })

    it("returns all connection IDs, not just the first or last", async () => {
      const ids = ["sys1", "sys2", "sys3", "sys4", "sys5"]
      const mockMap = new Map(ids.map(id => [id, {}]))
      ;(connectedRoots as jest.Mock).mockReturnValue(mockMap)

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text: string = result.parts[0].text

      // Verify every single ID is present
      for (const id of ids) {
        expect(text).toContain(id)
      }

      // Verify the count of IDs in the comma-separated list
      const listPart = text.replace("Connected SAP systems: ", "")
      const parsedIds = listPart.split(", ")
      expect(parsedIds).toEqual(ids)
    })

    it("returns exactly one text part in the result", async () => {
      ;(connectedRoots as jest.Mock).mockReturnValue(new Map([["x", {}]]))

      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts).toHaveLength(1)
      expect(result.parts[0]).toHaveProperty("text")
    })

    it("empty map returns message suggesting connect command, not an empty list", async () => {
      ;(connectedRoots as jest.Mock).mockReturnValue(new Map())

      const result: any = await tool.invoke(makeOptions(), mockToken)
      const text: string = result.parts[0].text

      // Should NOT contain "Connected SAP systems:" prefix
      expect(text).not.toContain("Connected SAP systems:")
      // Should mention connecting
      expect(text).toContain("connect")
    })

    it("wraps error with 'Failed to get connected systems' prefix", async () => {
      ;(connectedRoots as jest.Mock).mockImplementation(() => {
        throw new Error("something broke")
      })

      try {
        await tool.invoke(makeOptions(), mockToken)
        fail("should have thrown")
      } catch (e: any) {
        expect(e.message).toMatch(/^Failed to get connected systems: something broke$/)
      }
    })
  })
})
