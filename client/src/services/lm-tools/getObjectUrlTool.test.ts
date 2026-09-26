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
  },
  Uri: {
    file: vi.fn(function (p: string) {
      return { fsPath: p }
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  getOrCreateRoot: vi.fn()
}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../../views/sapgui/SapGuiPanel", () => ({
  SapGuiPanel: {
    createOrShow: vi.fn(),
    getTransactionInfo: vi.fn()
  }
}))
vi.mock("../../config", () => ({
  RemoteManager: {
    get: vi.fn(function () {
      return {
        byId: vi.fn()
      }
    })
  }
}))
vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
vi.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
vi.mock("abap-adt-api", () => ({
  ADTClient: vi.fn(class {})
}))

import { GetAbapObjectUrlTool } from "./getObjectUrlTool"
import { RemoteManager } from "../../config"
import { SapGuiPanel } from "../../views/sapgui/SapGuiPanel"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockPanel = {
  buildWebGuiUrl: vi.fn(),
  dispose: vi.fn()
}

describe("GetAbapObjectUrlTool", () => {
  let tool: GetAbapObjectUrlTool
  const mockConfig = {
    url: "https://sap.example.com",
    username: "user",
    password: "pass",
    client: "100",
    language: "EN"
  }

  beforeEach(() => {
    tool = new GetAbapObjectUrlTool()
    vi.clearAllMocks()
    ;(RemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue(mockConfig)
    })
    ;(SapGuiPanel.createOrShow as Mock).mockReturnValue(mockPanel)
    ;(SapGuiPanel.getTransactionInfo as Mock).mockReturnValue({ transaction: "SE38" })
    mockPanel.buildWebGuiUrl.mockResolvedValue(
      "https://sap.example.com/sap/bc/gui/sap/its/webgui?~transaction=SE38"
    )
    ;(window as any).activeTextEditor = undefined
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with object name", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("ZPROG")
    })

    it("uses default type PROG/P in message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("PROG/P")
    })

    it("uses provided objectType in message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("CLAS/OC")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "dev100" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_abap_object_url_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "DEV100" }), mockToken)
      expect(RemoteManager.get().byId).toHaveBeenCalledWith("dev100")
    })

    it("returns URL in result text", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("https://sap.example.com")
      expect(result.parts[0].text).toContain("Successfully")
    })

    it("includes object name and type in result", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", objectType: "PROG/P", connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ZPROG")
      expect(result.parts[0].text).toContain("PROG/P")
    })

    it("disposes panel after URL is built", async () => {
      await tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "dev100" }), mockToken)
      expect(mockPanel.dispose).toHaveBeenCalled()
    })

    it("throws when connection config not found", async () => {
      ;(RemoteManager.get as Mock).mockReturnValue({
        byId: vi.fn().mockReturnValue(undefined)
      })
      await expect(
        tool.invoke(makeOptions({ objectName: "ZPROG", connectionId: "dev100" }), mockToken)
      ).rejects.toThrow("Connection configuration not found")
    })

    it("throws when no connectionId and no active editor", async () => {
      ;(window as any).activeTextEditor = undefined
      await expect(tool.invoke(makeOptions({ objectName: "ZPROG" }), mockToken)).rejects.toThrow(
        "No connection ID provided"
      )
    })

    it("uses active editor authority when no connectionId", async () => {
      ;(window as any).activeTextEditor = {
        document: { uri: { scheme: "adt", authority: "dev100" } }
      }
      await tool.invoke(makeOptions({ objectName: "ZPROG" }), mockToken)
      expect(RemoteManager.get().byId).toHaveBeenCalledWith("dev100")
    })
  })
})
