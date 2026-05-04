/**
 * Tests for heartbeatWatchlist.ts
 */

jest.mock("vscode", () => ({
  workspace: {
    workspaceFolders: undefined
  }
}), { virtual: true })

jest.mock("../../lib", () => ({ log: jest.fn() }))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { HeartbeatWatchlist, HeartbeatWatchlistFile, WatchlistTask } from "./heartbeatWatchlist"

// ============================================================================
// HELPERS
// ============================================================================

let tmpDir: string
let vscode: any

function setWorkspaceFolder(folder: string | null) {
  vscode.workspace.workspaceFolders = folder
    ? [{ uri: { scheme: "file", fsPath: folder } }]
    : undefined
}

function writeWatchlist(data: HeartbeatWatchlistFile, dir = tmpDir) {
  fs.writeFileSync(path.join(dir, "heartbeat.json"), JSON.stringify(data, null, 2))
}

function readWatchlistFile(dir = tmpDir): HeartbeatWatchlistFile {
  return JSON.parse(fs.readFileSync(path.join(dir, "heartbeat.json"), "utf8"))
}

function makeWatchlistFile(tasks: WatchlistTask[] = []): HeartbeatWatchlistFile {
  return {
    version: 1,
    lastModified: new Date().toISOString(),
    lastModifiedBy: "user",
    tasks
  }
}

function makeTask(overrides: Partial<WatchlistTask> = {}): WatchlistTask {
  return {
    id: "task-001",
    description: "Check transport status",
    enabled: true,
    addedAt: new Date().toISOString(),
    ...overrides
  }
}

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-wl-"))
  vscode = require("vscode")
  setWorkspaceFolder(tmpDir)
  jest.clearAllMocks()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ============================================================================
// getFilePath
// ============================================================================

describe("HeartbeatWatchlist.getFilePath", () => {
  test("returns path inside first file-based workspace folder", () => {
    const fp = HeartbeatWatchlist.getFilePath()
    expect(fp).toBe(path.join(tmpDir, "heartbeat.json"))
  })

  test("returns null when no workspace folders", () => {
    setWorkspaceFolder(null)
    expect(HeartbeatWatchlist.getFilePath()).toBeNull()
  })

  test("skips adt:// folders and uses file folder", () => {
    vscode.workspace.workspaceFolders = [
      { uri: { scheme: "adt", fsPath: "/some/adt" } },
      { uri: { scheme: "file", fsPath: tmpDir } }
    ]
    expect(HeartbeatWatchlist.getFilePath()).toBe(path.join(tmpDir, "heartbeat.json"))
  })

  test("returns null when all folders are adt://", () => {
    vscode.workspace.workspaceFolders = [
      { uri: { scheme: "adt", fsPath: "/some/adt" } }
    ]
    expect(HeartbeatWatchlist.getFilePath()).toBeNull()
  })
})

// ============================================================================
// read
// ============================================================================

describe("HeartbeatWatchlist.read", () => {
  test("returns null when no workspace folder", () => {
    setWorkspaceFolder(null)
    expect(HeartbeatWatchlist.read()).toBeNull()
  })

  test("returns null when file does not exist", () => {
    expect(HeartbeatWatchlist.read()).toBeNull()
  })

  test("reads and parses valid watchlist file", () => {
    writeWatchlist(makeWatchlistFile([makeTask()]))
    const data = HeartbeatWatchlist.read()
    expect(data).not.toBeNull()
    expect(data!.tasks).toHaveLength(1)
  })

  test("returns null on corrupted JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "heartbeat.json"), "{INVALID JSON")
    expect(HeartbeatWatchlist.read()).toBeNull()
  })
})

// ============================================================================
// write
// ============================================================================

