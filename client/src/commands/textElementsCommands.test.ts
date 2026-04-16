jest.mock("vscode", () => ({
  ProgressLocation: { Notification: 15 },
  ViewColumn: { One: 1 },
  Uri: {
    file: jest.fn((p: string) => ({ scheme: "file", path: p, toString: () => `file://${p}` }))
  },
  extensions: {
    getExtension: jest.fn()
  }
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    withProgress: jest.fn(),
    createWebviewPanel: jest.fn()
  }
}))

jest.mock("../adt/conections", () => ({
  getClient: jest.fn(),
  getRoot: jest.fn()
}))

jest.mock("../adt/textElements", () => ({
  getTextElementsSafe: jest.fn(),
  updateTextElementsWithTransport: jest.fn(),
  parseObjectName: jest.fn()
}))

jest.mock("../services/abapCopilotLogger", () => ({
  logCommands: { error: jest.fn(), info: jest.fn() }
}))

jest.mock("../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn()
}))

jest.mock("../views/sapgui/SapGuiPanel", () => ({
  SapGuiPanel: {
    createOrShow: jest.fn()
  }
}))

jest.mock("../config", () => ({
  RemoteManager: {
    get: jest.fn()
  }
}))

import { manageTextElementsCommand, openTextElementsInSapGui } from "./textElementsCommands"
import { funWindow as window } from "../services/funMessenger"
import { getClient, getRoot } from "../adt/conections"
import { getTextElementsSafe, parseObjectName } from "../adt/textElements"
import { isAbapFile } from "abapfs"
import { SapGuiPanel } from "../views/sapgui/SapGuiPanel"
import { RemoteManager } from "../config"
import * as vscode from "vscode"

const mockWindow = window as jest.Mocked<typeof window>
const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockGetRoot = getRoot as jest.MockedFunction<typeof getRoot>
const mockGetTextElementsSafe = getTextElementsSafe as jest.MockedFunction<typeof getTextElementsSafe>
const mockIsAbapFile = isAbapFile as jest.MockedFunction<typeof isAbapFile>
const mockParseObjectName = parseObjectName as jest.MockedFunction<typeof parseObjectName>

function makeAdtUri(authority = "dev100", path = "/dev100/Source Code Library/Programs/ZTEST/ZTEST.prog.abap") {
  return {
    scheme: "adt",
    authority,
    path,
    toString: () => `adt://${authority}${path}`
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(mockWindow as any).activeTextEditor = undefined
  ;(mockWindow.withProgress as jest.Mock).mockImplementation((_opts: any, fn: Function) =>
    fn({ report: jest.fn() })
  )
})

describe("manageTextElementsCommand", () => {
  test("shows error when no URI and no active editor", async () => {
    await manageTextElementsCommand(undefined)
    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Please open an ABAP file first")
    )
  })

  test("shows error when URI scheme is not adt", async () => {
    const uri = { scheme: "file", authority: "", path: "/some/file.ts", toString: () => "file:///some/file.ts" } as any
    await manageTextElementsCommand(uri)
    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("only works with ABAP files")
    )
  })

  test("shows error when active editor is not adt scheme", async () => {
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: { scheme: "file", path: "/test.ts" } }
    }
    await manageTextElementsCommand(undefined)
    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Please open an ABAP file first")
    )
  })

  test("processes adt URI from context menu", async () => {
    const uri = makeAdtUri()
    const mockFile = { object: { type: "PROG/P" } }
    mockIsAbapFile.mockReturnValue(true)
    const mockRoot = {
      getNodeAsync: jest.fn().mockResolvedValue(mockFile)
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    mockGetClient.mockReturnValue({ someFn: jest.fn() } as any)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: [], programName: "ZTEST" } as any)
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue({
      webview: { html: "", onDidReceiveMessage: jest.fn() },
      onDidDispose: jest.fn()
    })

    await manageTextElementsCommand(uri)

    expect(mockGetRoot).toHaveBeenCalledWith("dev100")
  })

  test("resolves include to main program", async () => {
    const uri = makeAdtUri("dev100", "/dev100/Source Code Library/Programs/ZTEST/ZTEST.prog.abap")
    const mockIncludeFile = {
      object: {
        type: "PROG/I",
        mainPrograms: jest.fn().mockResolvedValue([{ "adtcore:name": "ZMAINPROG" }])
      }
    }
    mockIsAbapFile.mockReturnValue(true)
    const mockRoot = {
      getNodeAsync: jest.fn().mockResolvedValue(mockIncludeFile)
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    mockGetClient.mockReturnValue({} as any)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: [], programName: "ZMAINPROG" } as any)
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue({
      webview: { html: "", onDidReceiveMessage: jest.fn() },
      onDidDispose: jest.fn()
    })
    // showTextElementsEditor uses activeTextEditor to get connectionId
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: makeAdtUri("dev100") }
    }

    await manageTextElementsCommand(uri)

    expect(mockGetTextElementsSafe).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ZMAINPROG")
    )
  })

  test("shows error when object name cannot be determined", async () => {
    const uri = makeAdtUri("dev100", "/dev100/unknownpath")
    mockIsAbapFile.mockReturnValue(false)
    const mockRoot = {
      getNodeAsync: jest.fn().mockResolvedValue({})
    }
    mockGetRoot.mockReturnValue(mockRoot as any)

    await manageTextElementsCommand(uri)

    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not determine program name")
    )
  })

  test("uses active editor URI when no uri argument", async () => {
    const editorUri = makeAdtUri()
    ;(mockWindow as any).activeTextEditor = { document: { uri: editorUri } }
    const mockFile = { object: { type: "PROG/P" } }
    mockIsAbapFile.mockReturnValue(true)
    const mockRoot = { getNodeAsync: jest.fn().mockResolvedValue(mockFile) }
    mockGetRoot.mockReturnValue(mockRoot as any)
    mockGetClient.mockReturnValue({} as any)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: [], programName: "ZTEST" } as any)
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue({
      webview: { html: "", onDidReceiveMessage: jest.fn() },
      onDidDispose: jest.fn()
    })

    await manageTextElementsCommand(undefined)

    expect(mockGetRoot).toHaveBeenCalledWith("dev100")
  })
})

