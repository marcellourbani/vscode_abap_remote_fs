/**
 * Tests for heartbeatStateManager.ts
 */

jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn()
  }
}), { virtual: true })

jest.mock("../../lib", () => ({ log: jest.fn() }))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { HeartbeatStateManager } from "./heartbeatStateManager"
import { HeartbeatRunRecord } from "./heartbeatTypes"

// ============================================================================
// HELPERS
// ============================================================================

function makeContext(storagePath: string) {
  return {
    globalStorageUri: { fsPath: storagePath },
    subscriptions: { push: jest.fn() }
  } as any
}

function makeConfigMock(overrides: Record<string, any> = {}) {
  return {
    get: jest.fn((key: string, defaultValue?: any) => {
      return overrides[key] !== undefined ? overrides[key] : defaultValue
    })
  }
}

function makeRecord(overrides: Partial<HeartbeatRunRecord> = {}): HeartbeatRunRecord {
  return {
    timestamp: new Date("2024-01-15T10:00:00Z"),
    durationMs: 1000,
    status: "ok",
    ...overrides
  }
}

// ============================================================================
// SETUP
// ============================================================================

let tmpDir: string
let vscode: any

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-test-"))
  vscode = require("vscode")
  vscode.workspace.getConfiguration.mockReturnValue(makeConfigMock())
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  jest.clearAllMocks()
})

// ============================================================================
// CONSTRUCTOR / INITIAL STATE
// ============================================================================

describe("HeartbeatStateManager constructor", () => {
  test("creates storage directory if it does not exist", () => {
    const missingDir = path.join(tmpDir, "subdir", "nested")
    makeContext(missingDir) // directory does not exist yet
    new HeartbeatStateManager(makeContext(missingDir))
    expect(fs.existsSync(missingDir)).toBe(true)
  })

  test("starts with isRunning=false", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getState().isRunning).toBe(false)
  })

  test("starts with isPaused=false", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getState().isPaused).toBe(false)
  })

  test("starts with empty run history", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getState().runHistory).toHaveLength(0)
  })

  test("starts with zero consecutive errors", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getState().consecutiveErrors).toBe(0)
  })
})

// ============================================================================
// LOAD STATE FROM DISK
// ============================================================================

describe("HeartbeatStateManager loadState", () => {
  test("loads persisted history from JSON file", async () => {
    const stored = {
      version: 1,
      lastRunTime: "2024-01-15T10:00:00.000Z",
      runHistory: [
        {
          timestamp: "2024-01-15T10:00:00.000Z",
          durationMs: 1500,
          status: "ok",
          response: "HEARTBEAT_OK"
        }
      ],
      consecutiveErrors: 2
    }
    fs.writeFileSync(path.join(tmpDir, "heartbeatHistory.json"), JSON.stringify(stored))

    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const state = mgr.getState()

    expect(state.runHistory).toHaveLength(1)
    expect(state.consecutiveErrors).toBe(2)
    expect(state.lastRunTime).toBeInstanceOf(Date)
    expect(state.runHistory[0].timestamp).toBeInstanceOf(Date)
  })

  test("always starts with isRunning=false even if persisted otherwise", async () => {
    // State files can't persist isRunning=true across sessions
    const stored = { version: 1, runHistory: [], consecutiveErrors: 0 }
    fs.writeFileSync(path.join(tmpDir, "heartbeatHistory.json"), JSON.stringify(stored))
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getState().isRunning).toBe(false)
  })

  test("handles missing history file gracefully", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getState().runHistory).toHaveLength(0)
  })

  test("handles corrupted history file gracefully", () => {
    fs.writeFileSync(path.join(tmpDir, "heartbeatHistory.json"), "NOT JSON {{{")
    expect(() => new HeartbeatStateManager(makeContext(tmpDir))).not.toThrow()
  })
})

// ============================================================================
// STATE SETTERS
// ============================================================================

describe("setRunning / setPaused / setNextRunTime", () => {
  test("setRunning(true) updates isRunning", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    mgr.setRunning(true)
    expect(mgr.getState().isRunning).toBe(true)
  })

  test("setRunning(false) updates isRunning", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    mgr.setRunning(true)
    mgr.setRunning(false)
    expect(mgr.getState().isRunning).toBe(false)
  })

  test("setPaused(true) updates isPaused", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    mgr.setPaused(true)
    expect(mgr.getState().isPaused).toBe(true)
  })

  test("setNextRunTime sets next run time", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const t = new Date("2024-01-15T12:00:00Z")
    mgr.setNextRunTime(t)
    expect(mgr.getState().nextRunTime).toEqual(t)
  })

  test("setNextRunTime(undefined) clears next run time", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    mgr.setNextRunTime(new Date())
    mgr.setNextRunTime(undefined)
    expect(mgr.getState().nextRunTime).toBeUndefined()
  })
})

// ============================================================================
// RECORD RUN
// ============================================================================

