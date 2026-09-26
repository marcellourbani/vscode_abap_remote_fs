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

vi.mock("../../adt/conections", () => ({}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
vi.mock("../../commands/commands", () => ({ openObject: vi.fn() }))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { OpenObjectTool } from "./openObjectTool"
import { getSearchService } from "../abapSearchService"
import { openObject } from "../../commands/commands"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = {
  searchObjects: vi.fn()
}

describe("OpenObjectTool", () => {
  let tool: OpenObjectTool

  beforeEach(() => {
    tool = new OpenObjectTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(window as any).activeTextEditor = undefined
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with object name", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZCLASS")
    })

    it("includes objectType in invocation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("CLAS/OC")
    })

    it("returns confirmation messages", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.confirmationMessages).toBeDefined()
      expect((result.confirmationMessages as any).title).toBe("Open ABAP Object")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_open_object_called", {
        connectionId: "DEV100"
      })
    })

    it("uses lowercase connectionId for service", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("returns success message on successful open", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as Mock).mockResolvedValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ZPROG")
      expect(result.parts[0].text).toContain("opened in editor")
    })

    it("returns failure message when object not found", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "NOTEXIST", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to open object")
    })

    it("returns failure message when no URI on found object", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: undefined }])
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed to open object")
    })

    it("returns failure message when openObject throws", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as Mock).mockRejectedValue(new Error("editor error"))
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("editor error")
    })

    it("searches with objectType when provided", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/oo/classes/zclass" }])
      ;(openObject as Mock).mockResolvedValue(undefined)
      await tool.invoke(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZCLASS", ["CLAS/OC"], 1)
    })

    it("searches without objectType filter when not provided", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "dev100" }), mockToken)
      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZPROG", undefined, 1)
    })

    it("calls openObject with lowercase connectionId and URI", async () => {
      const uri = "/sap/bc/adt/programs/programs/zprog"
      mockSearcher.searchObjects.mockResolvedValue([{ uri }])
      ;(openObject as Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(openObject).toHaveBeenCalledWith("dev100", uri)
    })
  })
})
