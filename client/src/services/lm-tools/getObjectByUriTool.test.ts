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

import { GetObjectByURITool } from "./getObjectByUriTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = { getObjectSource: jest.fn() }

describe("GetObjectByURITool", () => {
  let tool: GetObjectByURITool

  beforeEach(() => {
    tool = new GetObjectByURITool()
    jest.clearAllMocks()
    ;(getClient as jest.Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with URI", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ uri: "/sap/bc/adt/programs/programs/zprog", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("/sap/bc/adt/programs/programs/zprog")
    })

    it("includes line range in confirmation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          uri: "/sap/bc/adt/programs/programs/zprog",
          startLine: 10,
          lineCount: 20,
          connectionId: "dev100"
        }),
        mockToken
      )
      const msgText = (result.confirmationMessages as any).message.text
      expect(msgText).toContain("10")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      mockClient.getObjectSource.mockResolvedValue("line1\nline2\nline3")
      await tool.invoke(
        makeOptions({ uri: "/sap/bc/adt/programs/zprog", connectionId: "dev100" }),
        mockToken
      )
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_object_by_uri_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      mockClient.getObjectSource.mockResolvedValue("line1")
      await tool.invoke(
        makeOptions({ uri: "/sap/bc/adt/programs/zprog", connectionId: "DEV100" }),
        mockToken
      )
      expect(getClient).toHaveBeenCalledWith("dev100")
    })

    it("returns source content on success", async () => {
      const content = Array.from({ length: 100 }, (_, i) => `LINE ${i + 1}`).join("\n")
      mockClient.getObjectSource.mockResolvedValue(content)
      const result: any = await tool.invoke(
        makeOptions({ uri: "/sap/bc/adt/programs/zprog", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("LINE 1")
    })

    it("respects startLine and lineCount", async () => {
      const content = Array.from({ length: 100 }, (_, i) => `LINE ${i + 1}`).join("\n")
      mockClient.getObjectSource.mockResolvedValue(content)
      const result: any = await tool.invoke(
        makeOptions({
          uri: "/sap/bc/adt/programs/zprog",
          connectionId: "dev100",
          startLine: 10,
          lineCount: 5
        }),
        mockToken
      )
      // Lines 10-14 (0-based slice) shown as LINE 11-15, not line 1
      expect(result.parts[0].text).toContain("LINE 11")
      expect(result.parts[0].text).not.toContain("LINE 1\n")
    })

    it("applies defaults: startLine=0, lineCount=50", async () => {
      const content = Array.from({ length: 100 }, (_, i) => `LINE ${i + 1}`).join("\n")
      mockClient.getObjectSource.mockResolvedValue(content)
      const result: any = await tool.invoke(
        makeOptions({ uri: "/sap/bc/adt/programs/zprog", connectionId: "dev100" }),
        mockToken
      )
      // Default 50 lines from start
      expect(result.parts[0].text).toContain("LINE 1")
    })

    it("throws when no connectionId and no active ABAP editor", async () => {
      await expect(
        tool.invoke(makeOptions({ uri: "/sap/bc/adt/programs/zprog" }), mockToken)
      ).rejects.toThrow()
    })

    it("adds /source/main to detected program URIs", async () => {
      mockClient.getObjectSource.mockResolvedValue("content")
      await tool.invoke(
        makeOptions({ uri: "/sap/bc/adt/programs/programs/zprog", connectionId: "dev100" }),
        mockToken
      )
      // getOptimalObjectURI should be called (it's mocked to append /source/main)
      expect(mockClient.getObjectSource).toHaveBeenCalled()
    })

    it("throws when source content is empty", async () => {
      mockClient.getObjectSource.mockResolvedValue("")
      await expect(
        tool.invoke(
          makeOptions({ uri: "/sap/bc/adt/programs/zprog", connectionId: "dev100" }),
          mockToken
        )
      ).rejects.toThrow()
    })

    it("falls back to original URI when optimal URI fails", async () => {
      const { getOptimalObjectURI } = require("./shared")
      getOptimalObjectURI.mockReturnValueOnce("/sap/bc/adt/programs/zprog/source/main")
      mockClient.getObjectSource
        .mockRejectedValueOnce(new Error("optimal URI failed"))
        .mockResolvedValueOnce("fallback content")
      const result: any = await tool.invoke(
        makeOptions({ uri: "/sap/bc/adt/programs/zprog", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("fallback content")
    })
  })
})
