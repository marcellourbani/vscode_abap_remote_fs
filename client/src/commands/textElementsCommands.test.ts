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
import {
  getTextElementsSafe,
  parseObjectName,
  updateTextElementsWithTransport
} from "../adt/textElements"
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

describe("text elements webview save", () => {
  const programName = "ZTEST.prog.abap"

  async function openWebview(loaded: any[] = []) {
    const editorUri = makeAdtUri()
    ;(mockWindow as any).activeTextEditor = { document: { uri: editorUri } }
    mockIsAbapFile.mockReturnValue(true)
    mockGetRoot.mockReturnValue({
      getNodeAsync: vi.fn().mockResolvedValue({ object: { type: "PROG/P", name: "ZTEST" } })
    } as any)
    const client: any = { stateful: undefined }
    mockGetClient.mockReturnValue(client)
    mockGetTextElementsSafe.mockResolvedValue({ textElements: loaded, programName: "ZTEST" } as any)

    let handler: (message: any) => Promise<void> = async () => undefined
    const panel = {
      webview: {
        html: "",
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(function (fn: any) {
          handler = fn
        })
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn()
    }
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)

    await manageTextElementsCommand(undefined)
    return { panel, client, send: (message: any) => handler(message) }
  }

  test("embeds blank-text elements loaded from SAP in the webview", async () => {
    const { panel } = await openWebview([{ id: "001", text: "" }])

    expect(panel.webview.html).toContain('"id":"001"')
    expect(panel.webview.html).toContain('"text":""')
  })

  test("saves blank-text elements so existing rows are not deleted", async () => {
    const { send, panel } = await openWebview()

    await send({
      command: "save",
      category: "symbols",
      textElements: [
        { id: "001", text: "" },
        { id: "002", text: "Keep" }
      ]
    })

    expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
      expect.anything(),
      programName,
      [
        { id: "001", text: "" },
        { id: "002", text: "Keep" }
      ],
      undefined,
      "symbols"
    )
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ command: "saveSuccess" })
  })

  test("drops rows without an ID or without a text string", async () => {
    const { send } = await openWebview()

    await send({
      command: "save",
      category: "selections",
      textElements: [{ id: "", text: "No id" }, { id: "P_NAME" }, { id: "P_DATE", text: "Date" }]
    })

    expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
      expect.anything(),
      programName,
      [{ id: "P_DATE", text: "Date" }],
      undefined,
      "selections"
    )
  })

  test("defaults the category to symbols", async () => {
    const { send } = await openWebview()

    await send({ command: "save", textElements: [{ id: "001", text: "A" }] })

    expect(updateTextElementsWithTransport).toHaveBeenCalledWith(
      expect.anything(),
      programName,
      [{ id: "001", text: "A" }],
      undefined,
      "symbols"
    )
  })

  test("uses a stateful client for the save", async () => {
    const { send, client } = await openWebview()

    await send({ command: "save", textElements: [{ id: "001", text: "A" }] })

    expect(client.stateful).toBe("stateful")
  })

  test("posts saveError when the write fails", async () => {
    const { send, panel } = await openWebview()
    ;(updateTextElementsWithTransport as Mock).mockRejectedValueOnce(new Error("Lock failed"))

    await send({ command: "save", textElements: [{ id: "001", text: "A" }] })

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      command: "saveError",
      error: expect.stringContaining("Lock failed")
    })
  })
})