describe("openTextElementsInSapGui", () => {
  beforeEach(() => {
    mockParseObjectName.mockReturnValue({
      type: "PROGRAM" as any,
      cleanName: "ZTEST",
      name: "ZTEST.prog.abap"
    })
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined)
  })

  test("creates SapGuiPanel for program", async () => {
    mockGetClient.mockReturnValue({} as any)
    const mockPanel = {
      buildWebGuiUrl: jest.fn().mockResolvedValue("http://dev/webgui?DYNP_OKCODE%3dSTRT"),
      loadDirectWebGuiUrl: jest.fn()
    }
    ;(SapGuiPanel.createOrShow as jest.Mock).mockReturnValue(mockPanel)

    await openTextElementsInSapGui("ZTEST.prog.abap", "dev100")

    expect(SapGuiPanel.createOrShow).toHaveBeenCalled()
    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(
      expect.stringContaining("TEXT")
    )
  })

  test("handles CLASS object type for SE24", async () => {
    mockParseObjectName.mockReturnValue({
      type: "CLASS" as any,
      cleanName: "ZCL_TEST",
      name: "ZCL_TEST.clas.abap"
    })
    mockGetClient.mockReturnValue({} as any)
    const mockManager = {
      byId: jest.fn().mockReturnValue({
        url: "https://dev100:8000/sap/bc/adt",
        client: "100",
        language: "EN"
      })
    }
    ;(RemoteManager.get as jest.Mock).mockReturnValue(mockManager)
    const mockPanel = {
      buildWebGuiUrl: jest.fn().mockResolvedValue("http://dev/webgui"),
      loadDirectWebGuiUrl: jest.fn()
    }
    ;(SapGuiPanel.createOrShow as jest.Mock).mockReturnValue(mockPanel)

    await openTextElementsInSapGui("ZCL_TEST.clas.abap", "dev100")

    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(
      expect.stringContaining("SE24")
    )
  })

  test("handles FUNCTION_GROUP object type for SE37 with TEXT okcode", async () => {
    mockParseObjectName.mockReturnValue({
      type: "FUNCTION_GROUP" as any,
      cleanName: "ZFG_TEST",
      name: "ZFG_TEST.fugr.abap"
    })
    mockGetClient.mockReturnValue({} as any)
    const mockPanel = {
      buildWebGuiUrl: jest.fn().mockResolvedValue("http://dev/webgui?DYNP_OKCODE%3dWB_EXEC"),
      loadDirectWebGuiUrl: jest.fn()
    }
    ;(SapGuiPanel.createOrShow as jest.Mock).mockReturnValue(mockPanel)

    await openTextElementsInSapGui("ZFG_TEST.fugr.abap", "dev100")

    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(
      expect.stringContaining("TEXT")
    )
    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(
      expect.not.stringContaining("WB_EXEC")
    )
  })

  test("throws error when panel buildWebGuiUrl fails", async () => {
    mockGetClient.mockReturnValue({} as any)
    const mockPanel = {
      buildWebGuiUrl: jest.fn().mockRejectedValue(new Error("Connection failed")),
      loadDirectWebGuiUrl: jest.fn()
    }
    ;(SapGuiPanel.createOrShow as jest.Mock).mockReturnValue(mockPanel)

    await expect(openTextElementsInSapGui("ZTEST.prog.abap", "dev100")).rejects.toThrow(
      "Connection failed"
    )
  })
})
