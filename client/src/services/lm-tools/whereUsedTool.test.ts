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
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("./shared", () => ({
  getOptimalObjectURI: jest.fn((type: string, uri: string) => uri + "/source/main")
}))

import { ABAPWhereUsedTool } from "./whereUsedTool"
import { getSearchService } from "../abapSearchService"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: jest.fn() }
const mockUsageReferences = jest.fn()
const mockUsageReferenceSnippets = jest.fn()
const mockGetObjectSource = jest.fn()
const mockClient = {
  getObjectSource: mockGetObjectSource,
  statelessClone: {
    usageReferences: mockUsageReferences,
    usageReferenceSnippets: mockUsageReferenceSnippets
  }
}

/** Helper to build a valid reference object that passes the goodRefs filter */
function makeRef(fullName: string, opts: {
  type?: string, name?: string, pkg?: string, desc?: string, uri?: string
} = {}) {
  return {
    objectIdentifier: `ABAPFullName;${fullName}`,
    "adtcore:type": opts.type || "PROG/P",
    "adtcore:name": opts.name || fullName,
    "adtcore:packageName": opts.pkg || "$TMP",
    "adtcore:description": opts.desc || "",
    uri: opts.uri || `/sap/bc/adt/programs/${fullName.toLowerCase()}`
  }
}

