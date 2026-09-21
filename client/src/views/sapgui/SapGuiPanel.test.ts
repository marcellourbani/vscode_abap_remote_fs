/**
 * Tests for views/sapgui/SapGuiPanel.ts
 * Primarily tests the public static getTransactionInfo method and createOrShow.
 */

vi.mock("vscode", () => ({
  ViewColumn: { One: 1, Beside: 2, Active: -1 },
  Uri: {
    parse: vi.fn(function (s: string) {
      return { toString: () => s, fsPath: s }
    }),
    file: vi.fn(function (p: string) {
      return { fsPath: p, toString: () => `file://${p}` }
    })
  },
  workspace: {
    getConfiguration: vi.fn(function () {
      return {
        get: vi.fn(() => false) // useIntegratedBrowser = false by default
      }
    }),
    fs: { writeFile: vi.fn() }
  },
  commands: { executeCommand: vi.fn() }
}))

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createWebviewPanel: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn()
  }
}))

vi.mock("../../lib", () => ({
  log: vi.fn()
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

vi.mock("../../adt/sapgui/sapgui", () => ({
  runInSapGui: vi.fn(),
  // Pass-through: these tests assert on the URL the panel opens, not on auto-login.
  withAutoLogin: vi.fn(function (_connId: string, url: string) {
    return url
  })
}))

import { SapGuiPanel } from "./SapGuiPanel"
import { funWindow as window } from "../../services/funMessenger"
import { RemoteManager } from "../../config"
import * as __$mock_vscode from "vscode"
import type { Mocked, Mock } from "vitest"

const mockedWindow = window as Mocked<typeof window>
const mockedRemoteManager = RemoteManager as Mocked<typeof RemoteManager>

function makePanelMock() {
  const panel = {
    webview: {
      html: "",
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(function (cb: any) {
        cb({ command: "nonexistent" })
        return { dispose: vi.fn() }
      }),
      asWebviewUri: vi.fn(function (uri: any) {
        return uri
      }),
      cspSource: "vscode-webview:"
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(function (cb: any) {
      return { dispose: vi.fn() }
    }),
    onDidChangeViewState: vi.fn(function (cb: any) {
      return { dispose: vi.fn() }
    }),
    visible: true,
    viewColumn: 1
  }
  return panel
}

describe("SapGuiPanel.getTransactionInfo", () => {
  it("returns SE38 for PROG/P", () => {
    const info = SapGuiPanel.getTransactionInfo("PROG/P", "ZPROG")
    expect(info.transaction).toBe("SE38")
    expect(info.dynprofield).toBe("RS38M-PROGRAMM")
    expect(info.okcode).toBe("STRT")
    expect(info.sapGuiCommand.parameters[0].value).toBe("ZPROG")
  })

  it("returns SE37 for FUGR/FF", () => {
    const info = SapGuiPanel.getTransactionInfo("FUGR/FF", "Z_MY_FM")
    expect(info.transaction).toBe("SE37")
    expect(info.dynprofield).toBe("RS38L-NAME")
    expect(info.okcode).toBe("WB_EXEC")
    expect(info.sapGuiCommand.parameters[0].value).toBe("Z_MY_FM")
  })

  it("returns SE37 for FUNC/FM", () => {
    const info = SapGuiPanel.getTransactionInfo("FUNC/FM", "Z_FUNC")
    expect(info.transaction).toBe("SE37")
    expect(info.dynprofield).toBe("RS38L-NAME")
  })

  it("returns SE24 for CLAS/OC", () => {
    const info = SapGuiPanel.getTransactionInfo("CLAS/OC", "ZCL_DEMO")
    expect(info.transaction).toBe("SE24")
    expect(info.dynprofield).toBe("SEOCLASS-CLSNAME")
    expect(info.okcode).toBe("WB_EXEC")
    expect(info.sapGuiCommand.parameters[0].value).toBe("ZCL_DEMO")
  })

  it("strips .main suffix from class name", () => {
    const info = SapGuiPanel.getTransactionInfo("CLAS/OC", "ZCL_DEMO_ABAP.main")
    expect(info.sapGuiCommand.parameters[0].value).toBe("ZCL_DEMO_ABAP")
  })

  it("strips .inc suffix from class include", () => {
    const info = SapGuiPanel.getTransactionInfo("CLAS/I", "ZCL_DEMO.testclasses")
    expect(info.sapGuiCommand.parameters[0].value).toBe("ZCL_DEMO")
  })

  it("returns SE24 for CLAS/I", () => {
    const info = SapGuiPanel.getTransactionInfo("CLAS/I", "ZCL_TEST.main")
    expect(info.transaction).toBe("SE24")
  })

  it("defaults to SE38 for unknown type", () => {
    const info = SapGuiPanel.getTransactionInfo("UNKN/XX", "ZOBJ")
    expect(info.transaction).toBe("SE38")
    expect(info.dynprofield).toBe("RS38M-PROGRAMM")
    expect(info.okcode).toBe("STRT")
  })

  it("sapGuiCommand type is always 'Transaction'", () => {
    const info = SapGuiPanel.getTransactionInfo("PROG/P", "ZPROG")
    expect(info.sapGuiCommand.type).toBe("Transaction")
  })

  it("sapGuiCommand includes DYNP_OKCODE parameter", () => {
    const info = SapGuiPanel.getTransactionInfo("PROG/P", "ZPROG")
    const okcodeParam = info.sapGuiCommand.parameters.find((p: any) => p.name === "DYNP_OKCODE")
    expect(okcodeParam).toBeDefined()
    expect(okcodeParam.value).toBe("STRT")
  })

  it("sapGuiCommand command is prefixed with *", () => {
    const info = SapGuiPanel.getTransactionInfo("PROG/P", "ZPROG")
    expect(info.sapGuiCommand.command).toBe("*SE38")
  })

  it("handles empty object name gracefully", () => {
    const info = SapGuiPanel.getTransactionInfo("PROG/P", "")
    expect(info.transaction).toBe("SE38")
    expect(info.sapGuiCommand.parameters[0].value).toBe("")
  })
})

describe("SapGuiPanel.createOrShow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset internal panels map
    ;(SapGuiPanel as any).currentPanels = new Map()
  })

  it("creates new panel for new object", () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    const { Uri } = __$mock_vscode
    const client = { username: "USER1" } as any
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      client,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    expect(mockedWindow.createWebviewPanel).toHaveBeenCalledWith(
      "ABAPSapGui",
      "SAP GUI - ZPROG",
      expect.anything(),
      expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true })
    )
    expect(instance).toBeDefined()
  })

  it("reveals existing panel for same object", () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    const { Uri } = __$mock_vscode
    const client = { username: "USER1" } as any
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG", "PROG/P")
    ;(mockedWindow.createWebviewPanel as Mock).mockClear()
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG", "PROG/P")
    // Should NOT create a new panel, should reveal the existing one
    expect(mockedWindow.createWebviewPanel).not.toHaveBeenCalled()
    expect(mockPanel.reveal).toHaveBeenCalled()
  })

  it("creates separate panels for different objects", () => {
    ;(mockedWindow.createWebviewPanel as Mock)
      .mockReturnValueOnce(makePanelMock())
      .mockReturnValueOnce(makePanelMock())
    const { Uri } = __$mock_vscode
    const client = { username: "USER1" } as any
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG1", "PROG/P")
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG2", "PROG/P")
    expect(mockedWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
  })
})

