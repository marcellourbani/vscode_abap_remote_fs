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
    webGuiUrl: vi.fn(),
    getTransactionInfo: vi.fn()
  }
}))
vi.mock("../../config", () => ({
  formatKey: (id: string) => id.toLowerCase(),
  RemoteManager: {
    get: vi.fn(function () {
      return {
        byIdAsync: vi.fn()
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

import { GetAbapObjectUrlTool } from "./getObjectUrlTool"
import { RemoteManager } from "../../config"
import { SapGuiPanel } from "../../views/sapgui/SapGuiPanel"
import { logTelemetry } from "../telemetry"
import { getClient, getOrCreateRoot } from "../../adt/conections"
import { funWindow as window } from "../funMessenger"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("GetAbapObjectUrlTool", () => {
  let tool: GetAbapObjectUrlTool
  let byIdAsync: Mock
  const mockConfig = {
    url: "https://sap.example.com",
    username: "user",
    client: "100",
    language: "EN",
    authMethod: "browser_sso"
  }

  beforeEach(() => {
    tool = new GetAbapObjectUrlTool()
    vi.clearAllMocks()
    byIdAsync = vi.fn().mockResolvedValue(mockConfig)
    ;(RemoteManager.get as Mock).mockReturnValue({ byIdAsync })
    ;(SapGuiPanel.getTransactionInfo as Mock).mockReturnValue({ transaction: "SE38" })
    ;(SapGuiPanel.webGuiUrl as Mock).mockReturnValue(
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
      expect(byIdAsync).toHaveBeenCalledWith("dev100")
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

    it("builds the URL from the connection settings without opening a panel", async () => {
      await tool.invoke(
        makeOptions({ objectName: "ZCLASS", objectType: "CLAS/OC", connectionId: "dev100" }),
        mockToken
      )
      expect(SapGuiPanel.webGuiUrl).toHaveBeenCalledWith(mockConfig, "ZCLASS", "CLAS/OC")
      expect(SapGuiPanel.createOrShow).not.toHaveBeenCalled()
    })

    it("throws when connection config not found", async () => {
      byIdAsync.mockResolvedValue(undefined)
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
      expect(byIdAsync).toHaveBeenCalledWith("dev100")
    })

    it("returns the plain WebGUI URL without logging in to SAP", async () => {
      const result: any = await tool.invoke(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )

      expect(result.parts[0].text).toContain(
        "URL: https://sap.example.com/sap/bc/gui/sap/its/webgui?~transaction=SE38"
      )
      expect(result.parts[0].text).toContain("Ask user to login")
      expect(getClient).not.toHaveBeenCalled()
      expect(getOrCreateRoot).not.toHaveBeenCalled()
    })
  })
})
