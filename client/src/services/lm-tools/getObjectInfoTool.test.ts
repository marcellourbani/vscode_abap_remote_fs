vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (value: string) {
    return { value }
  }),
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  abapUri: vi.fn()
}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../abapCopilotLogger", () => ({
  logCommands: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("./shared", () => ({
  getOptimalObjectURI: vi.fn(function (type: string, uri: string) {
    return uri + "/source/main"
  }),
  getObjectEnhancements: vi.fn(function () {
    return Promise.resolve({ hasEnhancements: false, enhancements: [] })
  }),
  getTableTypeFromDD: vi.fn(function () {
    return Promise.resolve("")
  }),
  getTableStructureFromDD: vi.fn(function () {
    return Promise.resolve("")
  }),
  getAppendStructuresFromDD: vi.fn(function () {
    return Promise.resolve([])
  }),
  getCompleteTableStructure: vi.fn(function () {
    return Promise.resolve("")
  })
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))

import { GetABAPObjectInfoTool } from "./getObjectInfoTool"
import { getSearchService } from "../abapSearchService"
import { getClient, abapUri } from "../../adt/conections"
import { funWindow as window } from "../funMessenger"
import { logTelemetry } from "../telemetry"
import { getOptimalObjectURI, getObjectEnhancements, getCompleteTableStructure } from "./shared"
import type { Mock } from "vitest"

const mockToken = {} as any
function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: vi.fn() }
const mockClient = { getObjectSource: vi.fn() }

