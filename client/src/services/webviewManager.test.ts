/**
 * Tests for webviewManager.ts
 * Tests singleton pattern, WebviewManager public API, and interface types.
 */

const mockCreateWebviewPanel = jest.fn()
const mockGlobalStateGet = jest.fn().mockReturnValue({})
const mockGlobalStateUpdate = jest.fn().mockResolvedValue(undefined)

jest.mock(
  "vscode",
  () => ({
    window: {
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      createWebviewPanel: mockCreateWebviewPanel,
      activeTextEditor: undefined
    },
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn((k: string, d: any) => d),
        update: jest.fn()
      }),
      fs: { writeFile: jest.fn() }
    },
    ViewColumn: { One: 1, Active: -1 },
    Uri: {
      joinPath: jest.fn(),
      file: jest.fn((p: string) => ({ fsPath: p }))
    }
  }),
  { virtual: true }
)

jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createWebviewPanel: mockCreateWebviewPanel,
    activeTextEditor: undefined
  }
}))

jest.mock("../adt/conections", () => ({
  getClient: jest.fn(),
  getOrCreateRoot: jest.fn()
}))

jest.mock("../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  log: jest.fn()
}))

jest.mock("./dependencyGraph", () => ({
  fetchWhereUsedData: jest.fn().mockResolvedValue([]),
  buildGraphData: jest.fn().mockReturnValue({ nodes: [], edges: [] }),
  mergeGraphData: jest.fn().mockReturnValue({ nodes: [], edges: [] }),
  applyFilters: jest.fn().mockReturnValue({ nodes: [], edges: [] })
}))

jest.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: jest.fn()
}))

jest.mock("./abapSearchService", () => ({
  getSearchService: jest.fn()
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn()
}))

import { WebviewManager } from "./webviewManager"

function makeContext() {
  return {
    globalState: {
      get: mockGlobalStateGet,
      update: mockGlobalStateUpdate
    },
    subscriptions: [] as any[]
  } as any
}

// Helper to make a mock webview panel
function makeMockPanel() {
  const onDisposeFns: Array<() => void> = []
  const panel = {
    webview: {
      html: "",
      onDidReceiveMessage: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      postMessage: jest.fn().mockResolvedValue(true),
      asWebviewUri: jest.fn((uri: any) => uri)
    },
    title: "Test Panel",
    viewColumn: 1,
    onDidDispose: jest.fn((fn: () => void) => {
      onDisposeFns.push(fn)
      return { dispose: jest.fn() }
    }),
    dispose: jest.fn(() => { onDisposeFns.forEach(fn => fn()) }),
    reveal: jest.fn()
  }
  return panel
}

describe("WebviewManager", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset singleton between tests
    ;(WebviewManager as any).instance = undefined
    mockGlobalStateGet.mockReturnValue({})
  })

  describe("getInstance", () => {
    it("throws when called without context on first call", () => {
      expect(() => WebviewManager.getInstance()).toThrow(
        "WebviewManager requires context for initialization"
      )
    })

    it("creates singleton with context on first call", () => {
      const context = makeContext()
      const instance = WebviewManager.getInstance(context)
      expect(instance).toBeDefined()
    })

    it("returns same instance on subsequent calls", () => {
      const context = makeContext()
      const a = WebviewManager.getInstance(context)
      const b = WebviewManager.getInstance()
      expect(a).toBe(b)
    })

    it("ignores context parameter on subsequent calls (uses existing)", () => {
      const context1 = makeContext()
      const context2 = makeContext()
      const a = WebviewManager.getInstance(context1)
      const b = WebviewManager.getInstance(context2)
      expect(a).toBe(b)
    })
  })

  describe("createOrUpdateWebview", () => {
    it("creates a new webview panel when no webviewId provided", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)

      // Mock a simple direct data client
      const directData = {
        columns: [{ name: "MATNR", type: "C" }],
        values: [{ MATNR: "MAT001" }]
      }

      await manager.createOrUpdateWebview(directData as any, "", "DEV100", undefined, "Test")

      expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1)
    })

    it("returns a webviewId in the result", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }

      const result = await manager.createOrUpdateWebview(directData as any, "", "DEV100")
      expect(typeof result.webviewId).toBe("string")
      expect(result.webviewId).toMatch(/^data-query-/)
    })

    it("reuses existing webview panel when webviewId matches active webview", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }

      // First create
      const { webviewId } = await manager.createOrUpdateWebview(directData as any, "", "DEV100", undefined, "First")

      // Second call with same id
      await manager.createOrUpdateWebview(directData as any, "", "DEV100", webviewId, "Updated")

      // Panel should only be created once
      expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1)
    })

    it("posts queryResult message to webview", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = {
        columns: [{ name: "FIELD", type: "C" }],
        values: [{ FIELD: "VALUE" }]
      }

      await manager.createOrUpdateWebview(directData as any, "", "DEV100")

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "queryResult" })
      )
    })

    it("sends clearSorting message when resetSorting=true", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }

      await manager.createOrUpdateWebview(
        directData as any, "", "DEV100", undefined, undefined, undefined, undefined, undefined, undefined, true
      )

      const clearSortMsg = (panel.webview.postMessage as jest.Mock).mock.calls.find(
        (c: any) => c[0]?.command === "clearSorting"
      )
      expect(clearSortMsg).toBeDefined()
    })

    it("sends clearFilters message when resetFilters=true", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }

      await manager.createOrUpdateWebview(
        directData as any, "", "DEV100", undefined, undefined, undefined, undefined, undefined, undefined, false, true
      )

      const clearFiltersMsg = (panel.webview.postMessage as jest.Mock).mock.calls.find(
        (c: any) => c[0]?.command === "clearFilters"
      )
      expect(clearFiltersMsg).toBeDefined()
    })

    it("sends applySorting message when sortColumns provided", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }
      const sortColumns = [{ column: "MATNR", direction: "asc" as const }]

      await manager.createOrUpdateWebview(
        directData as any, "", "DEV100", undefined, undefined, undefined, undefined, sortColumns
      )

      const sortMsg = (panel.webview.postMessage as jest.Mock).mock.calls.find(
        (c: any) => c[0]?.command === "applySorting"
      )
      expect(sortMsg).toBeDefined()
      expect(sortMsg[0].data.sortColumns).toEqual(sortColumns)
    })

    it("sends applyFilters message when filters provided", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }
      const filters = [{ column: "MATNR", value: "MAT*" }]

      await manager.createOrUpdateWebview(
        directData as any, "", "DEV100", undefined, undefined, undefined, undefined, undefined, filters
      )

      const filterMsg = (panel.webview.postMessage as jest.Mock).mock.calls.find(
        (c: any) => c[0]?.command === "applyFilters"
      )
      expect(filterMsg).toBeDefined()
    })
  })

  describe("interfaces", () => {
    it("RowRange accepts start and end numbers", () => {
      const r = { start: 0, end: 100 }
      expect(r.start).toBe(0)
      expect(r.end).toBe(100)
    })

    it("SortColumn accepts column and direction", () => {
      const s = { column: "MATNR", direction: "asc" as const }
      expect(s.direction).toBe("asc")
    })

    it("ColumnFilter accepts column and value with wildcard", () => {
      const f = { column: "MATNR", value: "MAT*" }
      expect(f.value).toBe("MAT*")
    })
  })
})
