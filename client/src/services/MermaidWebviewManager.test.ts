/**
 * Tests for MermaidWebviewManager.ts
 * Tests singleton pattern, initialize/getInstance, and public API behavior.
 */

const mockCreateWebviewPanel = jest.fn()
const mockShowInfoMessage = jest.fn()
const mockShowErrorMessage = jest.fn()

jest.mock(
  "vscode",
  () => ({
    window: {
      showInformationMessage: mockShowInfoMessage,
      showErrorMessage: mockShowErrorMessage,
      createWebviewPanel: mockCreateWebviewPanel
    },
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({ get: jest.fn((k: string, d: any) => d) }),
      fs: { writeFile: jest.fn() }
    },
    ViewColumn: { One: 1, Active: -1 },
    Uri: {
      joinPath: jest.fn((...args: any[]) => ({
        fsPath: args.map(a => a?.fsPath || String(a)).join("/"),
        toString: function () { return this.fsPath }
      })),
      file: jest.fn((p: string) => ({ fsPath: p }))
    }
  }),
  { virtual: true }
)

jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: mockShowInfoMessage,
    showErrorMessage: mockShowErrorMessage,
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

jest.mock("./DiagramWebviewManager", () => ({
  DiagramWebviewManager: {
    getInstance: jest.fn().mockReturnValue({
      displayDiagram: jest.fn().mockResolvedValue({ webviewId: "diagram-1", action: "created" })
    })
  }
}))

import { MermaidWebviewManager, MermaidRenderResult, MermaidValidationResult } from "./MermaidWebviewManager"

const mockExtUri = { fsPath: "/ext", toString: () => "/ext" } as any

// Helper: build a panel that resolves the ready promise after a short delay
function makeMockPanel(readyDelay = 0) {
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
    title: "Mermaid Renderer",
    onDidDispose: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    dispose: jest.fn(),
    reveal: jest.fn(),
    // Helper to simulate webview sending a message back
    _sendMessage: (msg: any) => messageHandlers.forEach(h => h(msg))
  }

  // Auto-send ready after delay when HTML is set
  const originalDescriptor = Object.getOwnPropertyDescriptor(panel.webview, "html")
  Object.defineProperty(panel.webview, "html", {
    set(value: string) {
      if (originalDescriptor?.set) originalDescriptor.set(value)
      else (panel.webview as any)._html = value
      if (readyDelay >= 0) {
        setTimeout(() => panel._sendMessage({ type: "ready" }), readyDelay)
      }
    },
    get() {
      return (panel.webview as any)._html || ""
    }
  })

  return panel
}

describe("MermaidWebviewManager", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    // Reset singleton
    ;(MermaidWebviewManager as any).instance = undefined
    ;(MermaidWebviewManager as any).isInitialized = false
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe("initialize / getInstance", () => {
    it("throws when getInstance called before initialize", () => {
      expect(() => MermaidWebviewManager.getInstance()).toThrow("not initialized")
    })

    it("returns instance after initialize", () => {
      MermaidWebviewManager.initialize(mockExtUri)
      expect(MermaidWebviewManager.getInstance()).toBeDefined()
    })

    it("initialize is idempotent", () => {
      MermaidWebviewManager.initialize(mockExtUri)
      const a = MermaidWebviewManager.getInstance()
      MermaidWebviewManager.initialize({ fsPath: "/other" } as any)
      const b = MermaidWebviewManager.getInstance()
      expect(a).toBe(b)
    })
  })

  describe("dispose", () => {
    it("dispose() does not throw", () => {
      MermaidWebviewManager.initialize(mockExtUri)
      expect(() => MermaidWebviewManager.getInstance().dispose()).not.toThrow()
    })
  })

  describe("renderDiagram", () => {
    it("creates a one-time webview panel per render call", async () => {
      MermaidWebviewManager.initialize(mockExtUri)
      const panel = makeMockPanel(0)
      mockCreateWebviewPanel.mockReturnValue(panel)

      // Start the render — don't await it since we can't fully resolve the flow with fake timers
      const renderPromise = MermaidWebviewManager.getInstance().renderDiagram("graph LR; A-->B")

      // Advance timers to fire the ready event (readyDelay=0)
      jest.advanceTimersByTime(1)
      // Let microtasks settle so the ready promise resolves and postMessage is called
      await Promise.resolve()
      await Promise.resolve()

      // Verify panel was created
      expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1)

      // Clean up: advance past all timeouts so the promise settles
      jest.advanceTimersByTime(60000)
      await renderPromise.catch(() => {}) // swallow timeout error
    })

    it("times out and rejects when webview does not respond", async () => {
      MermaidWebviewManager.initialize(mockExtUri)
      const panel = {
        webview: {
          html: "",
          onDidReceiveMessage: jest.fn().mockReturnValue({ dispose: jest.fn() }),
          postMessage: jest.fn(),
          asWebviewUri: jest.fn((u: any) => u)
        },
        onDidDispose: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        dispose: jest.fn()
      }
      mockCreateWebviewPanel.mockReturnValue(panel)

      const renderPromise = MermaidWebviewManager.getInstance().renderDiagram("graph LR; A-->B")

      // Advance past the 10-second ready timeout
      jest.advanceTimersByTime(11000)

      await expect(renderPromise).rejects.toThrow()
    })
  })

  describe("MermaidRenderResult interface", () => {
    it("has required fields", () => {
      const r: MermaidRenderResult = { svg: "<svg/>", diagramType: "flowchart", success: true }
      expect(r.success).toBe(true)
      expect(r.diagramType).toBe("flowchart")
    })

    it("accepts optional error field", () => {
      const r: MermaidRenderResult = { svg: "", diagramType: "unknown", success: false, error: "Parse error" }
      expect(r.error).toBe("Parse error")
    })
  })

  describe("MermaidValidationResult interface", () => {
    it("accepts isValid=true with diagramType", () => {
      const r: MermaidValidationResult = { isValid: true, diagramType: "sequence" }
      expect(r.isValid).toBe(true)
    })

    it("accepts isValid=false with error", () => {
      const r: MermaidValidationResult = { isValid: false, error: "Invalid syntax" }
      expect(r.error).toBe("Invalid syntax")
    })
  })
})
