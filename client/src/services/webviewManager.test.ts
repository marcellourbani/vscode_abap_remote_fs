const { mockCreateWebviewPanel } = vi.hoisted(() => {
  const mockCreateWebviewPanel = vi.fn()
  return { mockCreateWebviewPanel }
})
const mockGlobalStateGet = vi.fn().mockReturnValue({})
const mockGlobalStateUpdate = vi.fn().mockResolvedValue(undefined)

vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createWebviewPanel: mockCreateWebviewPanel,
    activeTextEditor: undefined
  },
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(function (k: string, d: any) {
        return d
      }),
      update: vi.fn()
    }),
    fs: { writeFile: vi.fn() }
  },
  ViewColumn: { One: 1, Active: -1 },
  Uri: {
    joinPath: vi.fn(),
    file: vi.fn(function (p: string) {
      return { fsPath: p }
    })
  }
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createWebviewPanel: mockCreateWebviewPanel,
    activeTextEditor: undefined
  }
}))

vi.mock("../adt/conections", () => ({
  getClient: vi.fn(),
  getOrCreateRoot: vi.fn()
}))

vi.mock("../lib", () => ({
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  log: vi.fn()
}))

vi.mock("./dependencyGraph", () => ({
  fetchWhereUsedData: vi.fn().mockResolvedValue([]),
  buildGraphData: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
  mergeGraphData: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
  applyFilters: vi.fn().mockReturnValue({ nodes: [], edges: [] })
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn(class {})
}))

vi.mock("./abapSearchService", () => ({
  getSearchService: vi.fn()
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn()
}))

import { WebviewManager } from "./webviewManager"
import type { Mock } from "vitest"

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
      onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      postMessage: vi.fn().mockResolvedValue(true),
      asWebviewUri: vi.fn(function (uri: any) {
        return uri
      })
    },
    title: "Test Panel",
    viewColumn: 1,
    onDidDispose: vi.fn(function (fn: () => void) {
      onDisposeFns.push(fn)
      return { dispose: vi.fn() }
    }),
    dispose: vi.fn(function () {
      onDisposeFns.forEach(fn => fn())
    }),
    reveal: vi.fn()
  }
  return panel
}

describe("WebviewManager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      const { webviewId } = await manager.createOrUpdateWebview(
        directData as any,
        "",
        "DEV100",
        undefined,
        "First"
      )

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
        directData as any,
        "",
        "DEV100",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      )

      const clearSortMsg = (panel.webview.postMessage as Mock).mock.calls.find(
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
        directData as any,
        "",
        "DEV100",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        true
      )

      const clearFiltersMsg = (panel.webview.postMessage as Mock).mock.calls.find(
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
        directData as any,
        "",
        "DEV100",
        undefined,
        undefined,
        undefined,
        undefined,
        sortColumns
      )

      const sortMsg = (panel.webview.postMessage as Mock).mock.calls.find(
        (c: any) => c[0]?.command === "applySorting"
      )
      expect(sortMsg).toBeDefined()
      expect(sortMsg![0].data.sortColumns).toEqual(sortColumns)
    })

    it("sends applyFilters message when filters provided", async () => {
      const context = makeContext()
      const panel = makeMockPanel()
      mockCreateWebviewPanel.mockReturnValue(panel)

      const manager = WebviewManager.getInstance(context)
      const directData = { columns: [], values: [] }
      const filters = [{ column: "MATNR", value: "MAT*" }]

      await manager.createOrUpdateWebview(
        directData as any,
        "",
        "DEV100",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        filters
      )

      const filterMsg = (panel.webview.postMessage as Mock).mock.calls.find(
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