describe("GetABAPObjectInfoTool", () => {
  let tool: GetABAPObjectInfoTool

  beforeEach(() => {
    tool = new GetABAPObjectInfoTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getClient as Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  // =========================================================================
  // prepareInvocation
  // =========================================================================
  describe("prepareInvocation", () => {
    it("includes objectName in confirmation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCL_MY_CLASS", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZCL_MY_CLASS")
      expect(result.confirmationMessages.title).toBe("Get ABAP Object Info")
      expect(result.confirmationMessages.message.value).toContain("ZCL_MY_CLASS")
    })

    it("includes objectType in message when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", objectType: "PROG/P", connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("PROG/P")
    })

    it("includes connectionId in message when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("dev100")
    })

    it("omits type and connection from message when not provided", async () => {
      const result = await tool.prepareInvocation(makeOptions({ objectName: "ZREPORT" }), mockToken)
      expect(result.confirmationMessages.message.value).not.toContain("type:")
      expect(result.confirmationMessages.message.value).not.toContain("connection:")
    })
  })

  // =========================================================================
  // invoke — connectionId resolution
  // =========================================================================
  describe("invoke connectionId resolution", () => {
    it("lowercases connectionId", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(makeOptions({ objectName: "ZTEST", connectionId: "DEV100" }), mockToken)

      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("throws when no connectionId and no active editor", async () => {
      await expect(tool.invoke(makeOptions({ objectName: "ZTEST" }), mockToken)).rejects.toThrow(
        "No active ABAP document"
      )
    })

    it("throws when active editor has non-ABAP uri", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "local", scheme: "file" } }
      }
      ;(abapUri as Mock).mockReturnValue(false)

      await expect(tool.invoke(makeOptions({ objectName: "ZTEST" }), mockToken)).rejects.toThrow(
        "No active ABAP document"
      )
    })

    it("resolves connectionId from active ABAP editor", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "dev100", scheme: "adt" } }
      }
      ;(abapUri as Mock).mockReturnValue(true)
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(makeOptions({ objectName: "ZTEST" }), mockToken)

      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(makeOptions({ objectName: "ZTEST", connectionId: "dev100" }), mockToken)

      expect(logTelemetry).toHaveBeenCalledWith("tool_get_abap_object_info_called", {
        connectionId: "dev100"
      })
    })
  })

  // =========================================================================
  // invoke — search and object info
  // =========================================================================
  describe("invoke search results", () => {
    it("returns not-found message when search returns empty", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZNONEXISTENT", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Could not find")
      expect(result.parts[0].text).toContain("ZNONEXISTENT")
    })

    it("returns not-found message when search returns null", async () => {
      mockSearcher.searchObjects.mockResolvedValue(null)

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZNOTHING", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Could not find")
    })

    it("passes objectType as search filter when provided", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )

      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZTEST", ["CLAS/OC"], 1)
    })

    it("passes undefined search types when objectType is not provided", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(makeOptions({ objectName: "ZTEST", connectionId: "dev100" }), mockToken)

      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZTEST", undefined, 1)
    })

    it("returns standard object info with line count", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZREPORT",
          type: "PROG/P",
          uri: "/sap/bc/adt/programs/programs/zreport",
          description: "Test Report",
          package: "ZTEST_PKG",
          systemType: "SAP"
        }
      ])
      mockClient.getObjectSource.mockResolvedValue("REPORT zreport.\nWRITE 'Hello'.\n")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("ZREPORT")
      expect(text).toContain("PROG/P")
      expect(text).toContain("Test Report")
      expect(text).toContain("ZTEST_PKG")
      // 3 lines (including trailing empty from split)
      expect(text).toContain("Total Lines")
    })

    it("handles getObjectSource failure gracefully with fallback", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZPROG",
          type: "PROG/P",
          uri: "/sap/bc/adt/programs/programs/zprog",
          description: "A program",
          package: "ZPACK",
          systemType: "SAP"
        }
      ])
      // Both optimal and original URI fail
      mockClient.getObjectSource.mockRejectedValue(new Error("Source not accessible"))

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )

      // Should still return result with "Access failed" or "Unknown" for lines
      const text = result.parts[0].text
      expect(text).toContain("ZPROG")
    })
  })

  // =========================================================================
  // invoke — table/structure objects
  // =========================================================================
  describe("invoke table objects", () => {
    it("uses getCompleteTableStructure for TABL/DT objects", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZMYTABLE",
          type: "TABL/DT",
          uri: "/sap/bc/adt/ddic/tables/zmytable",
          description: "Custom Table",
          package: "ZPACK",
          systemType: "SAP"
        }
      ])
      ;(getCompleteTableStructure as Mock).mockResolvedValue(
        "Complete Table Structure for ZMYTABLE:\n" +
          "============\n" +
          "MAIN TABLE STRUCTURE:\n" +
          "MANDT CLNT 3\n" +
          "FIELD1 CHAR 10\n"
      )

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZMYTABLE", connectionId: "dev100" }),
        mockToken
      )

      expect(getCompleteTableStructure).toHaveBeenCalledWith(
        "dev100",
        "ZMYTABLE",
        "/sap/bc/adt/ddic/tables/zmytable"
      )
      expect(result.parts[0].text).toContain("ZMYTABLE")
      expect(result.parts[0].text).toContain("Database Table")
    })

    it("falls back to standard info when table structure fetch fails", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZMYTABLE",
          type: "TABL/TA",
          uri: "/sap/bc/adt/ddic/tables/zmytable",
          description: "Another Table",
          package: "ZPACK",
          systemType: "SAP"
        }
      ])
      ;(getCompleteTableStructure as Mock).mockRejectedValue(new Error("DD query failed"))
      mockClient.getObjectSource.mockResolvedValue("table zmytable\n  field1\n  field2\n")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZMYTABLE", connectionId: "dev100" }),
        mockToken
      )

      // Should fall through to standard object info
      expect(result.parts[0].text).toContain("ZMYTABLE")
    })

    it("detects append structures count from structure content", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "MARA",
          type: "TABL/TA",
          uri: "/sap/bc/adt/ddic/tables/mara",
          description: "Material Master",
          package: "MM",
          systemType: "SAP"
        }
      ])
      ;(getCompleteTableStructure as Mock).mockResolvedValue(
        "Complete Table Structure for MARA:\n" +
          "MAIN TABLE STRUCTURE:\n" +
          "MATNR CHAR 40\n" +
          "ALL APPEND STRUCTURES (2):\n" +
          "• ZAPPEND1 (3 fields)\n" +
          "• ZAPPEND2 (2 fields)\n"
      )

      const result: any = await tool.invoke(
        makeOptions({ objectName: "MARA", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Append structures: 2")
      expect(result.parts[0].text).toContain("custom fields")
    })
  })

  // =========================================================================
  // invoke — enhancements
  // =========================================================================
  describe("invoke enhancements", () => {
    it("includes enhancement info when found", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZPROG",
          type: "PROG/P",
          uri: "/sap/bc/adt/programs/programs/zprog",
          description: "Test",
          package: "ZPKG",
          systemType: "SAP"
        }
      ])
      mockClient.getObjectSource.mockResolvedValue("REPORT zprog.\n")
      ;(getObjectEnhancements as Mock).mockResolvedValue({
        hasEnhancements: true,
        totalEnhancements: 2,
        enhancements: [
          { name: "ZENH1", startLine: 10 },
          { name: "ZENH2", startLine: 25 }
        ]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("2 enhancement(s)")
      expect(result.parts[0].text).toContain("ZENH1")
      expect(result.parts[0].text).toContain("ZENH2")
    })

    it("reports no enhancements when none found", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZPROG",
          type: "PROG/P",
          uri: "/sap/bc/adt/programs/programs/zprog",
          description: "Test",
          package: "ZPKG",
          systemType: "SAP"
        }
      ])
      mockClient.getObjectSource.mockResolvedValue("REPORT zprog.\n")
      ;(getObjectEnhancements as Mock).mockResolvedValue({
        hasEnhancements: false,
        enhancements: []
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("No enhancements found")
    })
  })

  // =========================================================================
  // invoke — error handling
  // =========================================================================
  describe("invoke error handling", () => {
    it("wraps errors with descriptive message", async () => {
      mockSearcher.searchObjects.mockRejectedValue(new Error("Network error"))

      await expect(
        tool.invoke(makeOptions({ objectName: "ZTEST", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("Failed to get info for ABAP object")
    })

    it("propagates underlying error message", async () => {
      mockSearcher.searchObjects.mockRejectedValue(new Error("Timeout connecting to SAP"))

      await expect(
        tool.invoke(makeOptions({ objectName: "ZTEST", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("Timeout connecting to SAP")
    })

    it("handles object with no URI", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        {
          name: "ZOBJ",
          type: "PROG/P",
          uri: undefined,
          description: "No URI object",
          package: "ZPKG",
          systemType: "SAP"
        }
      ])

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZOBJ", connectionId: "dev100" }),
        mockToken
      )

      // Should return info but with unknown lines
      expect(result.parts[0].text).toContain("ZOBJ")
      expect(result.parts[0].text).toContain("Unknown")
    })
  })
})
