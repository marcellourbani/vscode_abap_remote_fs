vi.mock("vscode", () => {
  const EventEmitter = vi.fn().mockImplementation(function () {
    return {
      event: vi.fn(),
      fire: vi.fn(),
      dispose: vi.fn()
    }
  })

  class TreeItem {
    label: string
    collapsibleState: any
    contextValue: string | undefined = undefined
    description: string | undefined = undefined
    tooltip: string | undefined = undefined
    command: any = undefined
    iconPath: any = undefined
    constructor(label: string, collapsibleState?: any) {
      this.label = label
      this.collapsibleState = collapsibleState
    }
  }

  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    ViewColumn: { Active: 1 },
    ThemeIcon: vi.fn().mockImplementation(function (id: string) {
      return { id }
    }),
    commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
    Uri: { file: (p: string) => ({ fsPath: p }) }
  }
})

vi.mock("../../lib", () => ({ log: () => {} }))
vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    createWebviewPanel: vi.fn(),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined)
  }
}))
vi.mock("../../commands", () => ({
  AbapFsCommands: { viewFeedEntry: "abapfs.viewFeedEntry" },
  command: vi.fn()
}))
vi.mock("../../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      displayAdtUri: vi.fn()
    }
  })
}))
vi.mock("../../services/feeds/feedParsers", () => ({
  getFeedTypeIcon: vi.fn(function () {
    return "bug"
  }),
  getSeverityIcon: vi.fn(function () {
    return "warning"
  })
}))
vi.mock("fs")
vi.mock("path", () => ({ join: (...parts: string[]) => parts.join("/") }))

import { FeedInboxProvider } from "./feedInboxView"
import { FeedStateManager } from "../../services/feeds/feedStateManager"
import { type FeedEntry, FeedType } from "../../services/feeds/feedTypes"
import * as fs from "fs"
import * as __$mock_vscode from "vscode"
import * as __$mock_services_funMessenger from "../../services/funMessenger"
import type { Mock } from "vitest"

// ---- helpers ----------------------------------------------------------------

function makeContext() {
  return {
    globalStorageUri: { fsPath: "/storage" },
    globalState: {
      get: vi.fn(),
      update: vi.fn(function () {})
    },
    subscriptions: [] as any[]
  }
}

function makeStateManager(ctx: any): FeedStateManager {
  ;(fs.existsSync as Mock).mockReturnValue(false)
  ;(fs.mkdirSync as Mock).mockReturnValue(undefined)
  return new FeedStateManager(ctx as any)
}

function makeEntry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: "e1",
    systemId: "sys1",
    feedTitle: "Dumps",
    feedPath: "/sap/bc/adt/runtime/dumps/feeds",
    feedType: FeedType.DUMPS,
    timestamp: new Date("2024-06-01T10:00:00Z"),
    title: "Test Entry",
    summary: "Summary text",
    isNew: true,
    isRead: false,
    rawData: {},
    ...overrides
  }
}

// ---- FeedInboxProvider construction -----------------------------------------

describe("FeedInboxProvider construction", () => {
  beforeEach(() => vi.clearAllMocks())

  test("can be instantiated with a state manager", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    expect(provider).toBeDefined()
  })

  test("exposes onDidChangeTreeData event", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    expect(provider.onDidChangeTreeData).toBeDefined()
  })
})

// ---- refresh ----------------------------------------------------------------

describe("FeedInboxProvider.refresh", () => {
  beforeEach(() => vi.clearAllMocks())

  test("fires the onDidChangeTreeData event", () => {
    const { EventEmitter } = __$mock_vscode
    const fireMock = vi.fn()
    ;(EventEmitter as Mock).mockImplementationOnce(function () {
      return {
        event: vi.fn(),
        fire: fireMock,
        dispose: vi.fn()
      }
    })
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    provider.refresh()
    expect(fireMock).toHaveBeenCalled()
  })
})

// ---- getTreeItem ------------------------------------------------------------

describe("FeedInboxProvider.getTreeItem", () => {
  beforeEach(() => vi.clearAllMocks())

  test("returns the element itself for valid tree items", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    const fakeNode = { label: "test", tag: "system" } as any
    const result = provider.getTreeItem(fakeNode)
    expect(result).toBe(fakeNode)
  })

  test("returns a fallback TreeItem for undefined/null element", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    const result = provider.getTreeItem(undefined as any)
    expect(result).toBeDefined()
  })
})

// ---- getChildren: root level ------------------------------------------------

