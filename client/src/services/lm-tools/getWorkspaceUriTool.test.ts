jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  getOrCreateRoot: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))

import { GetAbapObjectWorkspaceUriTool } from "./getWorkspaceUriTool"
import { getClient, getOrCreateRoot } from "../../adt/conections"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = { searchObject: jest.fn() }
const mockRoot = { findByAdtUri: jest.fn() }

describe("GetAbapObjectWorkspaceUriTool", () => {
  let tool: GetAbapObjectWorkspaceUriTool

  beforeEach(() => {
    tool = new GetAbapObjectWorkspaceUriTool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(mockRoot)
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with object name and type", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZCLASS")
      expect(result.invocationMessage).toContain("CLAS/OC")
    })

    it("includes all fields in confirmation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
        mockToken
      )
      const msgText = (result.confirmationMessages as any).message.text
      expect(msgText).toContain("ZPROG")
      expect(msgText).toContain("PROG/P")
      expect(msgText).toContain("dev100")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockClient.searchObject.mockResolvedValue([
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/sap/bc/adt/programs/programs/zprog" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue({ path: "/System%20Library/Source%20Code%20Library/Programs/ZPROG" })
      await tool.invoke(
        makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
        mockToken
      )
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_abap_object_workspace_uri_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.searchObject.mockResolvedValue([
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/sap/bc/adt/programs/programs/zprog" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue({ path: "/path/ZPROG" })
      await tool.invoke(
        makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "DEV100" }),
        mockToken
      )
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("returns workspace URI on success", async () => {
      mockClient.searchObject.mockResolvedValue([
        {
          "adtcore:name": "ZPROG",
          "adtcore:type": "PROG/P",
          "adtcore:uri": "/sap/bc/adt/programs/programs/zprog",
          "adtcore:packageName": "$TMP",
          "adtcore:description": "Test program"
        }
      ])
      mockRoot.findByAdtUri.mockResolvedValue({ path: "/System Library/ZPROG" })
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("adt://dev100")
      expect(result.parts[0].text).toContain("ZPROG")
    })

    it("throws when exact match not found", async () => {
      mockClient.searchObject.mockResolvedValue([
        { "adtcore:name": "ZPROG_OTHER", "adtcore:type": "PROG/P", "adtcore:uri": "/sap/bc/adt/..." }
      ])
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("not found")
    })

    it("throws when multiple objects found", async () => {
      mockClient.searchObject.mockResolvedValue([
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/uri1" },
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/uri2" }
      ])
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Multiple objects found")
    })

    it("throws when workspace path cannot be resolved", async () => {
      mockClient.searchObject.mockResolvedValue([
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/sap/bc/adt/programs/programs/zprog" }
      ])
      mockRoot.findByAdtUri.mockResolvedValue(null)
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Failed to get workspace URI")
    })

    it("throws when searchObject returns empty array", async () => {
      mockClient.searchObject.mockResolvedValue([])
      await expect(
        tool.invoke(
          makeOptions({ objectName: "MISSING", objectType: "PROG/P", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("not found")
    })
  })
})
