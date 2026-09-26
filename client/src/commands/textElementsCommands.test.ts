vi.mock("vscode", () => ({
  ProgressLocation: { Notification: 15 },
  ViewColumn: { One: 1 },
  Uri: {
    file: vi.fn(function (p: string) {
      return { scheme: "file", path: p, toString: () => `file://${p}` }
    })
  },
  extensions: {
    getExtension: vi.fn()
  }
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
    createWebviewPanel: vi.fn()
  }
}))

vi.mock("../adt/conections", () => ({
  getClient: vi.fn(),
  getRoot: vi.fn()
}))

vi.mock("../adt/textElements", () => ({
  getTextElementsSafe: vi.fn(),
  updateTextElementsWithTransport: vi.fn(),
  parseObjectName: vi.fn()
}))

vi.mock("../services/abapCopilotLogger", () => ({
  logCommands: { error: vi.fn(), info: vi.fn() }
}))

vi.mock("../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn()
}))

vi.mock("../views/sapgui/SapGuiPanel", () => ({
  SapGuiPanel: {
    createOrShow: vi.fn()
  }
}))

vi.mock("../config", () => ({
  RemoteManager: {
    get: vi.fn()
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
import type { Mocked, MockedFunction, Mock } from "vitest"

const mockWindow = window as Mocked<typeof window>
const mockGetClient = getClient as MockedFunction<typeof getClient>
const mockGetRoot = getRoot as MockedFunction<typeof getRoot>
const mockGetTextElementsSafe = getTextElementsSafe as MockedFunction<typeof getTextElementsSafe>
const mockIsAbapFile = isAbapFile as MockedFunction<typeof isAbapFile>
const mockParseObjectName = parseObjectName as MockedFunction<typeof parseObjectName>

function makeAdtUri(
  authority = "dev100",
  path = "/dev100/Source Code Library/Programs/ZTEST/ZTEST.prog.abap"
) {
  return {
    scheme: "adt",
    authority,
    path,
    toString: () => `adt://${authority}${path}`
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(mockWindow as any).activeTextEditor = undefined
  ;(mockWindow.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
    return fn({ report: vi.fn() })
  })
})

describe("manageTextElementsCommand", () => {
  test("shows error when no URI and no active editor", async () => {
    await manageTextElementsCommand(undefined)
    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Please open an ABAP file first")
    )
  })

  test("shows error when URI scheme is not adt", async () => {
    const uri = {
      scheme: "file",
      authority: "",
      path: "/some/file.ts",
      toString: () => "file:///some/file.ts"
    } as any
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
      getNodeAsync: vi.fn().mockResolvedValue(mockFile)
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    mockGetClient.mockReturnValue({ someFn: vi.fn() } as any)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: [], programName: "ZTEST" } as any)
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue({
      webview: { html: "", onDidReceiveMessage: vi.fn() },
      onDidDispose: vi.fn()
    })

    await manageTextElementsCommand(uri)

    expect(mockGetRoot).toHaveBeenCalledWith("dev100")
  })

  test("resolves include to main program", async () => {
    const uri = makeAdtUri("dev100", "/dev100/Source Code Library/Programs/ZTEST/ZTEST.prog.abap")
    const mockIncludeFile = {
      object: {
        type: "PROG/I",
        mainPrograms: vi.fn().mockResolvedValue([{ "adtcore:name": "ZMAINPROG" }])
      }
    }
    mockIsAbapFile.mockReturnValue(true)
    const mockRoot = {
      getNodeAsync: vi.fn().mockResolvedValue(mockIncludeFile)
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    mockGetClient.mockReturnValue({} as any)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: [], programName: "ZMAINPROG" } as any)
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue({
      webview: { html: "", onDidReceiveMessage: vi.fn() },
      onDidDispose: vi.fn()
    })
    // showTextElementsEditor uses activeTextEditor to get connectionId
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: makeAdtUri("dev100") }
    }

    await manageTextElementsCommand(uri)

    expect(mockGetTextElementsSafe).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ZMAINPROG"),
      undefined,
      "symbols"
    )
    expect(mockGetTextElementsSafe).toHaveBeenCalledTimes(3)
    expect(mockGetTextElementsSafe.mock.calls.map(call => call[3])).toEqual([
      "symbols",
      "selections",
      "headings"
    ])
  })

  test("shows error when object name cannot be determined", async () => {
    const uri = makeAdtUri("dev100", "/dev100/unknownpath")
    mockIsAbapFile.mockReturnValue(false)
    const mockRoot = {
      getNodeAsync: vi.fn().mockResolvedValue({})
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
    const mockRoot = { getNodeAsync: vi.fn().mockResolvedValue(mockFile) }
    mockGetRoot.mockReturnValue(mockRoot as any)
    mockGetClient.mockReturnValue({} as any)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: [], programName: "ZTEST" } as any)
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue({
      webview: { html: "", onDidReceiveMessage: vi.fn() },
      onDidDispose: vi.fn()
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
    ;(vscode.extensions.getExtension as Mock).mockReturnValue(undefined)
  })

  test("creates SapGuiPanel for program", async () => {
    mockGetClient.mockReturnValue({} as any)
    const mockPanel = {
      buildWebGuiUrl: vi.fn().mockResolvedValue("http://dev/webgui?DYNP_OKCODE%3dSTRT"),
      loadDirectWebGuiUrl: vi.fn()
    }
    ;(SapGuiPanel.createOrShow as Mock).mockReturnValue(mockPanel)

    await openTextElementsInSapGui("ZTEST.prog.abap", "dev100")

    expect(SapGuiPanel.createOrShow).toHaveBeenCalled()
    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(expect.stringContaining("TEXT"))
  })

  test("handles CLASS object type for SE24", async () => {
    mockParseObjectName.mockReturnValue({
      type: "CLASS" as any,
      cleanName: "ZCL_TEST",
      name: "ZCL_TEST.clas.abap"
    })
    mockGetClient.mockReturnValue({} as any)
    const mockManager = {
      byId: vi.fn().mockReturnValue({
        url: "https://dev100:8000/sap/bc/adt",
        client: "100",
        language: "EN"
      })
    }
    ;(RemoteManager.get as Mock).mockReturnValue(mockManager)
    const mockPanel = {
      buildWebGuiUrl: vi.fn().mockResolvedValue("http://dev/webgui"),
      loadDirectWebGuiUrl: vi.fn()
    }
    ;(SapGuiPanel.createOrShow as Mock).mockReturnValue(mockPanel)

    await openTextElementsInSapGui("ZCL_TEST.clas.abap", "dev100")

    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(expect.stringContaining("SE24"))
  })

  test("handles FUNCTION_GROUP object type for SE37 with TEXT okcode", async () => {
    mockParseObjectName.mockReturnValue({
      type: "FUNCTION_GROUP" as any,
      cleanName: "ZFG_TEST",
      name: "ZFG_TEST.fugr.abap"
    })
    mockGetClient.mockReturnValue({} as any)
    const mockPanel = {
      buildWebGuiUrl: vi.fn().mockResolvedValue("http://dev/webgui?DYNP_OKCODE%3dWB_EXEC"),
      loadDirectWebGuiUrl: vi.fn()
    }
    ;(SapGuiPanel.createOrShow as Mock).mockReturnValue(mockPanel)

    await openTextElementsInSapGui("ZFG_TEST.fugr.abap", "dev100")

    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(expect.stringContaining("TEXT"))
    expect(mockPanel.loadDirectWebGuiUrl).toHaveBeenCalledWith(
      expect.not.stringContaining("WB_EXEC")
    )
  })

  test("throws error when panel buildWebGuiUrl fails", async () => {
    mockGetClient.mockReturnValue({} as any)
    const mockPanel = {
      buildWebGuiUrl: vi.fn().mockRejectedValue(new Error("Connection failed")),
      loadDirectWebGuiUrl: vi.fn()
    }
    ;(SapGuiPanel.createOrShow as Mock).mockReturnValue(mockPanel)

    await expect(openTextElementsInSapGui("ZTEST.prog.abap", "dev100")).rejects.toThrow(
      "Connection failed"
    )
  })
})
