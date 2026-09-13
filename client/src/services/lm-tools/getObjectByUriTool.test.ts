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
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
vi.mock("./shared", () => ({
  getOptimalObjectURI: vi.fn(function (type: string, uri: string) {
    return uri + "/source/main"
  }),
  resolveCorrectURI: vi.fn(function (uri: string) {
    return Promise.resolve(uri)
  })
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { GetObjectByURITool } from "./getObjectByUriTool"
import { getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"
import * as __$mock_shared from "./shared"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockClient = { getObjectSource: vi.fn() }

describe("GetObjectByURITool", () => {
  let tool: GetObjectByURITool

  beforeEach(() => {
    tool = new GetObjectByURITool()
    vi.clearAllMocks()
    ;(getClient as Mock).mockReturnValue(mockClient)
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
      const { getOptimalObjectURI } = __$mock_shared
      vi.mocked(getOptimalObjectURI).mockReturnValueOnce("/sap/bc/adt/programs/zprog/source/main")
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
