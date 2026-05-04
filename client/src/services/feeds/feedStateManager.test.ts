jest.mock("vscode", () => ({
  Uri: { file: (p: string) => ({ fsPath: p }) }
}), { virtual: true })
jest.mock("../../lib", () => ({ log: () => {} }))
jest.mock("fs")
jest.mock("path", () => ({
  join: (...parts: string[]) => parts.join("/")
}))

import * as fs from "fs"
import { FeedStateManager } from "./feedStateManager"
import { FeedEntry, FeedType } from "./feedTypes"

// ---- helpers ----------------------------------------------------------------

function makeContext(storagePath = "/storage") {
  const store: Record<string, any> = {}
  return {
    globalStorageUri: { fsPath: storagePath },
    globalState: {
      get: jest.fn((key: string) => store[key]),
      update: jest.fn(async (key: string, value: any) => {
        store[key] = value
      })
    },
    subscriptions: [] as any[]
  }
}

function makeEntry(overrides: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: "e1",
    systemId: "sys1",
    feedTitle: "Dumps",
    feedPath: "/sap/bc/adt/runtime/dumps/feeds",
    feedType: FeedType.DUMPS,
    timestamp: new Date("2024-01-01T10:00:00Z"),
    title: "Entry 1",
    summary: "Summary",
    isNew: true,
    isRead: false,
    rawData: {},
    ...overrides
  }
}

// ---- setup ------------------------------------------------------------------

let fsMock: jest.Mocked<typeof fs>

beforeEach(() => {
  jest.clearAllMocks()
  fsMock = fs as jest.Mocked<typeof fs>
  // Default: storage dir does not exist, no entries file
  ;(fsMock.existsSync as jest.Mock).mockReturnValue(false)
  ;(fsMock.mkdirSync as jest.Mock).mockReturnValue(undefined)
  ;(fsMock.writeFileSync as jest.Mock).mockReturnValue(undefined)
})

// ---- constructor / init -----------------------------------------------------

describe("FeedStateManager construction", () => {
  test("creates storage directory when it does not exist", () => {
    makeContext()
    // existsSync returns false for the directory
    ;(fsMock.existsSync as jest.Mock).mockReturnValue(false)
    const ctx = makeContext()
    new FeedStateManager(ctx as any)
    expect(fsMock.mkdirSync).toHaveBeenCalledWith("/storage", { recursive: true })
  })

  test("does not create directory when it already exists", () => {
    ;(fsMock.existsSync as jest.Mock).mockReturnValue(true)
    const ctx = makeContext()
    new FeedStateManager(ctx as any)
    expect(fsMock.mkdirSync).not.toHaveBeenCalled()
  })

  test("loads existing states from globalState", () => {
    const ctx = makeContext()
    const existingState = {
      "sys1|Dumps": {
        systemId: "sys1",
        feedTitle: "Dumps",
        feedPath: "/path",
        lastPollTime: 1000,
        lastSeenEntryId: "e1",
        errorCount: 0,
        isAvailable: true
      }
    }
    ;(ctx.globalState.get as jest.Mock).mockReturnValue(existingState)
    const manager = new FeedStateManager(ctx as any)
    expect(manager.getFeedState("sys1", "Dumps")).toEqual(existingState["sys1|Dumps"])
  })

  test("loads entries from file when it exists", () => {
    const ctx = makeContext()
    ;(fsMock.existsSync as jest.Mock).mockImplementation((p: any) => {
      return String(p).includes("feedEntries.json")
    })
    const stored = {
      "sys1|Dumps": [
        {
          id: "e1",
          systemId: "sys1",
          feedTitle: "Dumps",
          feedPath: "/path",
          feedType: FeedType.DUMPS,
          timestamp: "2024-01-01T10:00:00Z",
          title: "Entry",
          summary: "",
          isNew: false,
          isRead: false,
          rawData: {}
        }
      ]
    }
    ;(fsMock.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(stored))
    const manager = new FeedStateManager(ctx as any)
    const entries = manager.getFeedEntries("sys1", "Dumps")
    expect(entries).toHaveLength(1)
    expect(entries[0].timestamp).toBeInstanceOf(Date)
    expect(entries[0].title).toBe("Entry")
  })

  test("handles corrupt entries file gracefully", () => {
    const ctx = makeContext()
    ;(fsMock.existsSync as jest.Mock).mockReturnValue(true)
    ;(fsMock.readFileSync as jest.Mock).mockReturnValue("not json{{")
    const manager = new FeedStateManager(ctx as any)
    // Should not throw; entries should be empty
    expect(manager.getAllFeedEntries()).toHaveLength(0)
  })

  test("uses fallback values for missing entry fields", () => {
    const ctx = makeContext()
    ;(fsMock.existsSync as jest.Mock).mockImplementation((p: any) =>
      String(p).includes("feedEntries.json")
    )
    const stored = {
      "s|f": [{ id: "x", timestamp: "bad-date", rawData: {} }]
    }
    ;(fsMock.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(stored))
    const manager = new FeedStateManager(ctx as any)
    const entries = manager.getFeedEntries("s", "f")
    expect(entries[0].title).toBe("Untitled")
    expect(entries[0].summary).toBe("")
    expect(entries[0].systemId).toBe("")
    expect(entries[0].feedTitle).toBe("")
  })
})

