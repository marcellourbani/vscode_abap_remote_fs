/**
 * Tests for DiagramWebviewManager.ts
 * Tests singleton pattern, displayDiagram, and message handling.
 */

const mockCreateWebviewPanel = jest.fn()
const mockShowSaveDialog = jest.fn()
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockShowInfoMessage = jest.fn()
const mockShowErrorMessage = jest.fn()

jest.mock(
  "vscode",
  () => ({
    window: {
      showInformationMessage: mockShowInfoMessage,
      showErrorMessage: mockShowErrorMessage,
      showSaveDialog: mockShowSaveDialog,
      createWebviewPanel: mockCreateWebviewPanel
    },
    workspace: {
      fs: { writeFile: mockWriteFile },
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn((k: string, d: any) => d)
      })
    },
    ViewColumn: { One: 1, Active: -1 },
    Uri: {
      joinPath: jest.fn((...args: any[]) => ({ fsPath: args.join("/"), toString: () => args.join("/") })),
      file: jest.fn((p: string) => ({ fsPath: p }))
    }
  }),
  { virtual: true }
)

jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: mockShowInfoMessage,
    showErrorMessage: mockShowErrorMessage,
    showSaveDialog: mockShowSaveDialog,
    createWebviewPanel: mockCreateWebviewPanel
  }
}))

jest.mock("./abapCopilotLogger", () => ({
  logCommands: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
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
      onDidReceiveMessage: jest.fn((handler: (msg: any) => void) => {
        messageHandlers.push(handler)
        return { dispose: jest.fn() }
      }),
      postMessage: jest.fn().mockResolvedValue(true),
      asWebviewUri: jest.fn((uri: any) => uri)
    },
    title: "Test Panel",
    onDidDispose: jest.fn((fn: () => void) => {
      onDisposeFns.push(fn)
      return { dispose: jest.fn() }
    }),
    dispose: jest.fn(() => { onDisposeFns.forEach(fn => fn()) }),
    reveal: jest.fn(),
    _triggerMessage: (msg: any) => messageHandlers.forEach(h => h(msg)),
    _triggerDispose: () => onDisposeFns.forEach(fn => fn())
  }
  return panel
}

describe("DiagramWebviewManager", () => {
  const mockUri = { fsPath: "/ext", toString: () => "/ext" } as any

  beforeEach(() => {
    jest.clearAllMocks()
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

      await DiagramWebviewManager.getInstance().displayDiagram(
        "<svg/>",
        "sequence",
        "Custom Title"
      )

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
      await (panel as any)._triggerMessage({ command: "saveDiagram", svg: "<svg/>", filename: "test.svg" })

      expect(mockShowSaveDialog).toHaveBeenCalledTimes(1)
    })

    it("writes file when save dialog returns a URI", async () => {
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)
      const saveUri = { fsPath: "/home/user/diagram.svg" }
      mockShowSaveDialog.mockResolvedValue(saveUri)

      await DiagramWebviewManager.getInstance().displayDiagram("<svg/>", "flowchart")
      await (panel as any)._triggerMessage({ command: "saveDiagram", svg: "<svg test/>", filename: "diagram.svg" })

      // Wait for async handler
      await new Promise(r => setTimeout(r, 10))

      expect(mockWriteFile).toHaveBeenCalledWith(saveUri, expect.any(Buffer))
    })
  })
})
