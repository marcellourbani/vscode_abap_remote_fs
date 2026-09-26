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

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  abapUri: vi.fn()
}))
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
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
vi.mock("./shared", () => ({
  getOptimalObjectURI: vi.fn(function (type: string, uri: string) {
    return uri + "/source/main"
  }),
  resolveCorrectURI: vi.fn(function (uri: string) {
    return Promise.resolve(uri)
  }),
  getObjectEnhancements: vi.fn(function () {
    return Promise.resolve({ hasEnhancements: false, enhancements: [] })
  }),
  getTableTypeFromDD: vi.fn(function () {
    return Promise.resolve("")
  }),
  getTableStructureFromDD: vi.fn(function () {
    return Promise.resolve("")
  })
}))

import { GetABAPObjectLinesTool } from "./getObjectLinesTool"
import { getSearchService } from "../abapSearchService"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: vi.fn() }
const mockClient = { getObjectSource: vi.fn() }

describe("GetABAPObjectLinesTool", () => {
  let tool: GetABAPObjectLinesTool

  beforeEach(() => {
    tool = new GetABAPObjectLinesTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getClient as Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  describe("prepareInvocation", () => {
    it("returns method extraction message when methodName provided", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", methodName: "FACTORY", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("FACTORY")
    })

    it("returns line range message when no methodName", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG", startLine: 1, lineCount: 50, connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZPROG")
    })
  })

  describe("extractMethod (via invoke)", () => {
    const classSource = [
      "CLASS ZCLASS DEFINITION.",
      "  PUBLIC SECTION.",
      "    METHODS: factory.",
      "ENDCLASS.",
      "",
      "CLASS ZCLASS IMPLEMENTATION.",
      "  METHOD factory.",
      "    DATA lv_obj TYPE REF TO ZCLASS.",
      "    CREATE OBJECT lv_obj.",
      "    rv_obj = lv_obj.",
      "  ENDMETHOD.",
      "",
      "  METHOD constructor.",
      "    me->name = iv_name.",
      "  ENDMETHOD.",
      "ENDCLASS."
    ].join("\n")

    beforeEach(() => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZCLASS", type: "CLAS/OC", uri: "/sap/bc/adt/oo/classes/zclass" }
      ])
      mockClient.getObjectSource.mockResolvedValue(classSource)
    })

    it("extracts specific method by name", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCLASS", methodName: "factory", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("FACTORY")
      expect(result.parts[0].text).toContain("METHOD factory")
      expect(result.parts[0].text).not.toContain("METHOD constructor")
    })

    it("returns not-found message for non-existent method", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZCLASS", methodName: "NONEXISTENT", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("NOT FOUND")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "dev100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_abap_object_lines_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("returns not-found message when search yields no results", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "MISSING", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Could not find")
    })

    it("returns source lines on success", async () => {
      const source = Array.from({ length: 100 }, (_, i) => `LINE ${i + 1}`).join("\n")
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZPROG", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zprog" }
      ])
      mockClient.getObjectSource.mockResolvedValue(source)

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100", startLine: 1, lineCount: 10 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("LINE 1")
    })

    it("respects startLine offset (1-based)", async () => {
      const source = Array.from({ length: 20 }, (_, i) => `LINE ${i + 1}`).join("\n")
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZPROG", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zprog" }
      ])
      mockClient.getObjectSource.mockResolvedValue(source)

      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100", startLine: 5, lineCount: 5 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("LINE 5")
      expect(result.parts[0].text).not.toContain("LINE 1")
    })

    it("returns error message when no connectionId and no active ABAP editor", async () => {
      const result: any = await tool.invoke(makeOptions({ objectName: "ZPROG" }), mockToken)
      expect(result.parts[0].text).toContain("Could not access content")
    })
  })
})
