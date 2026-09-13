const {
  mockCreateWebviewPanel,
  mockShowSaveDialog,
  mockWriteFile,
  mockShowInfoMessage,
  mockShowErrorMessage
} = vi.hoisted(() => {
  const mockCreateWebviewPanel = vi.fn()
  const mockShowSaveDialog = vi.fn()
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  const mockShowInfoMessage = vi.fn()
  const mockShowErrorMessage = vi.fn()
  return {
    mockCreateWebviewPanel,
    mockShowSaveDialog,
    mockWriteFile,
    mockShowInfoMessage,
    mockShowErrorMessage
  }
})
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: mockShowInfoMessage,
    showErrorMessage: mockShowErrorMessage,
    showSaveDialog: mockShowSaveDialog,
    createWebviewPanel: mockCreateWebviewPanel
  },
  workspace: {
    fs: { writeFile: mockWriteFile },
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(function (k: string, d: any) {
        return d
      })
    })
  },
  ViewColumn: { One: 1, Active: -1 },
  Uri: {
    joinPath: vi.fn(function (...args: any[]) {
      return {
        fsPath: args.join("/"),
        toString: () => args.join("/")
      }
    }),
    file: vi.fn(function (p: string) {
      return { fsPath: p }
    })
  }
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: mockShowInfoMessage,
    showErrorMessage: mockShowErrorMessage,
    showSaveDialog: mockShowSaveDialog,
    createWebviewPanel: mockCreateWebviewPanel
  }
}))

vi.mock("./abapCopilotLogger", () => ({
  logCommands: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

import * as vscode from "vscode"
import { DiagramWebviewManager } from "./DiagramWebviewManager"

function makeMockPanel() {
  const onDisposeFns: Array<() => void> = []
  const messageHandlers: Array<(msg: any) => void> = []

  const panel = {
    webview: {
      html: "",
      onDidReceiveMessage: vi.fn(function (handler: (msg: any) => void) {
        messageHandlers.push(handler)
        return { dispose: vi.fn() }
      }),
      postMessage: vi.fn().mockResolvedValue(true),
      asWebviewUri: vi.fn(function (uri: any) {
        return uri
      })
    },
    title: "Test Panel",
    onDidDispose: vi.fn(function (fn: () => void) {
      onDisposeFns.push(fn)
      return { dispose: vi.fn() }
    }),
    dispose: vi.fn(function () {
      onDisposeFns.forEach(fn => fn())
    }),
    reveal: vi.fn(),
    _triggerMessage: (msg: any) => messageHandlers.forEach(h => h(msg)),
    _triggerDispose: () => onDisposeFns.forEach(fn => fn())
  }
  return panel
}

describe("DiagramWebviewManager", () => {
  const mockUri = { fsPath: "/ext", toString: () => "/ext" } as any

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset singleton
    ;(DiagramWebviewManager as any).instance = undefined
    ;(DiagramWebviewManager as any).isInitialized = false
  })

  describe("initialize / getInstance", () => {
    it("throws when getInstance called before initialize", () => {
      expect(() => DiagramWebviewManager.getInstance()).toThrow("not initialized")
    })

    it("returns instance after initialize", () => {
      DiagramWebviewManager.initialize(mockUri)
      const instance = DiagramWebviewManager.getInstance()
      expect(instance).toBeDefined()
    })

    it("initialize is idempotent (second call does not replace)", () => {
      DiagramWebviewManager.initialize(mockUri)
      const a = DiagramWebviewManager.getInstance()
      DiagramWebviewManager.initialize({ fsPath: "/other" } as any)
      const b = DiagramWebviewManager.getInstance()
      expect(a).toBe(b)
    })
  })

  describe("displayDiagram", () => {
    beforeEach(() => {
      DiagramWebviewManager.initialize(mockUri)
    })

    it("creates a webview panel", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      await DiagramWebviewManager.getInstance().displayDiagram(
        "<svg>...</svg>",
        "flowchart",
        "My Diagram"
      )

      expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1)
    })

    it("returns a webviewId and action='created'", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const result = await DiagramWebviewManager.getInstance().displayDiagram(
        "<svg>...</svg>",
        "flowchart"
      )

      expect(result.action).toBe("created")
      expect(typeof result.webviewId).toBe("string")
      expect(result.webviewId).toMatch(/^diagram-/)
    })

    it("uses provided title in panel creation", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      await DiagramWebviewManager.getInstance().displayDiagram("<svg/>", "sequence", "Custom Title")

      expect(mockCreateWebviewPanel).toHaveBeenCalledWith(
        "diagramViewer",
        "Custom Title",
        expect.anything(),
        expect.anything()
      )
    })

    it("defaults title to 'Mermaid Diagram' when not provided", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      await DiagramWebviewManager.getInstance().displayDiagram("<svg/>", "pie")

      expect(mockCreateWebviewPanel).toHaveBeenCalledWith(
        "diagramViewer",
        "Mermaid Diagram",
        expect.anything(),
        expect.anything()
      )
    })

    it("sets webview HTML content", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      await DiagramWebviewManager.getInstance().displayDiagram("<svg>content</svg>", "flowchart")

      expect(panel.webview.html).toBeTruthy()
      expect(panel.webview.html).toContain("<!DOCTYPE html>")
    })

    it("removes webview from internal map on dispose", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = DiagramWebviewManager.getInstance()
      const { webviewId } = await manager.displayDiagram("<svg/>", "flowchart")

      // Trigger dispose
      panel._triggerDispose()

      // Internal map should no longer contain the webviewId
      const webviews = (manager as any).webviews as Map<string, any>
      expect(webviews.has(webviewId)).toBe(false)
    })

    it("each call generates a unique webviewId", async () => {
      const panel1 = makeMockPanel()
      const panel2 = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValueOnce(panel1).mockReturnValueOnce(panel2)

      const manager = DiagramWebviewManager.getInstance()
      const { webviewId: id1 } = await manager.displayDiagram("<svg/>", "flowchart")
      const { webviewId: id2 } = await manager.displayDiagram("<svg/>", "sequence")

      expect(id1).not.toBe(id2)
    })
  })

  describe("message handling - saveDiagram", () => {
    beforeEach(() => {
      DiagramWebviewManager.initialize(mockUri)
    })

    it("shows save dialog on saveDiagram message", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)
      mockShowSaveDialog.mockResolvedValue(null) // User cancels

      await DiagramWebviewManager.getInstance().displayDiagram("<svg/>", "flowchart")

      // Trigger saveDiagram message
      await (panel as any)._triggerMessage({
        command: "saveDiagram",
        svg: "<svg/>",
        filename: "test.svg"
      })

      expect(mockShowSaveDialog).toHaveBeenCalledTimes(1)
    })

    it("writes file when save dialog returns a URI", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)
      const saveUri = { fsPath: "/home/user/diagram.svg" }
      mockShowSaveDialog.mockResolvedValue(saveUri)

      await DiagramWebviewManager.getInstance().displayDiagram("<svg/>", "flowchart")
      await (panel as any)._triggerMessage({
        command: "saveDiagram",
        svg: "<svg test/>",
        filename: "diagram.svg"
      })

      // Wait for async handler
      await new Promise(r => setTimeout(r, 10))

      expect(mockWriteFile).toHaveBeenCalledWith(saveUri, expect.any(Buffer))
    })
  })
})