// ---- getFeedState / updateFeedState -----------------------------------------

describe("getFeedState / updateFeedState", () => {
  test("returns undefined for unknown feed", () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    expect(manager.getFeedState("sys1", "NonExistent")).toBeUndefined()
  })

  test("creates new state on first updateFeedState call", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.updateFeedState({ systemId: "sys1", feedTitle: "ATC", feedPath: "/atc" })
    const state = manager.getFeedState("sys1", "ATC")
    expect(state).toBeDefined()
    expect(state!.systemId).toBe("sys1")
    expect(state!.feedTitle).toBe("ATC")
    expect(state!.errorCount).toBe(0)
    expect(state!.isAvailable).toBe(true)
  })

  test("merges partial updates with existing state", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.updateFeedState({ systemId: "s", feedTitle: "f", feedPath: "/p", errorCount: 2 })
    await manager.updateFeedState({ systemId: "s", feedTitle: "f", errorCount: 5 })
    expect(manager.getFeedState("s", "f")!.errorCount).toBe(5)
    expect(manager.getFeedState("s", "f")!.feedPath).toBe("/p")
  })

  test("persists state to globalState.update", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.updateFeedState({ systemId: "s", feedTitle: "f" })
    expect(ctx.globalState.update).toHaveBeenCalled()
  })
})

// ---- updateLastPoll ---------------------------------------------------------

describe("updateLastPoll", () => {
  test("updates lastPollTime to current timestamp", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    const before = Date.now()
    await manager.updateLastPoll("sys1", "Dumps")
    const after = Date.now()
    const state = manager.getFeedState("sys1", "Dumps")
    expect(state!.lastPollTime).toBeGreaterThanOrEqual(before)
    expect(state!.lastPollTime).toBeLessThanOrEqual(after)
  })
})

// ---- updateLastSeen ---------------------------------------------------------

describe("updateLastSeen", () => {
  test("stores the last-seen entry id", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.updateLastSeen("sys1", "Dumps", "entry-99")
    expect(manager.getFeedState("sys1", "Dumps")!.lastSeenEntryId).toBe("entry-99")
  })
})

// ---- incrementErrorCount / resetErrorCount ----------------------------------

describe("incrementErrorCount / resetErrorCount", () => {
  test("starts at 0 and increments", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.incrementErrorCount("s", "f", "timeout")
    expect(manager.getFeedState("s", "f")!.errorCount).toBe(1)
    await manager.incrementErrorCount("s", "f", "timeout2")
    expect(manager.getFeedState("s", "f")!.errorCount).toBe(2)
  })

  test("stores last error message", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.incrementErrorCount("s", "f", "connection refused")
    expect(manager.getFeedState("s", "f")!.lastError).toBe("connection refused")
  })

  test("resets error count to 0 and clears error", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.incrementErrorCount("s", "f", "err")
    await manager.resetErrorCount("s", "f")
    const state = manager.getFeedState("s", "f")!
    expect(state.errorCount).toBe(0)
    expect(state.lastError).toBeUndefined()
  })
})

// ---- markFeedUnavailable / markFeedAvailable --------------------------------

