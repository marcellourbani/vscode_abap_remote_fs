/**
 * Tests for views/help.ts - showAbapDoc function
 */

jest.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Uri: {
    parse: jest.fn((s: string) => ({
      toString: () => s,
      scheme: s.split(":")[0],
      authority: "",
      path: s,
      query: "",
    })),
  },
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createWebviewPanel: jest.fn(),
    showErrorMessage: jest.fn(),
  },
}), { virtual: true })

jest.mock("../adt/conections", () => ({
  ADTSCHEME: "adt",
  getClient: jest.fn(),
}), { virtual: true })

jest.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: jest.fn().mockImplementation(() => ({
    displayAdtUri: jest.fn(),
  })),
  findAbapObject: jest.fn(),
}), { virtual: true })

jest.mock("./utilities", () => ({
  injectUrlHandler: jest.fn((html: string) => html + "<!-- injected -->"),
}), { virtual: true })

import { showAbapDoc } from "./help"
import { funWindow as window } from "../services/funMessenger"
import { getClient, ADTSCHEME } from "../adt/conections"
import { findAbapObject } from "../adt/operations/AdtObjectFinder"

const mockedWindow = window as jest.Mocked<typeof window>
const mockedGetClient = getClient as jest.Mock
const mockedFindAbapObject = findAbapObject as jest.Mock

describe("showAbapDoc", () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
        getText: jest.fn(() => "code"),
      },
      selection: { active: { line: 0, character: 0 } },
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor
    await showAbapDoc()
    expect(mockedGetClient).not.toHaveBeenCalled()
  })

  it("opens webview panel with documentation", async () => {
    const mockOnDidReceiveMessage = jest.fn()
    const mockPanel = {
      webview: {
        html: "",
        onDidReceiveMessage: mockOnDidReceiveMessage,
      },
    }
    ;(mockedWindow as any).createWebviewPanel = jest.fn().mockReturnValue(mockPanel)

    const fakeEditor = {
      document: {
        uri: { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" },
        getText: jest.fn(() => "WRITE 'hello'."),
      },
      selection: { active: { line: 5, character: 3 } },
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor

    const mockAbapDoc = jest.fn().mockResolvedValue("<html>doc</html>")
    const mockClient = { abapDocumentation: mockAbapDoc, httpClient: { request: jest.fn() } }
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
      4  // character + 1
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
        onDidReceiveMessage: jest.fn((cb: any) => { messageHandlers.push(cb) }),
        postMessage: jest.fn(),
      },
    }
    ;(mockedWindow as any).createWebviewPanel = jest.fn().mockReturnValue(mockPanel)

    const fakeEditor = {
      document: {
        uri: { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" },
        getText: jest.fn(() => "code"),
      },
      selection: { active: { line: 0, character: 0 } },
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor
    mockedGetClient.mockReturnValue({
      abapDocumentation: jest.fn().mockResolvedValue("<html/>"),
      httpClient: { request: jest.fn() },
    })
    mockedFindAbapObject.mockResolvedValue({ path: "/some/path" })

    await showAbapDoc()

    const { AdtObjectFinder } = require("../adt/operations/AdtObjectFinder")
    const mockDisplayAdtUri = jest.fn()
    ;(AdtObjectFinder as jest.Mock).mockImplementation(() => ({ displayAdtUri: mockDisplayAdtUri }))

    const { Uri } = require("vscode")
    ;(Uri.parse as jest.Mock).mockReturnValueOnce({ scheme: "adt", toString: () => "adt://x/y", authority: "", path: "", query: "" })

    if (messageHandlers[0]) {
      await messageHandlers[0]({ command: "click", uri: "adt://dev100/some/path" })
    }
  })

  it("handles webview message with non-adt url scheme", async () => {
    const messageHandlers: Array<(msg: any) => void> = []
    const mockPanel = {
      webview: {
        html: "",
        onDidReceiveMessage: jest.fn((cb: any) => { messageHandlers.push(cb) }),
        postMessage: jest.fn(),
      },
    }
    ;(mockedWindow as any).createWebviewPanel = jest.fn().mockReturnValue(mockPanel)

    const fakeEditor = {
      document: {
        uri: { scheme: "adt", toString: () => "adt://dev100/foo.abap", authority: "dev100" },
        getText: jest.fn(() => "code"),
      },
      selection: { active: { line: 0, character: 0 } },
    }
    ;(mockedWindow as any).activeTextEditor = fakeEditor
    const mockRequest = jest.fn().mockResolvedValue({ body: "<html>fetched</html>" })
    mockedGetClient.mockReturnValue({
      abapDocumentation: jest.fn().mockResolvedValue("<html/>"),
      httpClient: { request: mockRequest },
    })
    mockedFindAbapObject.mockResolvedValue({ path: "/some/path" })

    await showAbapDoc()

    const { Uri } = require("vscode")
    ;(Uri.parse as jest.Mock).mockReturnValueOnce({
      scheme: "https",
      toString: () => "https://example.com/doc",
      path: "/doc",
      query: "v=1",
    })

    if (messageHandlers[0]) {
      await messageHandlers[0]({ command: "click", uri: "https://example.com/doc?v=1" })
      expect(mockRequest).toHaveBeenCalled()
    }
  })
})