describe("HeartbeatWatchlist.write", () => {
  test("writes file to disk", () => {
    const data = makeWatchlistFile()
    HeartbeatWatchlist.write(data, "user")
    expect(fs.existsSync(path.join(tmpDir, "heartbeat.json"))).toBe(true)
  })

  test("updates version to WATCHLIST_VERSION", () => {
    const data = makeWatchlistFile()
    data.version = 99
    HeartbeatWatchlist.write(data, "user")
    const stored = readWatchlistFile()
    expect(stored.version).toBe(1)
  })

  test("sets lastModifiedBy to 'user' when modifiedBy='agent'", () => {
    const data = makeWatchlistFile()
    HeartbeatWatchlist.write(data, "agent")
    const stored = readWatchlistFile()
    expect(stored.lastModifiedBy).toBe("user")
  })

  test("sets lastModifiedBy to 'heartbeat' when modifiedBy='heartbeat'", () => {
    const data = makeWatchlistFile()
    HeartbeatWatchlist.write(data, "heartbeat")
    const stored = readWatchlistFile()
    expect(stored.lastModifiedBy).toBe("heartbeat")
  })

  test("returns false when no workspace folder", () => {
    setWorkspaceFolder(null)
    expect(HeartbeatWatchlist.write(makeWatchlistFile(), "user")).toBe(false)
  })

  test("returns true on success", () => {
    expect(HeartbeatWatchlist.write(makeWatchlistFile(), "user")).toBe(true)
  })

  test("updates lastModified timestamp", () => {
    const before = new Date()
    const data = makeWatchlistFile()
    HeartbeatWatchlist.write(data, "user")
    const stored = readWatchlistFile()
    const modifiedAt = new Date(stored.lastModified)
    expect(modifiedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })
})

// ============================================================================
// getOrCreate
// ============================================================================

describe("HeartbeatWatchlist.getOrCreate", () => {
  test("returns existing watchlist if file exists", () => {
    writeWatchlist(makeWatchlistFile([makeTask()]))
    const result = HeartbeatWatchlist.getOrCreate()
    expect(result.tasks).toHaveLength(1)
  })

  test("creates empty watchlist if file does not exist", () => {
    const result = HeartbeatWatchlist.getOrCreate()
    expect(result.tasks).toHaveLength(0)
    expect(result.version).toBe(1)
  })

  test("new watchlist has lastModifiedBy='user'", () => {
    const result = HeartbeatWatchlist.getOrCreate()
    expect(result.lastModifiedBy).toBe("user")
  })
})

// ============================================================================
// generateTaskId
// ============================================================================

describe("HeartbeatWatchlist.generateTaskId", () => {
  test("returns a string starting with 'task-'", () => {
    expect(HeartbeatWatchlist.generateTaskId()).toMatch(/^task-\d+-.+/)
  })

  test("generates unique IDs on consecutive calls", () => {
    const id1 = HeartbeatWatchlist.generateTaskId()
    const id2 = HeartbeatWatchlist.generateTaskId()
    expect(id1).not.toBe(id2)
  })
})

// ============================================================================
// addTask
// ============================================================================

describe("HeartbeatWatchlist.addTask", () => {
  test("adds task successfully", () => {
    const result = HeartbeatWatchlist.addTask("Monitor transports")
    expect(result.success).toBe(true)
    expect(result.task).toBeDefined()
    expect(result.task!.description).toBe("Monitor transports")
  })

  test("sets enabled=true by default", () => {
    const result = HeartbeatWatchlist.addTask("Test task")
    expect(result.task!.enabled).toBe(true)
  })

  test("returns error for duplicate description", () => {
    HeartbeatWatchlist.addTask("Monitor dumps")
    const result = HeartbeatWatchlist.addTask("Monitor dumps")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already exists/i)
  })

  test("allows duplicate descriptions for reminderOnly tasks", () => {
    HeartbeatWatchlist.addTask("Daily reminder", { reminderOnly: true })
    const result = HeartbeatWatchlist.addTask("Daily reminder", { reminderOnly: true })
    expect(result.success).toBe(true)
  })

  test("case-insensitive duplicate check", () => {
    HeartbeatWatchlist.addTask("Monitor Dumps")
    const result = HeartbeatWatchlist.addTask("monitor dumps")
    expect(result.success).toBe(false)
  })

  test("trims description whitespace", () => {
    const result = HeartbeatWatchlist.addTask("  My task  ")
    expect(result.task!.description).toBe("My task")
  })

  test("sets all provided options", () => {
    const result = HeartbeatWatchlist.addTask("Test", {
      condition: "count > 0",
      connectionId: "dev100",
      removeWhenDone: true,
      sampleQuery: "SELECT * FROM mara",
      checkInstructions: ["Step 1", "Step 2"],
      priority: "high",
      category: "transport",
      alertThreshold: 5,
      cooldownMinutes: 30,
      maxChecks: 10,
      startAt: "2024-12-01T10:00:00Z",
      reminderOnly: false,
      reason: "Need to monitor"
    })
    expect(result.success).toBe(true)
    const task = result.task!
    expect(task.condition).toBe("count > 0")
    expect(task.connectionId).toBe("dev100")
    expect(task.sampleQuery).toBe("SELECT * FROM mara")
    expect(task.checkInstructions).toEqual(["Step 1", "Step 2"])
    expect(task.priority).toBe("high")
    expect(task.category).toBe("transport")
    expect(task.alertThreshold).toBe(5)
    expect(task.cooldownMinutes).toBe(30)
    expect(task.maxChecks).toBe(10)
    expect(task.startAt).toBe("2024-12-01T10:00:00Z")
    expect(task.reason).toBe("Need to monitor")
  })

  test("sets addedBy='user' for modifiedBy='user'", () => {
    const result = HeartbeatWatchlist.addTask("Task", {}, "user")
    expect(result.task!.addedBy).toBe("user")
  })

  test("sets addedBy='agent' for modifiedBy='agent'", () => {
    const result = HeartbeatWatchlist.addTask("Task", {}, "agent")
    expect(result.task!.addedBy).toBe("agent")
  })

  test("sets addedBy='heartbeat' for modifiedBy='heartbeat'", () => {
    const result = HeartbeatWatchlist.addTask("Task", {}, "heartbeat")
    expect(result.task!.addedBy).toBe("heartbeat")
  })

  test("sets checkCount to 0", () => {
    const result = HeartbeatWatchlist.addTask("Task")
    expect(result.task!.checkCount).toBe(0)
  })

  test("returns error when no workspace folder", () => {
    setWorkspaceFolder(null)
    const result = HeartbeatWatchlist.addTask("Task")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no file-based workspace/i)
  })

  test("preserves category when explicitly provided (override logic lives in tool, not watchlist)", () => {
    const result = HeartbeatWatchlist.addTask("Remind me!", { reminderOnly: true, category: "custom" })
    // The watchlist stores category as-is; the tool layer overrides it to 'reminder' for reminderOnly tasks
    expect(result.task!.category).toBe("custom")
  })

  test("sets category to undefined when no category provided", () => {
    const result = HeartbeatWatchlist.addTask("Task without category")
    expect(result.task!.category).toBeUndefined()
  })
})

