const { mockCreateWebviewPanel, mockShowInfoMessage, mockShowErrorMessage } = vi.hoisted(() => {
  const mockCreateWebviewPanel = vi.fn()
  const mockShowInfoMessage = vi.fn()
  const mockShowErrorMessage = vi.fn()
  return { mockCreateWebviewPanel, mockShowInfoMessage, mockShowErrorMessage }
})
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: mockShowInfoMessage,
    showErrorMessage: mockShowErrorMessage,
    createWebviewPanel: mockCreateWebviewPanel
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(function (k: string, d: any) {
        return d
      })
    }),
    fs: { writeFile: vi.fn() }
  },
  ViewColumn: { One: 1, Active: -1 },
  Uri: {
    joinPath: vi.fn(function (...args: any[]) {
      return {
        fsPath: args.map(a => a?.fsPath || String(a)).join("/"),
        toString: function () {
          return this.fsPath
        }
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

vi.mock("./DiagramWebviewManager", () => ({
  DiagramWebviewManager: {
    getInstance: vi.fn().mockReturnValue({
      displayDiagram: vi.fn().mockResolvedValue({ webviewId: "diagram-1", action: "created" })
    })
  }
}))

import {
  MermaidWebviewManager,
  type MermaidRenderResult,
  type MermaidValidationResult
} from "./MermaidWebviewManager"

const mockExtUri = { fsPath: "/ext", toString: () => "/ext" } as any

// Helper: build a panel that resolves the ready promise after a short delay
function makeMockPanel(readyDelay = 0) {
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
    title: "Mermaid Renderer",
    onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
    reveal: vi.fn(),
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
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset singleton
    ;(MermaidWebviewManager as any).instance = undefined
    ;(MermaidWebviewManager as any).isInitialized = false
  })

  afterEach(() => {
    vi.useRealTimers()
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
      vi.advanceTimersByTime(1)
      // Let microtasks settle so the ready promise resolves and postMessage is called
      await Promise.resolve()
      await Promise.resolve()

      // Verify panel was created
      expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1)

      // Clean up: advance past all timeouts so the promise settles
      vi.advanceTimersByTime(60000)
      await renderPromise.catch(() => {}) // swallow timeout error
    })

    it("times out and rejects when webview does not respond", async () => {
      MermaidWebviewManager.initialize(mockExtUri)
      const panel = {
        webview: {
          html: "",
          onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
          postMessage: vi.fn(),
          asWebviewUri: vi.fn(function (u: any) {
            return u
          })
        },
        onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        dispose: vi.fn()
      }
      mockCreateWebviewPanel.mockReturnValue(panel)

      const renderPromise = MermaidWebviewManager.getInstance().renderDiagram("graph LR; A-->B")

      // Advance past the 10-second ready timeout
      vi.advanceTimersByTime(11000)

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
      const r: MermaidRenderResult = {
        svg: "",
        diagramType: "unknown",
        success: false,
        error: "Parse error"
      }
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