describe("FeedInboxProvider.getChildren at root level", () => {
  beforeEach(() => vi.clearAllMocks())

  test("returns empty array when no entries", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    const children = await provider.getChildren(undefined)
    expect(children).toEqual([])
  })

  test("returns system nodes when entries exist", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ systemId: "sys1" })])
    const provider = new FeedInboxProvider(sm)
    const children = await provider.getChildren(undefined)
    expect(children.length).toBeGreaterThan(0)
  })

  test("returns multiple system nodes for multiple systems", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ systemId: "sys1" })])
    await sm.addFeedEntries("sys2", "ATC", [
      makeEntry({ id: "e2", systemId: "sys2", feedTitle: "ATC" })
    ])
    const provider = new FeedInboxProvider(sm)
    const children = await provider.getChildren(undefined)
    expect(children.length).toBe(2)
  })

  test("filters out entries with no systemId", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    // Add valid entry
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ systemId: "sys1" })])
    const provider = new FeedInboxProvider(sm)
    // Manually inject an invalid entry into getAllFeedEntries via vi.spyOn
    vi.spyOn(sm, "getAllFeedEntries").mockReturnValue([
      makeEntry({ systemId: "" }),
      makeEntry({ id: "valid", systemId: "sys1" })
    ])
    const children = await provider.getChildren(undefined)
    // Only sys1 node should appear
    expect(children.length).toBe(1)
  })
})

// ---- getChildren: system level ----------------------------------------------

describe("FeedInboxProvider.getChildren for system node", () => {
  beforeEach(() => vi.clearAllMocks())

  test("returns feed folder nodes for system entries", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ systemId: "sys1" })])
    const provider = new FeedInboxProvider(sm)

    const rootChildren = await provider.getChildren(undefined)
    const systemNode = rootChildren[0]
    const feedFolders = await provider.getChildren(systemNode)
    expect(feedFolders.length).toBeGreaterThan(0)
    expect((feedFolders[0] as any).tag).toBe("feedFolder")
  })

  test("returns empty array for system with no entries", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ systemId: "sys1" })])
    const provider = new FeedInboxProvider(sm)

    const rootChildren = await provider.getChildren(undefined)
    // Spy to return no entries for this system
    vi.spyOn(sm, "getAllFeedEntries").mockReturnValue([])
    const feedFolders = await provider.getChildren(rootChildren[0])
    expect(feedFolders).toEqual([])
  })
})

// ---- getChildren: feed folder level -----------------------------------------

describe("FeedInboxProvider.getChildren for feed folder node", () => {
  beforeEach(() => vi.clearAllMocks())

  test("returns entry nodes for each feed entry", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ id: "e1" }), makeEntry({ id: "e2" })])
    const provider = new FeedInboxProvider(sm)

    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    const entries = await provider.getChildren(folders[0])
    expect(entries.length).toBe(2)
    expect((entries[0] as any).tag).toBe("feedEntry")
  })

  test("sorts entries newest first", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const older = makeEntry({ id: "old", timestamp: new Date("2024-01-01") })
    const newer = makeEntry({ id: "new", timestamp: new Date("2024-06-01") })
    await sm.addFeedEntries("sys1", "Dumps", [older, newer])
    const provider = new FeedInboxProvider(sm)

    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    const entries = await provider.getChildren(folders[0])
    expect((entries[0] as any).entry.id).toBe("new")
    expect((entries[1] as any).entry.id).toBe("old")
  })
})

// ---- getChildren: entry level -----------------------------------------------

describe("FeedInboxProvider.getChildren for entry node", () => {
  beforeEach(() => vi.clearAllMocks())

  test("returns empty array (leaf node)", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry()])
    const provider = new FeedInboxProvider(sm)

    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    const entries = await provider.getChildren(folders[0])
    const leafChildren = await provider.getChildren(entries[0])
    expect(leafChildren).toEqual([])
  })
})

// ---- markAllAsRead ----------------------------------------------------------

describe("FeedInboxProvider.markAllAsRead", () => {
  beforeEach(() => vi.clearAllMocks())

  test("delegates to stateManager and refreshes", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: false })])
    const provider = new FeedInboxProvider(sm)
    const markSpy = vi.spyOn(sm, "markAllEntriesAsRead")
    const refreshSpy = vi.spyOn(provider, "refresh")

    await provider.markAllAsRead()
    expect(markSpy).toHaveBeenCalled()
    expect(refreshSpy).toHaveBeenCalled()
  })
})

// ---- markFeedFolderAsRead ---------------------------------------------------

describe("FeedInboxProvider.markFeedFolderAsRead", () => {
  beforeEach(() => vi.clearAllMocks())

  test("calls markAllAsRead on stateManager for the feed and refreshes", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: false })])
    const provider = new FeedInboxProvider(sm)
    const markSpy = vi.spyOn(sm, "markAllAsRead")
    const refreshSpy = vi.spyOn(provider, "refresh")

    await provider.markFeedFolderAsRead({ systemId: "sys1", feedTitle: "Dumps" })
    expect(markSpy).toHaveBeenCalledWith("sys1", "Dumps")
    expect(refreshSpy).toHaveBeenCalled()
  })
})

// ---- deleteFeedEntry --------------------------------------------------------

describe("FeedInboxProvider.deleteFeedEntry", () => {
  beforeEach(() => vi.clearAllMocks())

  test("removes the entry and refreshes", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ id: "e1" })])
    const provider = new FeedInboxProvider(sm)
    const removeSpy = vi.spyOn(sm, "removeEntry")
    const refreshSpy = vi.spyOn(provider, "refresh")

    await provider.deleteFeedEntry({ entry: makeEntry({ id: "e1" }) })
    expect(removeSpy).toHaveBeenCalledWith("sys1", "Dumps", "e1")
    expect(refreshSpy).toHaveBeenCalled()
  })

  test("handles plain entry object (not wrapped in .entry)", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ id: "e1" })])
    const provider = new FeedInboxProvider(sm)
    const removeSpy = vi.spyOn(sm, "removeEntry")

    await provider.deleteFeedEntry(makeEntry({ id: "e1" }))
    expect(removeSpy).toHaveBeenCalledWith("sys1", "Dumps", "e1")
  })
})