describe("ABAPWhereUsedTool", () => {
  let tool: ABAPWhereUsedTool

  beforeEach(() => {
    tool = new ABAPWhereUsedTool()
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    mockGetObjectSource.mockResolvedValue("REPORT ztest.\nWRITE 'hello'.\n")
    mockUsageReferences.mockResolvedValue([])
    mockUsageReferenceSnippets.mockResolvedValue([])
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with object name", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZCLASS")
    })

    it("includes objectType in target when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("CLAS/OC")
    })

    it("includes searchTerm in target when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", searchTerm: "MY_METHOD", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("MY_METHOD")
    })

    it("includes line info when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", line: 42, connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("42")
    })

    it("shows filter info when filter provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZCLASS",
          connectionId: "dev100",
          filter: { objectNamePattern: "Z*", excludeSystemObjects: true }
        }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("Z*")
      expect((result.confirmationMessages as any).message.text).toContain("exclude SAP standard")
    })

    it("shows startIndex when provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZCLASS",
          connectionId: "dev100",
          startIndex: 500
        }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("500")
    })

    it("shows default maxResults of 50", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("50")
    })

    it("shows objectType filter in filter info", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectName: "ZCLASS",
          connectionId: "dev100",
          filter: { objectTypes: ["PROG/P", "CLAS/OC"] }
        }),
        mockToken
      )
      const text = (result.confirmationMessages as any).message.text
      expect(text).toContain("PROG/P")
      expect(text).toContain("CLAS/OC")
    })
  })

  describe("invoke", () => {
    it("logs telemetry with connectionId", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      ).catch(() => {})
      expect(logTelemetry).toHaveBeenCalledWith("tool_find_where_used_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ objectName: "ZCLASS", connectionId: "DEV100" }),
        mockToken
      ).catch(() => {})
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("returns no-results message when object not found in search", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "MISSING", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("MISSING")
    })

    it("wraps errors from client calls", async () => {
      ;(getClient as jest.Mock).mockImplementation(() => {
        throw new Error("where-used service down")
      })
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCLASS", type: "CLAS/OC", uri: "/sap/bc/adt/oo/classes/zclass" }
      ])
      await expect(
        tool.invoke(
          makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow()
    })

    it("returns message when object has no URI", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCLASS", type: "CLAS/OC", uri: undefined }
      ])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Could not get URI")
    })

    it("includes objectType in not-found message when specified", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("CLAS/OC")
    })

    describe("searchTerm position logic", () => {
      const searchObj = { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }

      it("finds searchTerm in source and uses its position for where-used", async () => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
        mockGetObjectSource.mockResolvedValue(
          "REPORT ztest.\nDATA lv_val TYPE string.\nCALL METHOD my_method.\n"
        )
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])

        await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", searchTerm: "my_method" }),
          mockToken
        )

        // Should search at line 3 (1-based) where "my_method" appears
        expect(mockUsageReferences).toHaveBeenCalledWith(
          expect.any(String),
          3, // line 3
          expect.any(Number)
        )
      })

      it("returns error when searchTerm not found in source", async () => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
        mockGetObjectSource.mockResolvedValue("REPORT ztest.\nWRITE 'hello'.\n")

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", searchTerm: "NONEXISTENT" }),
          mockToken
        )
        expect(result.parts[0].text).toContain("NONEXISTENT")
        expect(result.parts[0].text).toContain("not found")
      })

      it("uses case-insensitive search for searchTerm", async () => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
        mockGetObjectSource.mockResolvedValue("REPORT ztest.\nCALL METHOD MY_METHOD.\n")
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])

        await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", searchTerm: "my_method" }),
          mockToken
        )

        // Should still find it despite case difference
        expect(mockUsageReferences).toHaveBeenCalledWith(
          expect.any(String),
          2,
          expect.any(Number)
        )
      })

      it("defaults to line 1 when no searchTerm, no line, and no declaration found", async () => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
        mockGetObjectSource.mockResolvedValue("DATA lv_val TYPE string.\n")
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])

        await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        expect(mockUsageReferences).toHaveBeenCalledWith(
          expect.any(String),
          1,
          0
        )
      })

      it("uses explicit line and character when provided", async () => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
        mockGetObjectSource.mockResolvedValue("REPORT ztest.\nWRITE 'hello'.\n")
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])

        await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", line: 5, character: 10 }),
          mockToken
        )

        expect(mockUsageReferences).toHaveBeenCalledWith(expect.any(String), 5, 10)
      })
    })

    describe("reference filtering", () => {
      const searchObj = { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }

      beforeEach(() => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
      })

      it("filters by objectNamePattern using wildcards", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZCL_CUSTOM_CLASS", { type: "CLAS/OC" }),
          makeRef("CL_STANDARD_CLASS", { type: "CLAS/OC" }),
          makeRef("ZCL_ANOTHER", { type: "CLAS/OC" })
        ])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            filter: { objectNamePattern: "ZCL_*" }
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZCL_CUSTOM_CLASS")
        expect(text).toContain("ZCL_ANOTHER")
        expect(text).not.toContain("CL_STANDARD_CLASS")
      })

      it("filters by objectTypes", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZPROG1", { type: "PROG/P" }),
          makeRef("ZCL_CLS", { type: "CLAS/OC" }),
          makeRef("ZPROG2", { type: "PROG/P" })
        ])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            filter: { objectTypes: ["CLAS/OC"] }
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZCL_CLS")
        expect(text).not.toContain("ZPROG1")
        expect(text).not.toContain("ZPROG2")
      })

      it("excludeSystemObjects keeps only Z/Y objects", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZCL_CUSTOM", { type: "CLAS/OC" }),
          makeRef("CL_STANDARD", { type: "CLAS/OC" }),
          makeRef("YCL_ANOTHER", { type: "CLAS/OC" }),
          makeRef("/NAMESPACE/CLASS", { type: "CLAS/OC" })
        ])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            filter: { excludeSystemObjects: true }
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZCL_CUSTOM")
        expect(text).toContain("YCL_ANOTHER")
        expect(text).not.toContain("CL_STANDARD")
        expect(text).not.toContain("/NAMESPACE/CLASS")
      })

      it("returns filtered-empty message when all refs excluded by filter", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("CL_STANDARD", { type: "CLAS/OC" })
        ])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            filter: { excludeSystemObjects: true }
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("No references found after applying filters")
        expect(text).toContain("Total references before filtering")
      })

      it("combines multiple filters", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZCL_CUSTOM", { type: "CLAS/OC" }),
          makeRef("ZPROG_TEST", { type: "PROG/P" }),
          makeRef("CL_STANDARD", { type: "CLAS/OC" })
        ])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            filter: { excludeSystemObjects: true, objectTypes: ["CLAS/OC"] }
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZCL_CUSTOM")
        expect(text).not.toContain("ZPROG_TEST") // filtered by type
        expect(text).not.toContain("CL_STANDARD") // filtered by system exclusion
      })

      it("shows filter statistics in result text", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZCL_CUSTOM", { type: "CLAS/OC" }),
          makeRef("CL_STD1", { type: "CLAS/OC" }),
          makeRef("CL_STD2", { type: "CLAS/OC" })
        ])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            filter: { excludeSystemObjects: true }
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("Total references found: 3")
        expect(text).toContain("filtered 2")
      })
    })

    describe("pagination", () => {
      const searchObj = { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }

      beforeEach(() => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
      })

      it("applies startIndex to skip earlier results", async () => {
        const refs = Array.from({ length: 5 }, (_, i) => makeRef(`ZOBJ_${i}`))
        mockUsageReferences.mockResolvedValue(refs)

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            startIndex: 3, maxResults: 50
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZOBJ_3")
        expect(text).toContain("ZOBJ_4")
        expect(text).not.toContain("ZOBJ_0")
        expect(text).not.toContain("ZOBJ_1")
        expect(text).not.toContain("ZOBJ_2")
      })

      it("limits results to maxResults", async () => {
        const refs = Array.from({ length: 10 }, (_, i) => makeRef(`ZOBJ_${i}`))
        mockUsageReferences.mockResolvedValue(refs)

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            maxResults: 3
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZOBJ_0")
        expect(text).toContain("ZOBJ_1")
        expect(text).toContain("ZOBJ_2")
        expect(text).not.toContain("ZOBJ_3")
      })

      it("returns empty-range message when startIndex exceeds available refs", async () => {
        mockUsageReferences.mockResolvedValue([makeRef("ZOBJ_0")])

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            startIndex: 100, maxResults: 50
          }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("No references found at index range")
        expect(text).toContain("Try a lower startIndex")
      })

      it("shows remaining count when more results exist", async () => {
        const refs = Array.from({ length: 10 }, (_, i) => makeRef(`ZOBJ_${i}`))
        mockUsageReferences.mockResolvedValue(refs)

        const result: any = await tool.invoke(
          makeOptions({
            objectName: "ZTEST", connectionId: "dev100",
            maxResults: 3, startIndex: 2
          }),
          mockToken
        )

        const text = result.parts[0].text
        // startIndex=2, maxResults=3 → showing items 2,3,4 out of 10 → 5 remaining
        expect(text).toContain("Remaining results: 5")
        expect(text).toContain("startIndex: 5")
      })
    })

    describe("result format and grouping", () => {
      const searchObj = { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }

      beforeEach(() => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
      })

      it("groups multiple references to the same object", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZCL_CALLER", { type: "CLAS/OC", name: "METHOD_A" }),
          makeRef("ZCL_CALLER", { type: "CLAS/OC", name: "METHOD_B" })
        ])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        // Should show "ZCL_CALLER (2 references)"
        expect(text).toContain("ZCL_CALLER")
        expect(text).toContain("2 reference")
      })

      it("includes type, name, package and URI in reference details", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZPROG_REPORT", {
            type: "PROG/P",
            name: "ZPROG_REPORT",
            pkg: "ZPACKAGE",
            desc: "Test Report",
            uri: "/sap/bc/adt/programs/zprog_report"
          })
        ])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("PROG/P")
        expect(text).toContain("ZPROG_REPORT")
        expect(text).toContain("ZPACKAGE")
        expect(text).toContain("Test Report")
        expect(text).toContain("/sap/bc/adt/programs/zprog_report")
      })

      it("shows summary with total references and unique objects", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZOBJ_A"),
          makeRef("ZOBJ_A"),
          makeRef("ZOBJ_B")
        ])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("Total References:** 3")
        expect(text).toContain("Unique Objects:** 2")
      })

      it("filters out refs without valid ABAPFullName identifier", async () => {
        mockUsageReferences.mockResolvedValue([
          makeRef("ZVALID_OBJ"),
          { objectIdentifier: "NotABAPFullName;ZINVALID", "adtcore:type": "PROG/P" },
          { objectIdentifier: undefined }
        ])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        const text = result.parts[0].text
        expect(text).toContain("ZVALID_OBJ")
        // The invalid refs should not appear (only 1 result)
        expect(text).toContain("Total References:** 1")
      })
    })

    describe("empty results", () => {
      const searchObj = { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }

      beforeEach(() => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
      })

      it("returns no-references message when usageReferences returns empty array", async () => {
        mockUsageReferences.mockResolvedValue([])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("No references found")
      })

      it("returns no-valid-references message when all refs lack ABAPFullName", async () => {
        mockUsageReferences.mockResolvedValue([
          { objectIdentifier: "BAD;NOPE" },
          { objectIdentifier: null }
        ])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("No valid references found")
      })

      it("includes searchTerm in no-references message", async () => {
        mockGetObjectSource.mockResolvedValue("REPORT ztest.\nMETHOD my_func.\nENDMETHOD.\n")
        mockUsageReferences.mockResolvedValue([])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", searchTerm: "my_func" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("my_func")
      })
    })

    describe("includeSnippets", () => {
      const searchObj = { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }

      beforeEach(() => {
        mockSearcher.searchObjects.mockResolvedValue([searchObj])
      })

      it("does not call usageReferenceSnippets when includeSnippets is false", async () => {
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])

        await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", includeSnippets: false }),
          mockToken
        )

        expect(mockUsageReferenceSnippets).not.toHaveBeenCalled()
      })

      it("calls usageReferenceSnippets and includes snippet content when includeSnippets is true", async () => {
        const refs = [makeRef("ZCALLER")]
        mockUsageReferences.mockResolvedValue(refs)
        mockUsageReferenceSnippets.mockResolvedValue([
          {
            objectIdentifier: "ABAPFullName;ZCALLER",
            snippets: [
              { uri: { start: { line: 10 } }, content: "CALL METHOD ztest=>do_something." }
            ]
          }
        ])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", includeSnippets: true }),
          mockToken
        )

        expect(mockUsageReferenceSnippets).toHaveBeenCalled()
        expect(result.parts[0].text).toContain("Usage Snippets")
        expect(result.parts[0].text).toContain("CALL METHOD ztest=>do_something")
      })

      it("handles snippet retrieval error gracefully", async () => {
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])
        mockUsageReferenceSnippets.mockRejectedValue(new Error("snippet service down"))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", includeSnippets: true }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Could not retrieve usage snippets")
      })
    })

    describe("error paths", () => {
      it("returns error when usageReferences call fails", async () => {
        mockSearcher.searchObjects.mockResolvedValue([
          { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }
        ])
        mockUsageReferences.mockRejectedValue(new Error("ADT connection lost"))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Where-used search failed")
        expect(result.parts[0].text).toContain("ADT connection lost")
      })

      it("returns error when searchTerm specified but source cannot be fetched", async () => {
        mockSearcher.searchObjects.mockResolvedValue([
          { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }
        ])
        // Both getObjectSource calls fail
        mockGetObjectSource.mockRejectedValue(new Error("source unavailable"))

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100", searchTerm: "MY_VAR" }),
          mockToken
        )

        expect(result.parts[0].text).toContain("Could not access source")
      })

      it("continues without source when no searchTerm and source fetch fails", async () => {
        mockSearcher.searchObjects.mockResolvedValue([
          { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/ztest" }
        ])
        mockGetObjectSource.mockRejectedValue(new Error("source unavailable"))
        mockUsageReferences.mockResolvedValue([makeRef("ZCALLER")])

        const result: any = await tool.invoke(
          makeOptions({ objectName: "ZTEST", connectionId: "dev100" }),
          mockToken
        )

        // Should still succeed since searchTerm was not required
        expect(result.parts[0].text).toContain("ZCALLER")
      })

      it("passes objectType to searchObjects when provided", async () => {
        mockSearcher.searchObjects.mockResolvedValue([])

        await tool.invoke(
          makeOptions({ objectName: "ZTEST", objectType: "CLAS/OC", connectionId: "dev100" }),
          mockToken
        )

        expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZTEST", ["CLAS/OC"], 1)
      })
    })
  })
})
