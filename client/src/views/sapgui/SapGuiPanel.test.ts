/**
 * Tests for views/sapgui/SapGuiPanel.ts
 * Primarily tests the public static getTransactionInfo method and createOrShow.
 */

jest.mock("vscode", () => ({
  ViewColumn: { One: 1, Beside: 2, Active: -1 },
  Uri: {
    parse: jest.fn((s: string) => ({ toString: () => s, fsPath: s })),
    file: jest.fn((p: string) => ({ fsPath: p, toString: () => `file://${p}` })),
  },
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn(() => false), // useIntegratedBrowser = false by default
    })),
    fs: { writeFile: jest.fn() },
  },
  commands: { executeCommand: jest.fn() },
}), { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createWebviewPanel: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
  },
}), { virtual: true })

jest.mock("../../lib", () => ({
  log: jest.fn(),
}), { virtual: true })

jest.mock("../../config", () => ({
  RemoteManager: {
    get: jest.fn(() => ({
      byId: jest.fn(),
    })),
  },
}), { virtual: true })

jest.mock("../../adt/sapgui/sapgui", () => ({
  runInSapGui: jest.fn(),
}), { virtual: true })

import { SapGuiPanel } from "./SapGuiPanel"
import { funWindow as window } from "../../services/funMessenger"
import { RemoteManager } from "../../config"

const mockedWindow = window as jest.Mocked<typeof window>
const mockedRemoteManager = RemoteManager as jest.Mocked<typeof RemoteManager>

function makePanelMock() {
  const panel = {
    webview: {
      html: "",
      postMessage: jest.fn(),
      onDidReceiveMessage: jest.fn((cb: any) => { cb({ command: "nonexistent" }); return { dispose: jest.fn() } }),
      asWebviewUri: jest.fn((uri: any) => uri),
      cspSource: "vscode-webview:",
    },
    reveal: jest.fn(),
    dispose: jest.fn(),
    onDidDispose: jest.fn((cb: any) => { return { dispose: jest.fn() } }),
    onDidChangeViewState: jest.fn((cb: any) => { return { dispose: jest.fn() } }),
    visible: true,
    viewColumn: 1,
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
    jest.clearAllMocks()
    // Reset internal panels map
    ;(SapGuiPanel as any).currentPanels = new Map()
  })

  it("creates new panel for new object", () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    const { Uri } = require("vscode")
    const client = { username: "USER1" } as any
    const instance = SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG", "PROG/P")
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
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    const { Uri } = require("vscode")
    const client = { username: "USER1" } as any
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG", "PROG/P")
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockClear()
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG", "PROG/P")
    // Should NOT create a new panel, should reveal the existing one
    expect(mockedWindow.createWebviewPanel).not.toHaveBeenCalled()
    expect(mockPanel.reveal).toHaveBeenCalled()
  })

  it("creates separate panels for different objects", () => {
    ;(mockedWindow.createWebviewPanel as jest.Mock)
      .mockReturnValueOnce(makePanelMock())
      .mockReturnValueOnce(makePanelMock())
    const { Uri } = require("vscode")
    const client = { username: "USER1" } as any
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG1", "PROG/P")
    SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG2", "PROG/P")
    expect(mockedWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
  })
})

describe("SapGuiPanel.buildWebGuiUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(SapGuiPanel as any).currentPanels = new Map()
  })

  it("generates correct WebGUI URL for PROG/P", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as jest.Mock).mockReturnValue({
      byId: jest.fn().mockReturnValue({
        url: "https://myserver:8443/sap/bc/adt",
        client: "100",
        language: "DE",
      }),
    })

    const { Uri } = require("vscode")
    const client = {} as any
    const instance = SapGuiPanel.createOrShow(Uri.parse("/ext"), client, "dev100", "ZPROG", "PROG/P")
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
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as jest.Mock).mockReturnValue({
      byId: jest.fn().mockReturnValue({
        url: "https://myserver/sap/bc/adt",
        client: "001",
        language: "",
      }),
    })

    const { Uri } = require("vscode")
    const instance = SapGuiPanel.createOrShow(Uri.parse("/ext"), {} as any, "dev100", "ZPROG", "PROG/P")
    const url = await instance!.buildWebGuiUrl()
    expect(url).toContain("sap-language=EN")
  })

  it("upgrades http to https", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as jest.Mock).mockReturnValue({
      byId: jest.fn().mockReturnValue({
        url: "http://myserver/sap/bc/adt",
        client: "001",
        language: "EN",
      }),
    })

    const { Uri } = require("vscode")
    const instance = SapGuiPanel.createOrShow(Uri.parse("/ext"), {} as any, "dev100", "ZPROG", "PROG/P")
    const url = await instance!.buildWebGuiUrl()
    expect(url.startsWith("https://")).toBe(true)
  })

  it("throws if connection config not found", async () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    ;(mockedRemoteManager.get as jest.Mock).mockReturnValue({
      byId: jest.fn().mockReturnValue(null),
    })

    const { Uri } = require("vscode")
    const instance = SapGuiPanel.createOrShow(Uri.parse("/ext"), {} as any, "dev100", "ZPROG", "PROG/P")
    await expect(instance!.buildWebGuiUrl()).rejects.toThrow("Connection configuration not found")
  })
})

describe("SapGuiPanel sanitizeUrl (via loadDirectWebGuiUrl)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(SapGuiPanel as any).currentPanels = new Map()
  })

  it("loads direct WebGUI URL without error for valid https URL", () => {
    const mockPanel = makePanelMock()
    ;(mockedWindow.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel)
    const { Uri } = require("vscode")
    const instance = SapGuiPanel.createOrShow(Uri.parse("/ext"), {} as any, "dev100", "ZPROG", "PROG/P")
    expect(() => instance!.loadDirectWebGuiUrl("https://myserver/sap/bc/gui/sap/its/webgui?param=1")).not.toThrow()
  })
})
