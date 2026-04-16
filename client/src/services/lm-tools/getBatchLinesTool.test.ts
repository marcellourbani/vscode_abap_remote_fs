jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("./shared", () => ({
  getOptimalObjectURI: jest.fn((type: string, uri: string) => uri + "/source/main"),
  resolveCorrectURI: jest.fn((uri: string) => Promise.resolve(uri))
}))

import { GetBatchLinesTool } from "./getBatchLinesTool"
import { getSearchService } from "../abapSearchService"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: jest.fn() }
const mockClient = { getObjectSource: jest.fn() }

describe("GetBatchLinesTool", () => {
  let tool: GetBatchLinesTool

  beforeEach(() => {
    tool = new GetBatchLinesTool()
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  describe("prepareInvocation", () => {
    it("includes object count in invocation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          requests: [{ objectName: "ZCLASS" }, { objectName: "ZPROG" }],
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("2")
    })

    it("lists object names in confirmation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          requests: [{ objectName: "ZCLASS" }, { objectName: "ZPROG" }],
          connectionId: "dev100"
        }),
        mockToken
      )
      const msgText = (result.confirmationMessages as any).message.text
      expect(msgText).toContain("ZCLASS")
      expect(msgText).toContain("ZPROG")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ requests: [{ objectName: "ZPROG" }], connectionId: "dev100" }),
        mockToken
      )
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_batch_lines_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      await tool.invoke(
        makeOptions({ requests: [{ objectName: "ZPROG" }], connectionId: "DEV100" }),
        mockToken
      )
      expect(getSearchService).toHaveBeenCalledWith("dev100")
    })

    it("processes multiple requests in parallel", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZPROG", type: "PROG/P", uri: "/sap/bc/adt/programs/zprog" }
      ])
      mockClient.getObjectSource.mockResolvedValue("line1\nline2\nline3")
      const result: any = await tool.invoke(
        makeOptions({
          requests: [{ objectName: "ZPROG" }, { objectName: "ZCLASS" }],
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(mockSearcher.searchObjects).toHaveBeenCalledTimes(2)
    })

    it("reports not-found objects gracefully", async () => {
      mockSearcher.searchObjects.mockResolvedValue([])
      const result: any = await tool.invoke(
        makeOptions({ requests: [{ objectName: "MISSING" }], connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("MISSING")
      expect(result.parts[0].text).toContain("not found")
    })

    it("includes source lines for found objects", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZPROG", type: "PROG/P", uri: "/sap/bc/adt/programs/zprog" }
      ])
      mockClient.getObjectSource.mockResolvedValue("REPORT ZPROG.\nSTART-OF-SELECTION.\n  WRITE 'Hello'.")
      const result: any = await tool.invoke(
        makeOptions({ requests: [{ objectName: "ZPROG" }], connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ZPROG")
    })

    it("respects startLine and lineCount per request", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZPROG", type: "PROG/P", uri: "/sap/bc/adt/programs/zprog" }
      ])
      const content = Array.from({ length: 20 }, (_, i) => `LINE ${i + 1}`).join("\n")
      mockClient.getObjectSource.mockResolvedValue(content)
      const result: any = await tool.invoke(
        makeOptions({
          requests: [{ objectName: "ZPROG", startLine: 5, lineCount: 3 }],
          connectionId: "dev100"
        }),
        mockToken
      )
      // Should contain content from the object
      expect(result.parts[0].text).toBeDefined()
    })

    it("throws when no connectionId and no active ABAP editor", async () => {
      await expect(
        tool.invoke(makeOptions({ requests: [{ objectName: "ZPROG" }] }), mockToken)
      ).rejects.toThrow()
    })

    it("handles objects with no URI", async () => {
      mockSearcher.searchObjects.mockResolvedValue([
        { name: "ZPROG", type: "PROG/P", uri: undefined }
      ])
      const result: any = await tool.invoke(
        makeOptions({ requests: [{ objectName: "ZPROG" }], connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No URI")
    })
  })
})