describe("markFeedUnavailable / markFeedAvailable", () => {
  test("sets isAvailable to false", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.markFeedUnavailable("s", "f")
    expect(manager.getFeedState("s", "f")!.isAvailable).toBe(false)
  })

  test("sets isAvailable back to true", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.markFeedUnavailable("s", "f")
    await manager.markFeedAvailable("s", "f")
    expect(manager.getFeedState("s", "f")!.isAvailable).toBe(true)
  })
})

// ---- getFeedEntries / getAllFeedEntries -------------------------------------

describe("getFeedEntries / getAllFeedEntries", () => {
  test("returns empty array when no entries", () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    expect(manager.getFeedEntries("s", "f")).toEqual([])
  })

  test("getAllFeedEntries returns entries from all feeds sorted by timestamp desc", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    const older = makeEntry({ id: "old", timestamp: new Date("2024-01-01") })
    const newer = makeEntry({ id: "new", timestamp: new Date("2024-06-01") })
    await manager.addFeedEntries("s", "f1", [older])
    await manager.addFeedEntries("s", "f2", [newer])
    const all = manager.getAllFeedEntries()
    expect(all[0].id).toBe("new")
    expect(all[1].id).toBe("old")
  })

  test("getAllFeedEntries returns empty when no feeds", () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    expect(manager.getAllFeedEntries()).toEqual([])
  })
})

// ---- getUnreadEntries / getAllUnreadEntries ----------------------------------

describe("getUnreadEntries / getAllUnreadEntries", () => {
  test("returns only unread entries for specific feed", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [
      makeEntry({ id: "e1", isRead: false }),
      makeEntry({ id: "e2", isRead: true })
    ])
    expect(manager.getUnreadEntries("s", "f")).toHaveLength(1)
    expect(manager.getUnreadEntries("s", "f")[0].id).toBe("e1")
  })

  test("getAllUnreadEntries aggregates across all feeds", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f1", [makeEntry({ id: "a", isRead: false })])
    await manager.addFeedEntries("s", "f2", [makeEntry({ id: "b", isRead: true })])
    expect(manager.getAllUnreadEntries()).toHaveLength(1)
    expect(manager.getAllUnreadEntries()[0].id).toBe("a")
  })
})

// ---- addFeedEntries ---------------------------------------------------------

describe("addFeedEntries", () => {
  test("adds new entries", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [makeEntry({ id: "e1" })])
    expect(manager.getFeedEntries("s", "f")).toHaveLength(1)
  })

  test("deduplicates entries by id", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [makeEntry({ id: "e1" })])
    await manager.addFeedEntries("s", "f", [makeEntry({ id: "e1" }), makeEntry({ id: "e2" })])
    expect(manager.getFeedEntries("s", "f")).toHaveLength(2)
  })

  test("sorts entries by timestamp newest first", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    const e1 = makeEntry({ id: "old", timestamp: new Date("2024-01-01") })
    const e2 = makeEntry({ id: "new", timestamp: new Date("2024-06-01") })
    await manager.addFeedEntries("s", "f", [e1, e2])
    const entries = manager.getFeedEntries("s", "f")
    expect(entries[0].id).toBe("new")
    expect(entries[1].id).toBe("old")
  })

  test("persists entries to file", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [makeEntry()])
    expect(fsMock.writeFileSync).toHaveBeenCalled()
  })
})

// ---- markAsRead -------------------------------------------------------------

describe("markAsRead", () => {
  test("marks specific entry as read and not new", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [makeEntry({ id: "e1", isRead: false, isNew: true })])
    await manager.markAsRead("s", "f", "e1")
    const entry = manager.getFeedEntries("s", "f")[0]
    expect(entry.isRead).toBe(true)
    expect(entry.isNew).toBe(false)
  })

  test("does nothing for unknown systemId/feedTitle", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    // Should not throw
    await expect(manager.markAsRead("unknown", "unknown", "e1")).resolves.toBeUndefined()
  })

  test("does nothing for unknown entry id", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [makeEntry({ id: "e1" })])
    await manager.markAsRead("s", "f", "nonexistent")
    // Entry e1 should remain unchanged
    expect(manager.getFeedEntries("s", "f")[0].isRead).toBe(false)
  })
})

