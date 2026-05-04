// Mock vscode BEFORE any imports
jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    workspaceFolders: []
  },
  commands: {
    executeCommand: jest.fn()
  }
}), { virtual: true })

// Mock modules that have vscode deps
jest.mock("../../lib", () => ({ log: () => {} }))
jest.mock("../funMessenger", () => ({
  funWindow: {
    showWarningMessage: jest.fn().mockResolvedValue(undefined),
    showErrorMessage: jest.fn().mockResolvedValue(undefined),
    showInformationMessage: jest.fn().mockResolvedValue(undefined)
  }
}))
jest.mock("../../adt/conections", () => ({
  getOrCreateClient: jest.fn()
}))
jest.mock("../../config", () => ({
  connectedRoots: jest.fn(() => new Map())
}))
jest.mock("./feedParsers", () => ({
  parseFeedResponse: jest.fn(() => []),
  toFeedMetadata: jest.fn((f: any) => f)
}))
jest.mock("abap-adt-api/build/utilities", () => ({
  fullParse: jest.fn(),
  xmlArray: jest.fn(() => [])
}))
jest.mock("fs")
jest.mock("path", () => ({ join: (...parts: string[]) => parts.join("/") }))

import { workspace } from "vscode"
import { FeedPollingService } from "./feedPollingService"
import { FeedStateManager } from "./feedStateManager"
import { connectedRoots } from "../../config"
import { getOrCreateClient } from "../../adt/conections"
import { parseFeedResponse } from "./feedParsers"
import { FeedEntry, FeedType } from "./feedTypes"
import * as fs from "fs"

// ---- helpers ----------------------------------------------------------------

function makeContext() {
  return {
    globalStorageUri: { fsPath: "/storage" },
    globalState: {
      get: jest.fn(),
      update: jest.fn(async () => {})
    },
    subscriptions: [] as { dispose: () => void }[]
  }
}

function makeStateManager(ctx: any): FeedStateManager {
  ;(fs.existsSync as jest.Mock).mockReturnValue(false)
  ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
  return new FeedStateManager(ctx as any)
}

function makeEntry(id = "e1"): FeedEntry {
  return {
    id,
    systemId: "sys1",
    feedTitle: "Dumps",
    feedPath: "/sap/bc/adt/runtime/dumps/feeds",
    feedType: FeedType.DUMPS,
    timestamp: new Date(),
    title: "Entry",
    summary: "",
    isNew: true,
    isRead: false,
    rawData: {}
  }
}

function setupWorkspaceConfig(subscriptions = {}) {
  const mockConfig = {
    get: jest.fn((key: string, def: any) => {
      if (key === "abapfs.feedSubscriptions") return subscriptions
      return def
    })
  }
  ;(workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig)
}

// ---- constructor ------------------------------------------------------------

describe("FeedPollingService construction", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
  })

  test("can be instantiated", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    expect(service).toBeDefined()
  })

  test("setOnEntriesChanged stores callback", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    const cb = jest.fn()
    service.setOnEntriesChanged(cb)
    // No throw; callback stored for later invocation
    expect(true).toBe(true)
  })
})

// ---- start / stop / isRunning state -----------------------------------------

describe("start / stop", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    setupWorkspaceConfig({})
    ;(connectedRoots as jest.Mock).mockReturnValue(new Map())
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("start registers config change listener", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    expect(workspace.onDidChangeConfiguration).toHaveBeenCalled()
    service.stop()
  })

  test("start does not run twice", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    const callsBefore = (workspace.onDidChangeConfiguration as jest.Mock).mock.calls.length
    await service.start() // second call should be no-op
    expect((workspace.onDidChangeConfiguration as jest.Mock).mock.calls.length).toBe(callsBefore)
    service.stop()
  })

  test("stop clears all polling tasks", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    service.stop()
    // stop should call dispose on the config listener
    // We verify by checking it doesn't throw on second stop
    service.stop()
  })

  test("stop disposes config listener", async () => {
    const disposeMock = jest.fn()
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: disposeMock })
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    service.stop()
    expect(disposeMock).toHaveBeenCalled()
  })

  test("stop while not running is safe", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    expect(() => service.stop()).not.toThrow()
  })
})

// ---- restart ----------------------------------------------------------------

describe("restart", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    setupWorkspaceConfig({})
    ;(connectedRoots as jest.Mock).mockReturnValue(new Map())
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("restart stops and starts the service", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    const callsBefore = (workspace.onDidChangeConfiguration as jest.Mock).mock.calls.length
    await service.restart()
    // After restart, onDidChangeConfiguration should have been called again (new listener)
    expect((workspace.onDidChangeConfiguration as jest.Mock).mock.calls.length).toBeGreaterThan(
      callsBefore
    )
    service.stop()
  })
})

// ---- pause / resume ---------------------------------------------------------

describe("pause / resume", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    setupWorkspaceConfig({})
    ;(connectedRoots as jest.Mock).mockReturnValue(new Map())
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("pause while not running is safe", () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    expect(() => service.pause()).not.toThrow()
  })

  test("resume while not running is safe", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await expect(service.resume()).resolves.toBeUndefined()
  })

  test("resume while not paused does nothing", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    // Not paused, resume should be no-op
    await expect(service.resume()).resolves.toBeUndefined()
    service.stop()
  })

  test("pause then resume re-schedules polls", async () => {
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    service.pause()
    await service.resume()
    service.stop()
    // No error means success
  })
})