// ---- clearFeedFolder --------------------------------------------------------

describe("FeedInboxProvider.clearFeedFolder", () => {
  beforeEach(() => vi.clearAllMocks())

  test("prompts user and clears if confirmed", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showWarningMessage as Mock).mockResolvedValue("Clear")

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry()])
    const provider = new FeedInboxProvider(sm)
    const clearSpy = vi.spyOn(sm, "clearFeedEntries")
    const refreshSpy = vi.spyOn(provider, "refresh")

    await provider.clearFeedFolder({ systemId: "sys1", feedTitle: "Dumps" })
    expect(clearSpy).toHaveBeenCalledWith("sys1", "Dumps")
    expect(refreshSpy).toHaveBeenCalled()
  })

  test("does not clear when user cancels", async () => {
    const { funWindow: w } = __$mock_services_funMessenger
    ;(w.showWarningMessage as Mock).mockResolvedValue("Cancel")

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry()])
    const provider = new FeedInboxProvider(sm)
    const clearSpy = vi.spyOn(sm, "clearFeedEntries")

    await provider.clearFeedFolder({ systemId: "sys1", feedTitle: "Dumps" })
    expect(clearSpy).not.toHaveBeenCalled()
  })
})

// ---- showFeedInbox ----------------------------------------------------------

describe("FeedInboxProvider.showFeedInbox", () => {
  beforeEach(() => vi.clearAllMocks())

  test("refreshes and executes focus command", async () => {
    const { commands } = __$mock_vscode
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)
    const refreshSpy = vi.spyOn(provider, "refresh")

    await provider.showFeedInbox()
    expect(refreshSpy).toHaveBeenCalled()
    expect(commands.executeCommand).toHaveBeenCalledWith("abapfs.feedInbox.focus")
  })

  test("falls back to workbench view when focus command fails", async () => {
    const { commands } = __$mock_vscode
    ;(commands.executeCommand as Mock)
      .mockRejectedValueOnce(new Error("no focus command"))
      .mockResolvedValue(undefined)

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const provider = new FeedInboxProvider(sm)

    await provider.showFeedInbox()
    expect(commands.executeCommand).toHaveBeenCalledWith("workbench.view.extension.abapfs")
  })
})

// ---- system node label with unread indicator --------------------------------

describe("SystemFeedNode label generation", () => {
  beforeEach(() => vi.clearAllMocks())

  test("system node has dot indicator and unread description when entries are unread", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: false })])
    const provider = new FeedInboxProvider(sm)
    const roots = await provider.getChildren(undefined)
    // SystemFeedNode label should contain "●"
    expect(String((roots[0] as any).label)).toContain("●")
    expect((roots[0] as any).description).toContain("new")
  })

  test("system node has no dot indicator when all entries are read", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: true })])
    const provider = new FeedInboxProvider(sm)
    const roots = await provider.getChildren(undefined)
    expect(String((roots[0] as any).label)).not.toContain("●")
  })
})

// ---- feed folder node label with unread indicator ---------------------------

describe("FeedFolderNode label generation", () => {
  beforeEach(() => vi.clearAllMocks())

  test("folder node has dot and description when unread entries exist", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: false })])
    const provider = new FeedInboxProvider(sm)
    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    expect(String((folders[0] as any).label)).toContain("●")
    expect((folders[0] as any).description).toContain("new")
  })

  test("folder node shows total when all read", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: true })])
    const provider = new FeedInboxProvider(sm)
    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    expect(String((folders[0] as any).description)).toContain("total")
  })
})

// ---- FeedEntryNode ----------------------------------------------------------

describe("FeedEntryNode", () => {
  beforeEach(() => vi.clearAllMocks())

  test("unread entry has dot indicator prefix", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: false, title: "My Entry" })])
    const provider = new FeedInboxProvider(sm)
    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    const entries = await provider.getChildren(folders[0])
    expect(String((entries[0] as any).label)).toContain("●")
    expect(String((entries[0] as any).label)).toContain("My Entry")
  })

  test("read entry has no dot indicator", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry({ isRead: true, title: "My Entry" })])
    const provider = new FeedInboxProvider(sm)
    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    const entries = await provider.getChildren(folders[0])
    expect(String((entries[0] as any).label)).not.toContain("●")
  })

  test("entry node has a command to view it", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    await sm.addFeedEntries("sys1", "Dumps", [makeEntry()])
    const provider = new FeedInboxProvider(sm)
    const root = await provider.getChildren(undefined)
    const folders = await provider.getChildren(root[0])
    const entries = await provider.getChildren(folders[0])
    expect((entries[0] as any).command?.command).toBe("abapfs.viewFeedEntry")
  })
})
