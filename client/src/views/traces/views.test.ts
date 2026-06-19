// Tests for views/traces/views.ts - TraceRunItem and tracesProvider
jest.mock("vscode", () => {
  const MarkdownString = class {
    constructor(public value = "") {}
  }
  const ThemeIcon = class { constructor(public id: string) {} }
  const TreeItem = class {
    constructor(public label: string, public collapsibleState?: number) {}
    tooltip: any
    command: any
    iconPath: any
    id: any
    contextValue: any
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 }
  const EventEmitter = class {
    event = jest.fn()
    fire = jest.fn()
  }
  const Uri = {
    parse: jest.fn((s: string) => ({ toString: () => s, path: s }))
  }
  return { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState, EventEmitter, Uri }
}, { virtual: true })

jest.mock("../../config", () => ({
  connectedRoots: jest.fn(() => new Map([["DEV100", {}], ["QA100", {}]]))
}))

jest.mock("../../adt/conections", () => ({
  getOrCreateClient: jest.fn()
}))

jest.mock("../../lib", () => ({
  cache: jest.fn((fn: Function) => {
    const map = new Map()
    return {
      get: (k: any) => {
        if (!map.has(k)) map.set(k, fn(k))
        return map.get(k)
      },
      size: 0,
      [Symbol.iterator]: function* () {}
    }
  })
}))

jest.mock("./commands", () => ({
  openCommand: jest.fn((uri: any) => ({ command: "open", title: "open", arguments: [uri] }))
}))

jest.mock("./fsProvider", () => ({
  adtProfileUri: jest.fn((item: any) => `adt://profile/${item.id}`)
}))

import { TraceRunItem, tracesProvider, findRun } from "./views"

const makeTraceRun = (overrides: Partial<any> = {}): any => ({
  id: "run-001",
  title: "My Trace",
  published: new Date("2025-01-15T10:00:00Z"),
  author: "DEV",
  type: "ABAP",
  extendedData: {
    runtime: 500,
    host: "server01",
    objectName: "ZREPORT",
    runtimeABAP: 300,
    runtimeDatabase: 100,
    runtimeSystem: 100,
    isAggregated: false,
    state: { text: "OK", value: "S" },
    system: "DEV100"
  },
  ...overrides
})

describe("TraceRunItem", () => {
  describe("constructor - successful run", () => {
    it("creates an item with a label containing title and objectName", () => {
      const run = makeTraceRun()
      const item = new TraceRunItem("DEV100", run)
      expect(item.label).toContain("My Trace")
      expect(item.label).toContain("ZREPORT")
    })

    it("sets contextValue to 'run'", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.contextValue).toBe("run")
    })

    it("sets id from run.id", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.id).toBe("run-001")
    })

    it("marks error=false for successful run (state value='S')", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.error).toBe(false)
    })

    it("marks detailed=true when isAggregated=false", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.detailed).toBe(true)
    })

    it("sets command for non-error run", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.command).toBeDefined()
    })

    it("sets tooltip", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.tooltip).toBeDefined()
    })
  })

  describe("constructor - error run", () => {
    it("marks error=true when state value='E'", () => {
      const run = makeTraceRun({
        extendedData: { ...makeTraceRun().extendedData, state: { text: "Error", value: "E" } }
      })
      const item = new TraceRunItem("DEV100", run)
      expect(item.error).toBe(true)
    })

    it("does not set command for error run", () => {
      const run = makeTraceRun({
        extendedData: { ...makeTraceRun().extendedData, state: { text: "Error", value: "E" } }
      })
      const item = new TraceRunItem("DEV100", run)
      expect(item.command).toBeUndefined()
    })
  })

  describe("constructor - aggregated run", () => {
    it("marks detailed=false when isAggregated=true", () => {
      const run = makeTraceRun({
        extendedData: { ...makeTraceRun().extendedData, isAggregated: true }
      })
      const item = new TraceRunItem("DEV100", run)
      expect(item.detailed).toBe(false)
    })
  })

  describe("children", () => {
    it("returns empty array", () => {
      const item = new TraceRunItem("DEV100", makeTraceRun())
      expect(item.children()).toEqual([])
    })
  })
})

describe("tracesProvider", () => {
  describe("getTreeItem", () => {
    it("returns the element as-is", () => {
      const run = makeTraceRun()
      const item = new TraceRunItem("DEV100", run)
      expect(tracesProvider.getTreeItem(item)).toBe(item)
    })
  })

  describe("onDidChangeTreeData", () => {
    it("exposes an event", () => {
      expect(tracesProvider.onDidChangeTreeData).toBeDefined()
    })
  })

  describe("getChildren", () => {
    it("returns children of element when provided", async () => {
      const run = makeTraceRun()
      const item = new TraceRunItem("DEV100", run)
      const children = await tracesProvider.getChildren(item)
      expect(Array.isArray(children)).toBe(true)
    })

    it("returns root items when no element provided", async () => {
      const roots = await tracesProvider.getChildren()
      expect(Array.isArray(roots)).toBe(true)
      expect(roots.length).toBeGreaterThan(0)
    })
  })

  describe("root", () => {
    it("finds a root by connId", () => {
      const root = tracesProvider.root("DEV100")
      expect(root).toBeDefined()
      expect(root?.connId).toBe("DEV100")
    })

    it("returns undefined for unknown connId", () => {
      expect(tracesProvider.root("UNKNOWN")).toBeUndefined()
    })
  })
})

describe("findRun", () => {
  it("returns undefined when client is not connected and no runs cached", async () => {
    const { getOrCreateClient } = require("../../adt/conections")
    ;(getOrCreateClient as jest.Mock).mockResolvedValue({
      tracesList: jest.fn().mockResolvedValue({ runs: [] })
    })

    const result = await findRun("DEV100", "nonexistent")
    expect(result).toBeUndefined()
  })
})
