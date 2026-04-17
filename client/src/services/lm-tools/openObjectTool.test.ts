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
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("../../commands/commands", () => ({ openObject: jest.fn() }))

import { OpenObjectTool } from "./openObjectTool"
import { getSearchService } from "../abapSearchService"
import { openObject } from "../../commands/commands"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = {
  searchObjects: jest.fn()
}

describe("OpenObjectTool", () => {
  let tool: OpenObjectTool

  beforeEach(() => {
    tool = new OpenObjectTool()
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
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
      ;(openObject as jest.Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_open_object_called", { connectionId: "DEV100" })
    })

    it("uses lowercase connectionId for service", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as jest.Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("returns success message on successful open", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as jest.Mock).mockResolvedValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ZPROG")
      expect(result.parts[0].text).toContain("opened successfully")
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
      ;(openObject as jest.Mock).mockRejectedValue(new Error("editor error"))
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("editor error")
    })

    it("searches with objectType when provided", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/oo/classes/zclass" }])
      ;(openObject as jest.Mock).mockResolvedValue(undefined)
      await tool.invoke(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZCLASS", ["CLAS/OC"], 1)
    })

    it("searches without objectType filter when not provided", async () => {
      mockSearcher.searchObjects.mockResolvedValue([{ uri: "/sap/bc/adt/programs/programs/zprog" }])
      ;(openObject as jest.Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "dev100" }), mockToken)
      expect(mockSearcher.searchObjects).toHaveBeenCalledWith("ZPROG", undefined, 1)
    })

    it("calls openObject with lowercase connectionId and URI", async () => {
      const uri = "/sap/bc/adt/programs/programs/zprog"
      mockSearcher.searchObjects.mockResolvedValue([{ uri }])
      ;(openObject as jest.Mock).mockResolvedValue(undefined)
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(openObject).toHaveBeenCalledWith("dev100", uri)
    })
  })
})