describe("SapGuiPanel.buildWebGuiUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(SapGuiPanel as any).currentPanels = new Map()
  })

  it("generates correct WebGUI URL for PROG/P", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue({
        url: "https://myserver:8443/sap/bc/adt",
        client: "100",
        language: "DE"
      })
    })

    const { Uri } = __$mock_vscode
    const client = {} as any
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      client,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    const url = await instance!.buildWebGuiUrl()

    expect(url).toContain("webgui")
    expect(url).toContain("SE38")
    expect(url).toContain("ZPROG")
    expect(url).toContain("sap-client=100")
    expect(url).toContain("sap-language=DE")
    expect(url).toContain("saml2=disabled")
    expect(url.startsWith("https://")).toBe(true)
  })

  it("defaults language to EN if not set", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue({
        url: "https://myserver/sap/bc/adt",
        client: "001",
        language: ""
      })
    })

    const { Uri } = __$mock_vscode
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      {} as any,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    const url = await instance!.buildWebGuiUrl()
    expect(url).toContain("sap-language=EN")
  })

  it("preserves http scheme from configured URL (issue #446)", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue({
        url: "http://myserver/sap/bc/adt",
        client: "001",
        language: "EN"
      })
    })

    const { Uri } = __$mock_vscode
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      {} as any,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    const url = await instance!.buildWebGuiUrl()
    expect(url.startsWith("http://")).toBe(true)
    expect(url.startsWith("https://")).toBe(false)
  })

  it("defaults to https when configured URL has no scheme", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue({
        url: "myserver/sap/bc/adt",
        client: "001",
        language: "EN"
      })
    })

    const { Uri } = __$mock_vscode
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      {} as any,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    const url = await instance!.buildWebGuiUrl()
    expect(url.startsWith("https://")).toBe(true)
  })

  it("throws if connection config not found", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as Mock).mockReturnValue({
      byId: vi.fn().mockReturnValue(null)
    })

    const { Uri } = __$mock_vscode
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      {} as any,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    await expect(instance!.buildWebGuiUrl()).rejects.toThrow("Connection configuration not found")
  })
})

describe("SapGuiPanel sanitizeUrl (via loadDirectWebGuiUrl)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(SapGuiPanel as any).currentPanels = new Map()
  })

  it("loads direct WebGUI URL without error for valid https URL", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as Mock).mockReturnValue(mockPanel)
    const { Uri } = __$mock_vscode
    const instance = SapGuiPanel.createOrShow(
      Uri.parse("/ext"),
      {} as any,
      "dev100",
      "ZPROG",
      "PROG/P"
    )
    await expect(
      instance!.loadDirectWebGuiUrl("https://myserver/sap/bc/gui/sap/its/webgui?param=1")
    ).resolves.not.toThrow()
  })
})