// ============================================================================
// removeTask
// ============================================================================

describe("HeartbeatWatchlist.removeTask", () => {
  beforeEach(() => {
    writeWatchlist(makeWatchlistFile([makeTask({ id: "task-001", description: "Check status" })]))
  })

  test("removes task by ID", () => {
    const result = HeartbeatWatchlist.removeTask("task-001")
    expect(result.success).toBe(true)
    expect(result.removedTask!.id).toBe("task-001")
    expect(HeartbeatWatchlist.getAllTasks()).toHaveLength(0)
  })

  test("removes task by description (case-insensitive)", () => {
    const result = HeartbeatWatchlist.removeTask("check status")
    expect(result.success).toBe(true)
  })

  test("returns error for non-existent task", () => {
    const result = HeartbeatWatchlist.removeTask("task-999")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  test("returns error when no watchlist file", () => {
    fs.unlinkSync(path.join(tmpDir, "heartbeat.json"))
    const result = HeartbeatWatchlist.removeTask("task-001")
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// updateTask
// ============================================================================

describe("HeartbeatWatchlist.updateTask", () => {
  beforeEach(() => {
    writeWatchlist(makeWatchlistFile([makeTask({ id: "task-001", description: "Check transport" })]))
  })

  test("updates lastResult and lastCheckedAt", () => {
    const result = HeartbeatWatchlist.updateTask("task-001", {
      lastResult: "3 open transports",
      lastCheckedAt: "2024-01-15T10:00:00Z"
    })
    expect(result.success).toBe(true)
    expect(result.task!.lastResult).toBe("3 open transports")
    expect(result.task!.lastCheckedAt).toBe("2024-01-15T10:00:00Z")
  })

  test("updates enabled flag", () => {
    const result = HeartbeatWatchlist.updateTask("task-001", { enabled: false })
    expect(result.success).toBe(true)
    expect(result.task!.enabled).toBe(false)
  })

  test("updates description", () => {
    const result = HeartbeatWatchlist.updateTask("task-001", { description: "New description" })
    expect(result.success).toBe(true)
    expect(result.task!.description).toBe("New description")
  })

  test("updates notification tracking fields", () => {
    const result = HeartbeatWatchlist.updateTask("task-001", {
      lastNotifiedAt: "2024-01-15T10:00:00Z",
      lastNotifiedFindings: "transport ABC123"
    })
    expect(result.success).toBe(true)
    expect(result.task!.lastNotifiedAt).toBe("2024-01-15T10:00:00Z")
    expect(result.task!.lastNotifiedFindings).toBe("transport ABC123")
  })

  test("returns error for non-existent task", () => {
    const result = HeartbeatWatchlist.updateTask("task-999", { enabled: false })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  test("returns error when no watchlist file", () => {
    fs.unlinkSync(path.join(tmpDir, "heartbeat.json"))
    const result = HeartbeatWatchlist.updateTask("task-001", { enabled: false })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// getEnabledTasks / getAllTasks
// ============================================================================

describe("HeartbeatWatchlist.getEnabledTasks / getAllTasks", () => {
  test("getEnabledTasks returns only enabled tasks", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ id: "task-001", enabled: true }),
      makeTask({ id: "task-002", description: "Disabled", enabled: false })
    ]))
    const enabled = HeartbeatWatchlist.getEnabledTasks()
    expect(enabled).toHaveLength(1)
    expect(enabled[0].id).toBe("task-001")
  })

  test("getAllTasks returns all tasks regardless of enabled state", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ id: "task-001", enabled: true }),
      makeTask({ id: "task-002", description: "Disabled", enabled: false })
    ]))
    expect(HeartbeatWatchlist.getAllTasks()).toHaveLength(2)
  })

  test("getEnabledTasks returns empty array when no watchlist", () => {
    expect(HeartbeatWatchlist.getEnabledTasks()).toHaveLength(0)
  })

  test("getAllTasks returns empty array when no watchlist", () => {
    expect(HeartbeatWatchlist.getAllTasks()).toHaveLength(0)
  })
})