// ---- markAllAsRead ----------------------------------------------------------

describe("markAllAsRead", () => {
  test("marks every entry in the feed as read", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [
      makeEntry({ id: "e1", isRead: false }),
      makeEntry({ id: "e2", isRead: false })
    ])
    await manager.markAllAsRead("s", "f")
    const entries = manager.getFeedEntries("s", "f")
    expect(entries.every(e => e.isRead)).toBe(true)
    expect(entries.every(e => !e.isNew)).toBe(true)
  })

  test("does nothing for missing feed", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await expect(manager.markAllAsRead("s", "noexist")).resolves.toBeUndefined()
  })
})

// ---- markAllEntriesAsRead ---------------------------------------------------

describe("markAllEntriesAsRead", () => {
  test("marks every entry across all feeds as read", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f1", [makeEntry({ id: "a", isRead: false })])
    await manager.addFeedEntries("s", "f2", [makeEntry({ id: "b", isRead: false })])
    await manager.markAllEntriesAsRead()
    expect(manager.getAllFeedEntries().every(e => e.isRead)).toBe(true)
  })
})

// ---- removeEntry ------------------------------------------------------------

describe("removeEntry", () => {
  test("removes specific entry from feed", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [
      makeEntry({ id: "e1" }),
      makeEntry({ id: "e2" })
    ])
    await manager.removeEntry("s", "f", "e1")
    const entries = manager.getFeedEntries("s", "f")
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe("e2")
  })

  test("does nothing for missing systemId/feedTitle", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await expect(manager.removeEntry("ghost", "ghost", "e1")).resolves.toBeUndefined()
  })
})

// ---- clearFeedEntries / clearAllEntries -------------------------------------

describe("clearFeedEntries / clearAllEntries", () => {
  test("clears entries for a specific feed", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [makeEntry()])
    await manager.clearFeedEntries("s", "f")
    expect(manager.getFeedEntries("s", "f")).toHaveLength(0)
  })

  test("clearAllEntries removes all entries", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f1", [makeEntry({ id: "a" })])
    await manager.addFeedEntries("s", "f2", [makeEntry({ id: "b" })])
    await manager.clearAllEntries()
    expect(manager.getAllFeedEntries()).toHaveLength(0)
  })
})

// ---- getStatistics ----------------------------------------------------------

describe("getStatistics", () => {
  test("returns correct totals", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [
      makeEntry({ id: "e1", isRead: false, isNew: true }),
      makeEntry({ id: "e2", isRead: true, isNew: false }),
      makeEntry({ id: "e3", isRead: false, isNew: false })
    ])
    const stats = manager.getStatistics()
    expect(stats.totalEntries).toBe(3)
    expect(stats.unreadEntries).toBe(2)
    expect(stats.newEntries).toBe(1)
  })

  test("returns zeros when no entries", () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    expect(manager.getStatistics()).toEqual({ totalEntries: 0, unreadEntries: 0, newEntries: 0 })
  })
})

// ---- getFeedStatistics ------------------------------------------------------

describe("getFeedStatistics", () => {
  test("returns per-feed stats", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.addFeedEntries("s", "f", [
      makeEntry({ id: "e1", isRead: false, isNew: true }),
      makeEntry({ id: "e2", isRead: true, isNew: false })
    ])
    const stats = manager.getFeedStatistics("s", "f")
    expect(stats.total).toBe(2)
    expect(stats.unread).toBe(1)
    expect(stats.new).toBe(1)
  })
})

// ---- isNewEntry -------------------------------------------------------------

describe("isNewEntry", () => {
  test("returns true when no state exists (never polled)", () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    expect(manager.isNewEntry("s", "f", "any-id")).toBe(true)
  })

  test("returns false when entry matches lastSeenEntryId", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.updateLastSeen("s", "f", "seen-id")
    expect(manager.isNewEntry("s", "f", "seen-id")).toBe(false)
  })

  test("returns true when entry does not match lastSeenEntryId", async () => {
    const ctx = makeContext()
    const manager = new FeedStateManager(ctx as any)
    await manager.updateLastSeen("s", "f", "seen-id")
    expect(manager.isNewEntry("s", "f", "other-id")).toBe(true)
  })
})
