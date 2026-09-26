vi.mock("vscode", () => ({
  ViewColumn: { Active: 1, One: 2 },
  workspace: {
    getConfiguration: vi.fn()
  }
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn()
  }
}))

vi.mock("../config", () => ({
  connectedRoots: vi.fn()
}))

vi.mock("../adt/conections", () => ({
  getOrCreateClient: vi.fn()
}))

vi.mock("../services/feeds/feedParsers", () => ({
  toFeedMetadata: vi.fn(function (f: any) {
    return { title: f.title, href: f.href }
  })
}))

vi.mock("../extension", () => ({
  context: { extensionPath: "/fake/ext" }
}))

vi.mock("path", () => ({
  join: (...args: string[]) => args.join("/")
}))

vi.mock("fs", () => ({
  readFileSync: vi.fn(function () {
    return "<html></html>"
  })
}))

vi.mock("../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

import { configureFeedsCommand } from "./configureFeeds"
import { funWindow as window } from "../services/funMessenger"
import { connectedRoots } from "../config"
import { getOrCreateClient } from "../adt/conections"
import * as vscode from "vscode"
import * as __$mock_fs from "fs"
import type { Mocked, MockedFunction, Mock } from "vitest"

const mockWindow = window as Mocked<typeof window>
const mockConnectedRoots = connectedRoots as MockedFunction<typeof connectedRoots>
const mockGetOrCreateClient = getOrCreateClient as MockedFunction<typeof getOrCreateClient>

function makeMockPanel() {
  const listeners: { [cmd: string]: ((msg: any) => void)[] } = {}
  const disposeListeners: (() => void)[] = []
  return {
    reveal: vi.fn(),
    dispose: vi.fn(),
    webview: {
      html: "",
      onDidReceiveMessage: vi.fn(function (cb: (msg: any) => void) {
        listeners["message"] = listeners["message"] || []
        listeners["message"].push(cb)
        return { dispose: vi.fn() }
      }),
      postMessage: vi.fn()
    },
    onDidDispose: vi.fn(function (cb: () => void) {
      disposeListeners.push(cb)
      return { dispose: vi.fn() }
    }),
    _triggerMessage: async (msg: any) => {
      const promises = (listeners["message"] || []).map(l => l(msg))
      await Promise.all(promises)
    },
    _triggerDispose: () => disposeListeners.forEach(l => l())
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)

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
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)

    await configureFeedsCommand()
    await configureFeedsCommand()

    expect(mockWindow.createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(panel.reveal).toHaveBeenCalledTimes(1)
  })

  test("creates new panel after previous one is disposed", async () => {
    const panel1 = makeMockPanel()
    const panel2 = makeMockPanel()
    lastPanel = panel2
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValueOnce(panel1).mockReturnValueOnce(panel2)

    await configureFeedsCommand()
    panel1._triggerDispose()
    await configureFeedsCommand()

    expect(mockWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
  })

  test("handles loadSystems message by posting system IDs", async () => {
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)
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
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)
    const mockClient = {
      feeds: vi
        .fn()
        .mockResolvedValue([{ title: "Dumps Feed", href: "/sap/bc/adt/runtime/dumps/feeds" }])
    }
    mockGetOrCreateClient.mockResolvedValue(mockClient as any)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn().mockReturnValue({})
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
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)

    await configureFeedsCommand()
    // Should not throw
    await panel._triggerMessage({ command: "bulkAction", data: {} })
  })

  test("panel HTML is set from file content", async () => {
    const fs = __$mock_fs
    ;(fs.readFileSync as Mock).mockReturnValue("<html>feeds</html>")
    const panel = makeMockPanel()
    lastPanel = panel
    ;(mockWindow.createWebviewPanel as Mock).mockReturnValue(panel)

    await configureFeedsCommand()

    expect(panel.webview.html).toBe("<html>feeds</html>")
  })
})