describe("text elements webview script validation", () => {
  // Runs the real inline webview script against minimal DOM stubs
  async function loadScript(loaded: any[]) {
    ;(mockWindow as any).activeTextEditor = { document: { uri: makeAdtUri() } }
    mockIsAbapFile.mockReturnValue(true)
    mockGetRoot.mockReturnValue({
      getNodeAsync: vi.fn().mockResolvedValue({ object: { type: "PROG/P" } })
    } as any)
    mockGetClient.mockReturnValue({} as any)
    mockGetTextElementsSafe.mockImplementation(async (_c, _n, _t, category) => ({
      programName: "ZTEST",
      textElements: category === "symbols" ? loaded : []
    }))
    const panel = {
      webview: { html: "", postMessage: vi.fn(), onDidReceiveMessage: vi.fn() },
      onDidDispose: vi.fn(),
      reveal: vi.fn()
    }
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)
    await manageTextElementsCommand(undefined)

    const script = panel.webview.html.split("<script>")[1].split("</script>")[0]
    const stub = (): any => ({
      hidden: false,
      textContent: "",
      innerHTML: "",
      className: "",
      dataset: {},
      style: {},
      classList: { toggle: vi.fn() },
      addEventListener: vi.fn(),
      querySelector: () => null,
      querySelectorAll: () => [],
      focus: vi.fn()
    })
    const elements: Record<string, any> = {}
    const document = {
      getElementById: (id: string) => (elements[id] ??= stub()),
      querySelectorAll: () => Array.from({ length: 20 }, stub),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    const posted: any[] = []
    let onMessage: (event: any) => void = () => undefined
    const fakeWindow = {
      addEventListener: (_type: string, fn: any) => {
        onMessage = fn
      }
    }
    const api = new Function(
      "acquireVsCodeApi",
      "document",
      "window",
      "setTimeout",
      `${script}\nreturn { saveTextElements, updateElement, addRow, deleteRow };`
    )(() => ({ postMessage: (m: any) => posted.push(m) }), document, fakeWindow, vi.fn())

    return {
      api,
      posted,
      status: () => elements["status"]?.textContent ?? "",
      receive: (data: any) => onMessage({ data })
    }
  }

  test("saves rows that were already blank in SAP", async () => {
    const { api, posted } = await loadScript([
      { id: "001", text: "" },
      { id: "002", text: "Keep" }
    ])

    api.saveTextElements()

    expect(posted).toEqual([
      {
        command: "save",
        category: "symbols",
        textElements: [
          { id: "001", text: "" },
          { id: "002", text: "Keep" }
        ]
      }
    ])
  })

  test("still requires text on new rows", async () => {
    const { api, posted, status } = await loadScript([{ id: "001", text: "A" }])

    api.addRow()
    api.saveTextElements()

    expect(posted).toEqual([])
    expect(status()).toContain("Row 2: Text is required")
  })

  test("still requires text when an existing row is cleared", async () => {
    const { api, posted, status } = await loadScript([{ id: "001", text: "A" }])

    api.updateElement(0, "text", "")
    api.saveTextElements()

    expect(posted).toEqual([])
    expect(status()).toContain("Row 1: Text is required")
  })

  test("allows filling and then clearing a row that was blank in SAP", async () => {
    const { api, posted } = await loadScript([{ id: "001", text: "" }])

    api.updateElement(0, "text", "Temp")
    api.updateElement(0, "text", "")
    api.saveTextElements()

    expect(posted[0].textElements).toEqual([expect.objectContaining({ id: "001", text: "" })])
  })

  test("recomputes blank rows after refresh", async () => {
    const { api, posted, status, receive } = await loadScript([{ id: "001", text: "A" }])

    receive({
      command: "refresh",
      textElements: { symbols: [{ id: "001", text: "" }], selections: [], headings: [] }
    })
    api.saveTextElements()
    expect(posted).toHaveLength(1)

    receive({
      command: "refresh",
      textElements: { symbols: [{ id: "001", text: "B" }], selections: [], headings: [] }
    })
    api.updateElement(0, "text", "")
    api.saveTextElements()
    expect(posted).toHaveLength(1)
    expect(status()).toContain("Text is required")
  })

  test("deleting a row removes it from the saved set", async () => {
    const { api, posted } = await loadScript([
      { id: "001", text: "" },
      { id: "002", text: "B" }
    ])

    api.deleteRow(1)
    api.deleteRow(1)
    api.saveTextElements()

    expect(posted[0].textElements).toEqual([{ id: "001", text: "" }])
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
