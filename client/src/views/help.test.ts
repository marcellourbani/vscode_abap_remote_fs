/**
 * Tests for views/help.ts - showAbapDoc function
 */

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        toString: () => s,
        scheme: s.split(":")[0],
        authority: "",
        path: s,
        query: ""
      }
    })
  }
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createWebviewPanel: vi.fn(),
    showErrorMessage: vi.fn()
  }
}))

vi.mock("../adt/conections", () => ({
  ADTSCHEME: "adt",
  getClient: vi.fn()
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      displayAdtUri: vi.fn()
    }
  }),
  findAbapObject: vi.fn()
}))

vi.mock("./utilities", () => ({
  injectUrlHandler: vi.fn(function (html: string) {
    return html + "<!-- injected -->"
  })
}))

import { showAbapDoc } from "./help"
import { funWindow as window } from "../services/funMessenger"
import { getClient, ADTSCHEME } from "../adt/conections"
import { findAbapObject } from "../adt/operations/AdtObjectFinder"
import * as __$mock_adt_operations_AdtObjectFinder from "../adt/operations/AdtObjectFinder"
import * as __$mock_vscode from "vscode"
import type { Mocked, Mock } from "vitest"

const mockedWindow = window as Mocked<typeof window>
const mockedGetClient = getClient as Mock
const mockedFindAbapObject = findAbapObject as Mock

describe("showAbapDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns early if no active editor", async () => {
    ;(mockedWindow as any).activeTextEditor = undefined
    await showAbapDoc()
    expect(mockedGetClient).not.toHaveBeenCalled()
  })

  it("returns early if document scheme is not adt", async () => {
    const fakeEditor = {
      document: {
        uri: { scheme: "file", toString: () => "file:///foo.ts", authority: "" },
        getText: vi.fn(function () {
          return "code"
        })
      },
      selection: { active: { line: 0, character: 0 } }
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor
    await showAbapDoc()
    expect(mockedGetClient).not.toHaveBeenCalled()
  })

  it("opens webview panel with documentation", async () => {
    const mockOnDidReceiveMessage = vi.fn()
    const mockPanel = {
      webview: {
        html: "",
        onDidReceiveMessage: mockOnDidReceiveMessage
      }
    }
    ;(mockedWindow as any).createWebviewPanel = vi.fn().mockReturnValue(mockPanel)

    const fakeEditor = {
      document: {
        uri: { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" },
        getText: vi.fn(function () {
          return "WRITE 'hello'."
        })
      },
      selection: { active: { line: 5, character: 3 } }
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor

    const mockAbapDoc = vi.fn().mockResolvedValue("<html>doc</html>")
    const mockClient = { abapDocumentation: mockAbapDoc, httpClient: { request: vi.fn() } }
    mockedGetClient.mockReturnValue(mockClient)

    const mockObj = { path: "/sap/bc/adt/programs/programs/zprog/source/main" }
    mockedFindAbapObject.mockResolvedValue(mockObj)

    await showAbapDoc()

    expect(mockedGetClient).toHaveBeenCalledWith("dev100")
    expect(mockedFindAbapObject).toHaveBeenCalled()
    expect(mockAbapDoc).toHaveBeenCalledWith(
      mockObj.path,
      "WRITE 'hello'.",
      6, // line + 1
      4 // character + 1
    )
    expect(mockedWindow.createWebviewPanel).toHaveBeenCalledWith(
      "ABAPDOC",
      "ABAP documentation",
      2, // ViewColumn.Beside
      { enableScripts: true, enableFindWidget: true }
    )
    expect(mockPanel.webview.html).toContain("<!-- injected -->")
  })

  it("handles webview message with adt url scheme", async () => {
    const messageHandlers: Array<(msg: any) => void> = []
    const mockPanel = {
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(function (cb: any) {
          messageHandlers.push(cb)
        }),
        postMessage: vi.fn()
      }
    }
    ;(mockedWindow as any).createWebviewPanel = vi.fn().mockReturnValue(mockPanel)

    const fakeEditor = {
      document: {
        uri: { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" },
        getText: vi.fn(function () {
          return "code"
        })
      },
      selection: { active: { line: 0, character: 0 } }
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor
    mockedGetClient.mockReturnValue({
      abapDocumentation: vi.fn().mockResolvedValue("<html/>"),
      httpClient: { request: vi.fn() }
    })
    mockedFindAbapObject.mockResolvedValue({ path: "/some/path" })

    await showAbapDoc()

    const { AdtObjectFinder } = __$mock_adt_operations_AdtObjectFinder
    const mockDisplayAdtUri = vi.fn()
    ;(AdtObjectFinder as Mock).mockImplementation(function () {
      return { displayAdtUri: mockDisplayAdtUri }
    })

    const { Uri } = __$mock_vscode
    ;(Uri.parse as Mock).mockReturnValueOnce({
      scheme: "adt",
      toString: () => "adt://x/y",
      authority: "",
      path: "",
      query: ""
    })

    if (messageHandlers[0]) {
      await messageHandlers[0]({ command: "click", uri: "adt://dev100/some/path" })
    }
  })

  it("handles webview message with non-adt url scheme", async () => {
    const messageHandlers: Array<(msg: any) => void> = []
    const mockPanel = {
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(function (cb: any) {
          messageHandlers.push(cb)
        }),
        postMessage: vi.fn()
      }
    }
    ;(mockedWindow as any).createWebviewPanel = vi.fn().mockReturnValue(mockPanel)

    const fakeEditor = {
      document: {
        uri: { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" },
        getText: vi.fn(function () {
          return "code"
        })
      },
      selection: { active: { line: 0, character: 0 } }
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor
    const mockRequest = vi.fn().mockResolvedValue({ body: "<html>fetched</html>" })
    mockedGetClient.mockReturnValue({
      abapDocumentation: vi.fn().mockResolvedValue("<html/>"),
      httpClient: { request: mockRequest }
    })
    mockedFindAbapObject.mockResolvedValue({ path: "/some/path" })

    await showAbapDoc()

    const { Uri } = __$mock_vscode
    ;(Uri.parse as Mock).mockReturnValueOnce({
      scheme: "https",
      toString: () => "https://example.com/doc",
      path: "/doc",
      query: "v=1"
    })

    if (messageHandlers[0]) {
      await messageHandlers[0]({ command: "click", uri: "https://example.com/doc?v=1" })
      expect(mockRequest).toHaveBeenCalled()
    }
  })
})