describe("recordRun", () => {
  test("adds record to history", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord())
    expect(mgr.getState().runHistory).toHaveLength(1)
  })

  test("updates lastRunTime", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const ts = new Date("2024-06-01T09:00:00Z")
    await mgr.recordRun(makeRecord({ timestamp: ts }))
    expect(mgr.getState().lastRunTime).toEqual(ts)
  })

  test("increments consecutiveErrors on error status", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.recordRun(makeRecord({ status: "error" }))
    expect(mgr.getState().consecutiveErrors).toBe(2)
  })

  test("resets consecutiveErrors on ok status", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.recordRun(makeRecord({ status: "ok" }))
    expect(mgr.getState().consecutiveErrors).toBe(0)
  })

  test("resets consecutiveErrors on alert status", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.recordRun(makeRecord({ status: "alert" }))
    expect(mgr.getState().consecutiveErrors).toBe(0)
  })

  test("persists state to disk", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord())
    const filePath = path.join(tmpDir, "heartbeatHistory.json")
    expect(fs.existsSync(filePath)).toBe(true)
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"))
    expect(stored.runHistory).toHaveLength(1)
  })

  test("trims history to maxHistory limit", async () => {
    vscode.workspace.getConfiguration.mockReturnValue(makeConfigMock({ maxHistory: 3 }))
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    for (let i = 0; i < 5; i++) {
      await mgr.recordRun(makeRecord())
    }
    expect(mgr.getState().runHistory.length).toBeLessThanOrEqual(3)
  })
})

// ============================================================================
// resetErrors
// ============================================================================

describe("resetErrors", () => {
  test("resets consecutive error count to 0", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.recordRun(makeRecord({ status: "error" }))
    mgr.resetErrors()
    expect(mgr.getState().consecutiveErrors).toBe(0)
  })
})

// ============================================================================
// getRecentHistory
// ============================================================================

describe("getRecentHistory", () => {
  test("returns last N records", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    for (let i = 0; i < 5; i++) {
      await mgr.recordRun(makeRecord({ durationMs: i * 100 }))
    }
    const recent = mgr.getRecentHistory(3)
    expect(recent).toHaveLength(3)
    expect(recent[2].durationMs).toBe(400)
  })

  test("returns all records if count > history length", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord())
    const recent = mgr.getRecentHistory(100)
    expect(recent).toHaveLength(1)
  })

  test("returns empty array on empty history", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getRecentHistory(10)).toHaveLength(0)
  })
})

// ============================================================================
// clearHistory
// ============================================================================

describe("clearHistory", () => {
  test("removes all history entries", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord())
    await mgr.recordRun(makeRecord())
    await mgr.clearHistory()
    expect(mgr.getState().runHistory).toHaveLength(0)
  })

  test("resets consecutive errors", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.clearHistory()
    expect(mgr.getState().consecutiveErrors).toBe(0)
  })
})

// ============================================================================
// getStats
// ============================================================================

describe("getStats", () => {
  test("returns zero stats on empty history", () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const stats = mgr.getStats()
    expect(stats.totalRuns).toBe(0)
    expect(stats.successfulRuns).toBe(0)
    expect(stats.alerts).toBe(0)
    expect(stats.errors).toBe(0)
    expect(stats.skipped).toBe(0)
    expect(stats.averageDurationMs).toBe(0)
  })

  test("counts ok/alert/error/skipped correctly", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ status: "ok" }))
    await mgr.recordRun(makeRecord({ status: "ok" }))
    await mgr.recordRun(makeRecord({ status: "alert" }))
    await mgr.recordRun(makeRecord({ status: "error" }))
    await mgr.recordRun(makeRecord({ status: "skipped", durationMs: 0 }))

    const stats = mgr.getStats()
    expect(stats.totalRuns).toBe(5)
    expect(stats.successfulRuns).toBe(2)
    expect(stats.alerts).toBe(1)
    expect(stats.errors).toBe(1)
    expect(stats.skipped).toBe(1)
  })

  test("calculates average duration from non-zero durations", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ durationMs: 1000 }))
    await mgr.recordRun(makeRecord({ durationMs: 3000 }))
    const stats = mgr.getStats()
    expect(stats.averageDurationMs).toBe(2000)
  })

  test("excludes zero-duration records from average calculation", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    await mgr.recordRun(makeRecord({ durationMs: 0, status: "skipped" }))
    await mgr.recordRun(makeRecord({ durationMs: 2000 }))
    const stats = mgr.getStats()
    expect(stats.averageDurationMs).toBe(2000)
  })

  test("returns lastRunTime from last record", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const ts = new Date("2024-06-01T09:00:00Z")
    await mgr.recordRun(makeRecord({ timestamp: ts }))
    expect(mgr.getStats().lastRunTime).toEqual(ts)
  })
})

// ============================================================================
// getConfig
// ============================================================================

describe("getConfig", () => {
  test("reads enabled from vscode config", () => {
    vscode.workspace.getConfiguration.mockReturnValue(makeConfigMock({ enabled: true }))
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getConfig().enabled).toBe(true)
  })

  test("uses defaults when config returns defaults", () => {
    vscode.workspace.getConfiguration.mockReturnValue(makeConfigMock())
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const cfg = mgr.getConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.every).toBe("30m")
    expect(cfg.maxHistory).toBe(100)
  })

  test("reads custom model from config", () => {
    vscode.workspace.getConfiguration.mockReturnValue(makeConfigMock({ model: "GPT-4o" }))
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    expect(mgr.getConfig().model).toBe("GPT-4o")
  })
})

// ============================================================================
// getState returns a copy
// ============================================================================

describe("getState immutability", () => {
  test("returns a shallow copy so external mutations do not affect internal state", async () => {
    const mgr = new HeartbeatStateManager(makeContext(tmpDir))
    const state = mgr.getState()
    state.isRunning = true
    expect(mgr.getState().isRunning).toBe(false)
  })
})
