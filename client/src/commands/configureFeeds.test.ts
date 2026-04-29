jest.mock("vscode", () => ({
  ViewColumn: { Active: 1, One: 2 },
  workspace: {
    getConfiguration: jest.fn()
  }
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn()
  }
}))

jest.mock("../config", () => ({
  connectedRoots: jest.fn()
}))

jest.mock("../adt/conections", () => ({
  getOrCreateClient: jest.fn()
}))

jest.mock("../services/feeds/feedParsers", () => ({
  toFeedMetadata: jest.fn((f: any) => ({ title: f.title, href: f.href }))
}))

jest.mock("../extension", () => ({
  context: { extensionPath: "/fake/ext" }
}))

jest.mock("path", () => ({
  join: (...args: string[]) => args.join("/")
}))

jest.mock("fs", () => ({
  readFileSync: jest.fn(() => "<html></html>")
}))

jest.mock("../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))

import { configureFeedsCommand } from "./configureFeeds"
import { funWindow as window } from "../services/funMessenger"
import { connectedRoots } from "../config"
import { getOrCreateClient } from "../adt/conections"
import * as vscode from "vscode"

const mockWindow = window as jest.Mocked<typeof window>
const mockConnectedRoots = connectedRoots as jest.MockedFunction<typeof connectedRoots>
const mockGetOrCreateClient = getOrCreateClient as jest.MockedFunction<typeof getOrCreateClient>

function makeMockPanel() {
  const listeners: { [cmd: string]: ((msg: any) => void)[] } = {}
  const disposeListeners: (() => void)[] = []
  return {
    reveal: jest.fn(),
    dispose: jest.fn(),
    webview: {
      html: "",
      onDidReceiveMessage: jest.fn((cb: (msg: any) => void) => {
        listeners["message"] = listeners["message"] || []
        listeners["message"].push(cb)
        return { dispose: jest.fn() }
      }),
      postMessage: jest.fn()
    },
    onDidDispose: jest.fn((cb: () => void) => {
      disposeListeners.push(cb)
      return { dispose: jest.fn() }
    }),
    _triggerMessage: async (msg: any) => {
      const promises = (listeners["message"] || []).map(l => l(msg))
      await Promise.all(promises)
    },
    _triggerDispose: () => disposeListeners.forEach(l => l())
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  // Reset module-level currentPanel by re-importing fresh module
  // We do this by requiring and accessing the module cache
})

// Track the last panel so we can dispose it between tests
let lastPanel: ReturnType<typeof makeMockPanel> | undefined

afterEach(() => {
  // Dispose last panel to reset module-level currentPanel
  if (lastPanel) {
    lastPanel._triggerDispose()
    lastPanel = undefined
  }
})

describe("configureFeedsCommand", () => {
  test("creates a new webview panel", async () => {
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)

    await configureFeedsCommand()

    expect(mockWindow.createWebviewPanel).toHaveBeenCalledWith(
      "feedConfiguration",
      expect.stringContaining("Feed Configuration"),
      vscode.ViewColumn.Active,
      expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true })
    )
  })

  test("reveals existing panel if already open", async () => {
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)

    await configureFeedsCommand()
    await configureFeedsCommand()

    expect(mockWindow.createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(panel.reveal).toHaveBeenCalledTimes(1)
  })

  test("creates new panel after previous one is disposed", async () => {
    const panel1 = makeMockPanel()
    const panel2 = makeMockPanel()
    lastPanel = panel2
    ;(mockWindow.createWebviewPanel as jest.Mock)
      .mockReturnValueOnce(panel1)
      .mockReturnValueOnce(panel2)

    await configureFeedsCommand()
    panel1._triggerDispose()
    await configureFeedsCommand()

    expect(mockWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
  })

  test("handles loadSystems message by posting system IDs", async () => {
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const roots = new Map([
      ["dev100", {}],
      ["qas100", {}]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)

    await configureFeedsCommand()
    await panel._triggerMessage({ command: "loadSystems" })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "systemsLoaded",
        data: expect.arrayContaining(["dev100", "qas100"])
      })
    )
  })

  test("handles loadFeeds message", async () => {
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)
    const mockClient = {
      feeds: jest.fn().mockResolvedValue([
        { title: "Dumps Feed", href: "/sap/bc/adt/runtime/dumps/feeds" }
      ])
    }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({})
    })

    await configureFeedsCommand()
    await panel._triggerMessage({ command: "loadFeeds", data: { systemId: "dev100" } })

    expect(mockGetOrCreateClient).toHaveBeenCalledWith("dev100")
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "feedsLoaded" })
    )
  })

  test("handles bulkAction message without crashing", async () => {
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)

    await configureFeedsCommand()
    // Should not throw
    await panel._triggerMessage({ command: "bulkAction", data: {} })
  })

  test("panel HTML is set from file content", async () => {
    const fs = require("fs")
    ;(fs.readFileSync as jest.Mock).mockReturnValue("<html>feeds</html>")
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as jest.Mock).mockReturnValue(panel)

    await configureFeedsCommand()

    expect(panel.webview.html).toBe("<html>feeds</html>")
  })
})
