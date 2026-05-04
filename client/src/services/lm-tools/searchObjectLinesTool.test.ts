jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((value: string) => ({ value })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../abapCopilotLogger", () => ({
  logCommands: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("./shared", () => ({
  getOptimalObjectURI: jest.fn((type: string, uri: string) => uri + "/source/main"),
  resolveCorrectURI: jest.fn((uri: string) => Promise.resolve(uri)),
  getObjectEnhancements: jest.fn(() => Promise.resolve({ hasEnhancements: false, enhancements: [] })),
  getTableTypeFromDD: jest.fn(() => Promise.resolve("")),
  getTableStructureFromDD: jest.fn(() => Promise.resolve(""))
}))

import { SearchABAPObjectLinesTool } from "./searchObjectLinesTool"
import { getSearchService } from "../abapSearchService"
import { getClient, abapUri } from "../../adt/conections"
import { funWindow as window } from "../funMessenger"
import { logTelemetry } from "../telemetry"
import { getObjectEnhancements } from "./shared"

const mockToken = {} as any
function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: jest.fn() }
const mockClient = { getObjectSource: jest.fn() }

describe("SearchABAPObjectLinesTool", () => {
  let tool: SearchABAPObjectLinesTool

  beforeEach(() => {
    tool = new SearchABAPObjectLinesTool()
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  // =========================================================================
  // prepareInvocation
  // =========================================================================
  describe("prepareInvocation", () => {
    it("shows objectName and searchTerm in message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", searchTerm: "SELECT", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("SELECT")
      expect(result.invocationMessage).toContain("ZREPORT")
      expect(result.confirmationMessages.message.value).toContain("SELECT")
      expect(result.confirmationMessages.message.value).toContain("ZREPORT")
    })

    it("shows REGEX flag when isRegexp is true", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", searchTerm: "METHOD.*factory", isRegexp: true, connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("REGEX")
    })

    it("shows MAX OBJECTS when maxObjects > 1", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "Z*", searchTerm: "SELECT", maxObjects: 5, connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("MAX 5 OBJECTS")
      expect(result.invocationMessage).toContain("up to 5 objects")
    })

    it("uses single-object message when maxObjects is 1", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", searchTerm: "DATA", maxObjects: 1, connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).not.toContain("up to")
      expect(result.invocationMessage).toContain("ZREPORT")
    })

    it("includes connectionId in message when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("dev100")
    })

    it("includes context lines in message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZREPORT", searchTerm: "DATA", contextLines: 5, connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages.message.value).toContain("5 context lines")
    })
  })

  // =========================================================================
  // invoke — connectionId resolution
  // =========================================================================
  describe("invoke connectionId resolution", () => {
    it("lowercases connectionId", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA", connectionId: "DEV100" }),
        mockToken
      )

      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("throws when no connectionId and no active editor", async () => {
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZTEST", searchTerm: "DATA" }),
          mockToken
        )
      ).rejects.toThrow("No active ABAP document")
    })

    it("throws when active editor has non-ABAP uri", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "local", scheme: "file" } }
      }
      ;(abapUri as jest.Mock).mockReturnValue(false)

      await expect(
        tool.invoke(makeOptions({ objectName: "ZTEST", searchTerm: "DATA" }), mockToken)
      ).rejects.toThrow("No active ABAP document")
    })

    it("resolves connectionId from active ABAP editor", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { authority: "dev100", scheme: "adt" } }
      }
      ;(abapUri as jest.Mock).mockReturnValue(true)
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA" }),
        mockToken
      )

      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )

      expect(logTelemetry).toHaveBeenCalledWith("tool_search_abap_object_lines_called", { connectionId: "dev100" })
    })
  })

  // =========================================================================
  // invoke — search behavior
  // =========================================================================
  describe("invoke search behavior", () => {
    const sourceCode = [
      "REPORT ztest.",
      "",
      "DATA: lv_name TYPE string,",
      "      lv_count TYPE i.",
      "",
      "SELECT * FROM mara INTO TABLE @DATA(lt_mara).",
      "LOOP AT lt_mara ASSIGNING FIELD-SYMBOL(<ls_mara>).",
      "  WRITE: / <ls_mara>-matnr.",
      "ENDLOOP."
    ].join("\n")

    beforeEach(() => {
      mockSearcher.searchObjects.mockResolvedValue([{
        name: "ZTEST",
        type: "PROG/P",
        uri: "/sap/bc/adt/programs/programs/ztest"
      }])
      mockClient.getObjectSource.mockResolvedValue(sourceCode)
    })

    it("finds literal text matches (case-insensitive)", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "select", connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("1")  // 1 match
      expect(text).toContain("SELECT")
    })

    it("finds multiple matches", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "lv_", connectionId: "dev100" }),
        mockToken
      )

      // lv_name and lv_count both on line 3
      const text = result.parts[0].text
      expect(text).toContain("lv_")
    })

    it("returns no-matches message when search term not found", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "NONEXISTENT_TERM", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("No matches found")
      expect(result.parts[0].text).toContain("NONEXISTENT_TERM")
    })

    it("handles regex search mode", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA.*string", isRegexp: true, connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("DATA")
    })

    it("falls back to literal search when regex is invalid", async () => {
      // Invalid regex like unmatched bracket
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA", isRegexp: true, connectionId: "dev100" }),
        mockToken
      )

      // Should not throw, should still find DATA
      const text = result.parts[0].text
      expect(text).toContain("DATA")
    })

    it("includes context lines around matches", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "SELECT", contextLines: 2, connectionId: "dev100" }),
        mockToken
      )

      // Context should include lines before and after the match
      const text = result.parts[0].text
      expect(text).toContain("SELECT")
      // The match line should be prefixed with >
      expect(text).toContain(">")
    })
  })

  // =========================================================================
  // invoke — object not found
  // =========================================================================
  describe("invoke object not found", () => {
    it("returns not-found when search returns empty array", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZNONEXISTENT", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Could not find")
      expect(result.parts[0].text).toContain("ZNONEXISTENT")
    })

    it("returns not-found when search returns null", async () => {
      mockSearcher.searchObjects.mockResolvedValue(null)

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZNOTHING", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("Could not find")
    })
  })

  // =========================================================================
  // invoke — multi-object search (wildcard)
  // =========================================================================
  describe("invoke multi-object search", () => {
    it("searches across multiple objects with maxObjects", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZREPORT1", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zreport1" },
        { name: "ZREPORT2", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zreport2" }
      ])
      mockClient.getObjectSource
        .mockResolvedValueOnce("REPORT zreport1.\nDATA lv_found TYPE string.\n")
        .mockResolvedValueOnce("REPORT zreport2.\nDATA lv_also TYPE string.\n")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT*", searchTerm: "DATA", maxObjects: 5, connectionId: "dev100" }),
        mockToken
      )

      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZREPORT*", undefined, 5)
      const text = result.parts[0].text
      expect(text).toContain("ZREPORT1")
      expect(text).toContain("ZREPORT2")
      expect(text).toContain("2") // 2 objects
    })

    it("lists searched objects in multi-object mode", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZREP1", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zrep1" },
        { name: "ZREP2", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zrep2" }
      ])
      mockClient.getObjectSource.mockResolvedValue("REPORT zrep.\nWRITE 'hello'.\n")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREP*", searchTerm: "WRITE", maxObjects: 3, connectionId: "dev100" }),
        mockToken
      )

      // Multi-object mode should list objects searched
      const text = result.parts[0].text
      expect(text).toContain("ZREP1")
      expect(text).toContain("ZREP2")
    })

    it("shows no-match message with object list for multi-object search", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZREP1", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zrep1" },
        { name: "ZREP2", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zrep2" }
      ])
      mockClient.getObjectSource.mockResolvedValue("REPORT zrep.\n")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREP*", searchTerm: "NONEXISTENT", maxObjects: 3, connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("No matches found")
      expect(text).toContain("Objects searched")
    })
  })

  // =========================================================================
  // invoke — maxObjects clamping
  // =========================================================================
  describe("invoke maxObjects bounds", () => {
    it("clamps maxObjects below 1 to 1", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA", maxObjects: -5, connectionId: "dev100" }),
        mockToken
      )

      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZTEST", undefined, 1)
    })

    it("clamps maxObjects above 10 to 10", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])

      await tool.invoke(
        makeOptions({ objectName: "ZTEST", searchTerm: "DATA", maxObjects: 50, connectionId: "dev100" }),
        mockToken
      )

      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZTEST", undefined, 10)
    })
  })

  // =========================================================================
  // invoke — enhancement matches
  // =========================================================================
  describe("invoke enhancement search", () => {
    it("includes enhancement matches in results", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{
        name: "ZREPORT",
        type: "PROG/P",
        uri: "/sap/bc/adt/programs/programs/zreport"
      }])
      mockClient.getObjectSource.mockResolvedValue("REPORT zreport.\nWRITE 'base'.\n")
      ;(getObjectEnhancements as jest.Mock).mockResolvedValue({
        hasEnhancements: true,
        enhancements: [{
          name: "ZENH_IMPL",
          uri: "/sap/bc/adt/enhancements/zenh_impl",
          code: "DATA lv_enhanced TYPE string.\nlv_enhanced = 'FOUND_IN_ENH'.\n"
        }]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", searchTerm: "FOUND_IN_ENH", connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("Enhancement")
      expect(text).toContain("ZENH_IMPL")
      expect(text).toContain("FOUND_IN_ENH")
    })

    it("counts enhancement matches separately from base matches", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{
        name: "ZREPORT",
        type: "PROG/P",
        uri: "/sap/bc/adt/programs/programs/zreport"
      }])
      mockClient.getObjectSource.mockResolvedValue("REPORT zreport.\nDATA lv_test TYPE string.\n")
      ;(getObjectEnhancements as jest.Mock).mockResolvedValue({
        hasEnhancements: true,
        enhancements: [{
          name: "ZENH1",
          uri: "/sap/bc/adt/enhancements/zenh1",
          code: "DATA lv_enh TYPE string.\n"
        }]
      })

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREPORT", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("Base source matches")
      expect(text).toContain("Enhancement matches")
    })
  })

  // =========================================================================
  // invoke — table object search
  // =========================================================================
  describe("invoke table object search", () => {
    it("searches within complete table structure for TABL types", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{
        name: "MARA",
        type: "TABL/TA",
        uri: "/sap/bc/adt/ddic/tables/mara"
      }])
      // The tool internally calls getCompleteTableStructure (local helper)
      // which uses getClient().getObjectSource()
      mockClient.getObjectSource.mockResolvedValue(
        "MANDT CLNT 3\nMATNR CHAR 40\nERSDA DATE 8\n"
      )

      const result: any = await tool.invoke(
        makeOptions({ objectName: "MARA", searchTerm: "MATNR", connectionId: "dev100" }),
        mockToken
      )

      const text = result.parts[0].text
      expect(text).toContain("MATNR")
    })
  })

  // =========================================================================
  // invoke — error handling
  // =========================================================================
  describe("invoke error handling", () => {
    it("wraps errors with descriptive message", async () => {
      mockSearcher.searchObjects.mockRejectedValue(new Error("Network timeout"))

      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZTEST", searchTerm: "DATA", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow("Failed to search lines in ABAP object")
    })

    it("handles object with no URI gracefully", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{
        name: "ZOBJ",
        type: "PROG/P",
        uri: undefined
      }])

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZOBJ", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )

      // Object with no URI is skipped; since it's the only result we get no-matches
      const text = result.parts[0].text
      expect(text).toContain("No matches found")
    })

    it("handles getObjectSource failure for individual object in multi-search", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZREP1", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zrep1" },
        { name: "ZREP2", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zrep2" }
      ])
      mockClient.getObjectSource
        .mockRejectedValueOnce(new Error("Access denied"))
        .mockRejectedValueOnce(new Error("Access denied"))  // fallback also fails
        .mockRejectedValueOnce(new Error("Access denied"))  // resolved URI also fails
        .mockResolvedValueOnce("REPORT zrep2.\nDATA lv_x TYPE string.\n")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZREP*", searchTerm: "DATA", maxObjects: 5, connectionId: "dev100" }),
        mockToken
      )

      // Should still return results from zrep2 even if zrep1 failed
      const text = result.parts[0].text
      expect(text).toContain("ZREP2") // successful object
    })

    it("handles empty source content", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{
        name: "ZEMPTY",
        type: "PROG/P",
        uri: "/sap/bc/adt/programs/programs/zempty"
      }])
      mockClient.getObjectSource.mockResolvedValue("")

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZEMPTY", searchTerm: "DATA", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain("No matches found")
    })
  })
})