// ============================================================================
// getDueTasks
// ============================================================================

describe("HeartbeatWatchlist.getDueTasks", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2024-06-15T10:00:00Z"))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("returns task with no startAt or expiresAt", () => {
    writeWatchlist(makeWatchlistFile([makeTask()]))
    expect(HeartbeatWatchlist.getDueTasks()).toHaveLength(1)
  })

  test("excludes task with future startAt", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ startAt: "2024-12-01T00:00:00Z" })
    ]))
    expect(HeartbeatWatchlist.getDueTasks()).toHaveLength(0)
  })

  test("includes task with past startAt", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ startAt: "2024-01-01T00:00:00Z" })
    ]))
    expect(HeartbeatWatchlist.getDueTasks()).toHaveLength(1)
  })

  test("excludes expired task", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ expiresAt: "2024-01-01T00:00:00Z" })
    ]))
    expect(HeartbeatWatchlist.getDueTasks()).toHaveLength(0)
  })

  test("includes task that expires in the future", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ expiresAt: "2024-12-31T00:00:00Z" })
    ]))
    expect(HeartbeatWatchlist.getDueTasks()).toHaveLength(1)
  })

  test("excludes disabled tasks", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ enabled: false })
    ]))
    expect(HeartbeatWatchlist.getDueTasks()).toHaveLength(0)
  })
})

// ============================================================================
// getScheduledTasks
// ============================================================================

describe("HeartbeatWatchlist.getScheduledTasks", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2024-06-15T10:00:00Z"))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("returns tasks with future startAt", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ id: "future", startAt: "2024-12-01T00:00:00Z" }),
      makeTask({ id: "past", description: "Past task" })
    ]))
    const scheduled = HeartbeatWatchlist.getScheduledTasks()
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].id).toBe("future")
  })

  test("returns empty array when no tasks are scheduled", () => {
    writeWatchlist(makeWatchlistFile([makeTask()]))
    expect(HeartbeatWatchlist.getScheduledTasks()).toHaveLength(0)
  })
})

// ============================================================================
// formatForPrompt
// ============================================================================

describe("HeartbeatWatchlist.formatForPrompt", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2024-06-15T10:00:00Z"))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("returns 'No monitoring tasks' when empty", () => {
    writeWatchlist(makeWatchlistFile([]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toMatch(/no monitoring tasks/i)
  })

  test("returns scheduled info when only future tasks", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ startAt: "2024-12-01T00:00:00Z" })
    ]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toMatch(/scheduled for later/i)
  })

  test("includes task description in prompt", () => {
    writeWatchlist(makeWatchlistFile([makeTask({ description: "Monitor SAP dumps" })]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toContain("Monitor SAP dumps")
  })

  test("includes REMINDER marker for reminderOnly tasks", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ description: "Meeting at 3pm", reminderOnly: true })
    ]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toMatch(/REMINDER/i)
  })

  test("includes SQL query when present", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ sampleQuery: "SELECT * FROM e070 WHERE trkorr LIKE 'K%'" })
    ]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toContain("SELECT * FROM e070")
  })

  test("includes checkInstructions as numbered list", () => {
    writeWatchlist(makeWatchlistFile([
      makeTask({ checkInstructions: ["Run query", "Compare results"] })
    ]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toContain("1. Run query")
    expect(prompt).toContain("2. Compare results")
  })

  test("shows cooldown active when in cooldown window", () => {
    const lastNotifiedAt = new Date("2024-06-15T09:45:00Z").toISOString()
    writeWatchlist(makeWatchlistFile([
      makeTask({ cooldownMinutes: 30, lastNotifiedAt })
    ]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toMatch(/cooldown active/i)
  })

  test("includes priority when set", () => {
    writeWatchlist(makeWatchlistFile([makeTask({ priority: "high" })]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toContain("high")
  })

  test("includes auto-remove note for removeWhenDone tasks", () => {
    writeWatchlist(makeWatchlistFile([makeTask({ removeWhenDone: true })]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toMatch(/auto-remove/i)
  })

  test("includes Tasks to Check Now header", () => {
    writeWatchlist(makeWatchlistFile([makeTask()]))
    const prompt = HeartbeatWatchlist.formatForPrompt()
    expect(prompt).toContain("Tasks to Check Now")
  })
})