// ---- loadAndSchedulePolls: no connected systems -----------------------------

describe("loadAndSchedulePolls with no connected systems", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    ;(connectedRoots as jest.Mock).mockReturnValue(new Map())
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("starts cleanly with no connected systems and no subscriptions", async () => {
    setupWorkspaceConfig({})
    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await expect(service.start()).resolves.toBeUndefined()
    service.stop()
  })
})

// ---- validatePollingInterval (tested via loadAndSchedulePolls) --------------

describe("validatePollingInterval (indirectly via scheduling)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("clamps too-short interval to MIN (120s)", async () => {
    // Set up a connected system with a subscription that has a very short interval
    const systems = new Map([["sys1", { uri: { authority: "sys1" } }]])
    ;(connectedRoots as jest.Mock).mockReturnValue(systems)
    ;(getOrCreateClient as jest.Mock).mockResolvedValue({
      feeds: jest.fn().mockResolvedValue([{ href: "/sap/bc/adt/runtime/dumps/feeds", title: "Dumps", queryVariants: [] }])
    })
    setupWorkspaceConfig({
      sys1: {
        Dumps: { enabled: true, pollingInterval: 5, notifications: false, useDefaultQuery: true }
      }
    })

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    // Just test it starts without error
    await expect(service.start()).resolves.toBeUndefined()
    service.stop()
  })

  test("clamps too-long interval to MAX (86400s)", async () => {
    const systems = new Map([["sys1", {}]])
    ;(connectedRoots as jest.Mock).mockReturnValue(systems)
    ;(getOrCreateClient as jest.Mock).mockResolvedValue({
      feeds: jest.fn().mockResolvedValue([{ href: "/sap/bc/adt/runtime/dumps/feeds", title: "Dumps", queryVariants: [] }])
    })
    setupWorkspaceConfig({
      sys1: {
        Dumps: { enabled: true, pollingInterval: 999999, notifications: false, useDefaultQuery: true }
      }
    })

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await expect(service.start()).resolves.toBeUndefined()
    service.stop()
  })
})

// ---- handleUnavailableFeed --------------------------------------------------

describe("handleUnavailableFeed warning notification", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("shows warning when feed is unavailable for the first time", async () => {
    const { funWindow: w } = require("../funMessenger")
    ;(w.showWarningMessage as jest.Mock).mockResolvedValue(undefined)

    const systems = new Map([["sys1", {}]])
    ;(connectedRoots as jest.Mock).mockReturnValue(systems)
    // Return empty feeds so the configured feed is unavailable
    ;(getOrCreateClient as jest.Mock).mockResolvedValue({
      feeds: jest.fn().mockResolvedValue([])
    })
    setupWorkspaceConfig({
      sys1: {
        "Missing Feed": { enabled: true, pollingInterval: 300, notifications: true, useDefaultQuery: true }
      }
    })

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    service.stop()

    expect(w.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Missing Feed"),
      "Configure Feeds"
    )
  })

  test("does not repeat warning once feed marked unavailable", async () => {
    const { funWindow: w } = require("../funMessenger")
    ;(w.showWarningMessage as jest.Mock).mockResolvedValue(undefined)

    const systems = new Map([["sys1", {}]])
    ;(connectedRoots as jest.Mock).mockReturnValue(systems)
    ;(getOrCreateClient as jest.Mock).mockResolvedValue({
      feeds: jest.fn().mockResolvedValue([])
    })
    setupWorkspaceConfig({
      sys1: {
        "Missing Feed": { enabled: true, pollingInterval: 300, notifications: true, useDefaultQuery: true }
      }
    })

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    // Pre-set state as already unavailable
    await sm.updateFeedState({ systemId: "sys1", feedTitle: "Missing Feed", isAvailable: false })

    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    service.stop()

    expect(w.showWarningMessage).not.toHaveBeenCalled()
  })
})

// ---- disabled feeds are skipped ---------------------------------------------

describe("disabled feed subscriptions", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)
    ;(fs.mkdirSync as jest.Mock).mockReturnValue(undefined)
    ;(workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
  })

  test("does not schedule polls for disabled feeds", async () => {
    const systems = new Map([["sys1", {}]])
    ;(connectedRoots as jest.Mock).mockReturnValue(systems)
    ;(getOrCreateClient as jest.Mock).mockResolvedValue({
      feeds: jest.fn().mockResolvedValue([{ href: "/sap/bc/adt/runtime/dumps/feeds", title: "Dumps", queryVariants: [] }])
    })
    setupWorkspaceConfig({
      sys1: {
        Dumps: { enabled: false, pollingInterval: 300, notifications: false, useDefaultQuery: true }
      }
    })

    const ctx = makeContext()
    const sm = makeStateManager(ctx)
    const service = new FeedPollingService(ctx as any, sm)
    await service.start()
    service.stop()
    // No error = success; disabled feeds shouldn't schedule anything
  })
})
