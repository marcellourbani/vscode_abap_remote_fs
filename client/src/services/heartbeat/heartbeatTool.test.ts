/**
 * Tests for heartbeatTool.ts - HeartbeatTool & registerHeartbeatTool
 */

jest.mock("vscode", () => {
  const LanguageModelTextPart = jest.fn(function (this: any, value: string) {
    this.value = value
  })
  const LanguageModelToolResult = jest.fn(function (this: any, parts: any[]) {
    this.content = parts
  })
  return {
    lm: {
      registerTool: jest.fn(() => ({ dispose: jest.fn() })),
      tools: []
    },
    workspace: {
      getConfiguration: jest.fn()
    },
    LanguageModelTextPart,
    LanguageModelToolResult,
    CancellationTokenSource: jest.fn(() => ({ token: {}, cancel: jest.fn() }))
  }
}, { virtual: true })

jest.mock("../../lib", () => ({ log: jest.fn() }))

jest.mock("../lm-tools/toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))

jest.mock("../telemetry", () => ({
  logTelemetry: jest.fn()
}))

jest.mock("./heartbeatService", () => ({
  getHeartbeatService: jest.fn()
}))

jest.mock("./heartbeatWatchlist", () => ({
  HeartbeatWatchlist: {
    getAllTasks: jest.fn(() => []),
    getFilePath: jest.fn(() => "/workspace/heartbeat.json"),
    addTask: jest.fn(),
    removeTask: jest.fn(),
    updateTask: jest.fn(),
    read: jest.fn()
  }
}))

import { HeartbeatTool, registerHeartbeatTool } from "./heartbeatTool"
import { HeartbeatWatchlist } from "./heartbeatWatchlist"
import { getHeartbeatService } from "./heartbeatService"
import { registerToolWithRegistry } from "../lm-tools/toolRegistry"

// ============================================================================
// HELPERS
// ============================================================================

function makeOptions(input: any, token: any = {}) {
  return { input, toolInvocationToken: undefined } as any
}

function makePrepareOptions(input: any) {
  return { input } as any
}

function extractText(result: any): string {
  if (result && result.content && result.content[0]) {
    return result.content[0].value || ""
  }
  return ""
}

function makeService(overrides: any = {}) {
  return {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    triggerNow: jest.fn().mockResolvedValue({ status: "ran", durationMs: 1234 }),
    getStatus: jest.fn().mockReturnValue({
      isRunning: false,
      isPaused: false,
      nextRunTime: undefined,
      lastRunTime: undefined,
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        alerts: 0,
        errors: 0,
        skipped: 0,
        averageDurationMs: 0
      }
    }),
    ...overrides
  }
}

let vscode: any
let tool: HeartbeatTool
const token = {}

beforeEach(() => {
  vscode = require("vscode")
  vscode.workspace.getConfiguration.mockReturnValue({
    get: jest.fn((key: string, def: any) => {
      const vals: Record<string, any> = {
        enabled: false,
        model: "",
        every: "5m"
      }
      return vals[key] !== undefined ? vals[key] : def
    })
  })
  ;(getHeartbeatService as jest.Mock).mockReturnValue(undefined)
  ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockReturnValue([])
  ;(HeartbeatWatchlist.getFilePath as jest.Mock).mockReturnValue("/workspace/heartbeat.json")
  tool = new HeartbeatTool()
  jest.clearAllMocks()

  // Re-setup after clearAllMocks
  vscode.workspace.getConfiguration.mockReturnValue({
    get: jest.fn((key: string, def: any) => {
      const vals: Record<string, any> = { enabled: false, model: "", every: "5m" }
      return vals[key] !== undefined ? vals[key] : def
    })
  })
  ;(getHeartbeatService as jest.Mock).mockReturnValue(undefined)
  ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockReturnValue([])
  ;(HeartbeatWatchlist.getFilePath as jest.Mock).mockReturnValue("/workspace/heartbeat.json")
})

// ============================================================================
// prepareInvocation
// ============================================================================

describe("HeartbeatTool.prepareInvocation", () => {
  const actions = [
    "status", "start", "stop", "pause", "resume", "trigger",
    "history", "add_task", "remove_task", "update_task",
    "enable_task", "disable_task", "list_tasks", "get_watchlist"
  ] as const

  test.each(actions)("returns invocationMessage for action '%s'", async (action) => {
    const result = await tool.prepareInvocation(makePrepareOptions({ action }), token as any)
    expect(result.invocationMessage).toBeTruthy()
    expect(typeof result.invocationMessage).toBe("string")
  })

  test("returns fallback message for unknown action", async () => {
    const result = await tool.prepareInvocation(makePrepareOptions({ action: "unknown_action" }), token as any)
    expect(result.invocationMessage).toContain("unknown_action")
  })
})

// ============================================================================
// action: status
// ============================================================================

describe("HeartbeatTool invoke - status", () => {
  test("returns error when service not initialized", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(undefined)
    const result = await tool.invoke(makeOptions({ action: "status" }), token as any)
    expect(extractText(result)).toMatch(/not initialized/i)
  })

  test("returns status text when service is running", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService({
      getStatus: jest.fn().mockReturnValue({
        isRunning: true,
        isPaused: false,
        stats: { totalRuns: 5, successfulRuns: 4, alerts: 1, errors: 0, skipped: 0, averageDurationMs: 1500 }
      })
    }))
    ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockReturnValue([
      { enabled: true, id: "t1" }
    ])
    const result = await tool.invoke(makeOptions({ action: "status" }), token as any)
    const text = extractText(result)
    expect(text).toContain("Heartbeat Status")
    expect(text).toMatch(/running/i)
  })

  test("warns when model is not configured", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService())
    const result = await tool.invoke(makeOptions({ action: "status" }), token as any)
    const text = extractText(result)
    expect(text).toMatch(/no model configured/i)
  })
})

// ============================================================================
// action: stop
// ============================================================================

describe("HeartbeatTool invoke - stop", () => {
  test("returns no-service error when service is null", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(undefined)
    const result = await tool.invoke(makeOptions({ action: "stop" }), token as any)
    expect(extractText(result)).toMatch(/not initialized/i)
  })

  test("calls service.stop() and returns confirmation", async () => {
    const mockService = makeService()
    ;(getHeartbeatService as jest.Mock).mockReturnValue(mockService)
    const result = await tool.invoke(makeOptions({ action: "stop" }), token as any)
    expect(mockService.stop).toHaveBeenCalled()
    expect(extractText(result)).toMatch(/stopped/i)
  })
})

// ============================================================================
// action: trigger
// ============================================================================

describe("HeartbeatTool invoke - trigger", () => {
  test("returns error when service not initialized", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(undefined)
    const result = await tool.invoke(makeOptions({ action: "trigger" }), token as any)
    expect(extractText(result)).toMatch(/not initialized/i)
  })

  test("reports success when beat ran", async () => {
    const mockService = makeService({
      triggerNow: jest.fn().mockResolvedValue({ status: "ran", durationMs: 2500 })
    })
    ;(getHeartbeatService as jest.Mock).mockReturnValue(mockService)
    const result = await tool.invoke(makeOptions({ action: "trigger", reason: "manual" }), token as any)
    expect(extractText(result)).toMatch(/completed/i)
  })

  test("reports skipped reason", async () => {
    const mockService = makeService({
      triggerNow: jest.fn().mockResolvedValue({ status: "skipped", reason: "paused" })
    })
    ;(getHeartbeatService as jest.Mock).mockReturnValue(mockService)
    const result = await tool.invoke(makeOptions({ action: "trigger" }), token as any)
    expect(extractText(result)).toMatch(/skipped/i)
    expect(extractText(result)).toContain("paused")
  })

  test("reports failed reason", async () => {
    const mockService = makeService({
      triggerNow: jest.fn().mockResolvedValue({ status: "failed", reason: "timeout" })
    })
    ;(getHeartbeatService as jest.Mock).mockReturnValue(mockService)
    const result = await tool.invoke(makeOptions({ action: "trigger" }), token as any)
    expect(extractText(result)).toMatch(/failed/i)
    expect(extractText(result)).toContain("timeout")
  })
})

// ============================================================================
// action: history
// ============================================================================

describe("HeartbeatTool invoke - history", () => {
  test("returns 'no history' when totalRuns is 0", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService())
    const result = await tool.invoke(makeOptions({ action: "history" }), token as any)
    expect(extractText(result)).toMatch(/no heartbeat history/i)
  })

  test("returns history summary with stats", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService({
      getStatus: jest.fn().mockReturnValue({
        isRunning: true,
        isPaused: false,
        stats: { totalRuns: 10, successfulRuns: 8, alerts: 1, errors: 1, skipped: 0, averageDurationMs: 0 }
      })
    }))
    const result = await tool.invoke(makeOptions({ action: "history", count: 5 }), token as any)
    const text = extractText(result)
    expect(text).toContain("10")
  })

  test("returns 'not available' when service is null", async () => {
    ;(getHeartbeatService as jest.Mock).mockReturnValue(undefined)
    const result = await tool.invoke(makeOptions({ action: "history" }), token as any)
    expect(extractText(result)).toMatch(/not available/i)
  })
})

// ============================================================================
// action: add_task
// ============================================================================

describe("HeartbeatTool invoke - add_task", () => {
  test("returns error when description is missing", async () => {
    const result = await tool.invoke(makeOptions({ action: "add_task" }), token as any)
    expect(extractText(result)).toMatch(/no task description/i)
  })

  test("returns error when description is empty string", async () => {
    const result = await tool.invoke(makeOptions({ action: "add_task", description: "   " }), token as any)
    expect(extractText(result)).toMatch(/no task description/i)
  })

  test("calls HeartbeatWatchlist.addTask with description", async () => {
    ;(HeartbeatWatchlist.addTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-001", description: "Monitor dumps", enabled: true, addedAt: new Date().toISOString(), checkCount: 0 }
    })
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService())
    const result = await tool.invoke(makeOptions({ action: "add_task", description: "Monitor dumps" }), token as any)
    expect(HeartbeatWatchlist.addTask).toHaveBeenCalledWith("Monitor dumps", expect.any(Object), "user")
    expect(extractText(result)).toMatch(/added monitoring task|scheduled/i)
  })

  test("returns error text when addTask fails", async () => {
    ;(HeartbeatWatchlist.addTask as jest.Mock).mockReturnValue({
      success: false,
      error: "Task already exists: \"Monitor dumps\""
    })
    const result = await tool.invoke(makeOptions({ action: "add_task", description: "Monitor dumps" }), token as any)
    expect(extractText(result)).toMatch(/already exists/i)
  })

  test("shows reminder label for reminderOnly tasks", async () => {
    ;(HeartbeatWatchlist.addTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-002", description: "Meeting reminder", enabled: true, addedAt: new Date().toISOString(), reminderOnly: true, checkCount: 0 }
    })
    const result = await tool.invoke(makeOptions({ action: "add_task", description: "Meeting reminder", reminderOnly: true }), token as any)
    expect(extractText(result)).toMatch(/reminder/i)
  })

  test("hints to start heartbeat when service is not running", async () => {
    ;(HeartbeatWatchlist.addTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-001", description: "Task", enabled: true, addedAt: new Date().toISOString(), checkCount: 0 }
    })
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService({ getStatus: jest.fn().mockReturnValue({ isRunning: false, isPaused: false, stats: { totalRuns: 0, successfulRuns: 0, alerts: 0, errors: 0, skipped: 0, averageDurationMs: 0 } }) }))
    const result = await tool.invoke(makeOptions({ action: "add_task", description: "Task" }), token as any)
    expect(extractText(result)).toMatch(/not running|start/i)
  })
})

// ============================================================================
// action: remove_task
// ============================================================================

describe("HeartbeatTool invoke - remove_task", () => {
  test("returns error when taskId is missing", async () => {
    const result = await tool.invoke(makeOptions({ action: "remove_task" }), token as any)
    expect(extractText(result)).toMatch(/no task id/i)
  })

  test("removes task successfully", async () => {
    ;(HeartbeatWatchlist.removeTask as jest.Mock).mockReturnValue({
      success: true,
      removedTask: { id: "task-001", description: "Check dumps" }
    })
    const result = await tool.invoke(makeOptions({ action: "remove_task", taskId: "task-001" }), token as any)
    expect(extractText(result)).toMatch(/removed task/i)
    expect(extractText(result)).toContain("Check dumps")
  })

  test("returns error when task not found", async () => {
    ;(HeartbeatWatchlist.removeTask as jest.Mock).mockReturnValue({
      success: false,
      error: "Task not found: task-999"
    })
    const result = await tool.invoke(makeOptions({ action: "remove_task", taskId: "task-999" }), token as any)
    expect(extractText(result)).toMatch(/not found/i)
  })
})

// ============================================================================
// action: update_task
// ============================================================================

describe("HeartbeatTool invoke - update_task", () => {
  test("returns error when taskId is missing", async () => {
    const result = await tool.invoke(makeOptions({ action: "update_task" }), token as any)
    expect(extractText(result)).toMatch(/no task id/i)
  })

  test("updates task successfully with result", async () => {
    ;(HeartbeatWatchlist.updateTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-001", description: "Monitor SAP" }
    })
    const result = await tool.invoke(makeOptions({
      action: "update_task",
      taskId: "task-001",
      result: "3 transports found"
    }), token as any)
    expect(HeartbeatWatchlist.updateTask).toHaveBeenCalledWith(
      "task-001",
      expect.objectContaining({ lastResult: "3 transports found" }),
      "heartbeat"
    )
    expect(extractText(result)).toMatch(/updated task/i)
  })

  test("passes notification tracking fields to updateTask", async () => {
    ;(HeartbeatWatchlist.updateTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-001", description: "Monitor" }
    })
    await tool.invoke(makeOptions({
      action: "update_task",
      taskId: "task-001",
      lastNotifiedAt: "2024-01-15T10:00:00Z",
      lastNotifiedFindings: "ABC123"
    }), token as any)
    expect(HeartbeatWatchlist.updateTask).toHaveBeenCalledWith(
      "task-001",
      expect.objectContaining({
        lastNotifiedAt: "2024-01-15T10:00:00Z",
        lastNotifiedFindings: "ABC123"
      }),
      "heartbeat"
    )
  })
})

// ============================================================================
// action: enable_task / disable_task
// ============================================================================

describe("HeartbeatTool invoke - enable_task / disable_task", () => {
  test("enable_task returns error when taskId missing", async () => {
    const result = await tool.invoke(makeOptions({ action: "enable_task" }), token as any)
    expect(extractText(result)).toMatch(/no task id/i)
  })

  test("disable_task returns error when taskId missing", async () => {
    const result = await tool.invoke(makeOptions({ action: "disable_task" }), token as any)
    expect(extractText(result)).toMatch(/no task id/i)
  })

  test("enable_task updates task enabled=true", async () => {
    ;(HeartbeatWatchlist.updateTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-001", description: "My Task" }
    })
    const result = await tool.invoke(makeOptions({ action: "enable_task", taskId: "task-001" }), token as any)
    expect(HeartbeatWatchlist.updateTask).toHaveBeenCalledWith("task-001", { enabled: true }, "user")
    expect(extractText(result)).toMatch(/enabled/i)
  })

  test("disable_task updates task enabled=false", async () => {
    ;(HeartbeatWatchlist.updateTask as jest.Mock).mockReturnValue({
      success: true,
      task: { id: "task-001", description: "My Task" }
    })
    const result = await tool.invoke(makeOptions({ action: "disable_task", taskId: "task-001" }), token as any)
    expect(HeartbeatWatchlist.updateTask).toHaveBeenCalledWith("task-001", { enabled: false }, "user")
    expect(extractText(result)).toMatch(/disabled/i)
  })
})

// ============================================================================
// action: list_tasks
// ============================================================================

describe("HeartbeatTool invoke - list_tasks", () => {
  test("returns 'no tasks' when list is empty", async () => {
    ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockReturnValue([])
    const result = await tool.invoke(makeOptions({ action: "list_tasks" }), token as any)
    expect(extractText(result)).toMatch(/no monitoring tasks/i)
  })

  test("lists all tasks", async () => {
    ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockReturnValue([
      { id: "task-001", description: "Watch dumps", enabled: true }
    ])
    const result = await tool.invoke(makeOptions({ action: "list_tasks" }), token as any)
    const text = extractText(result)
    expect(text).toContain("task-001")
    expect(text).toContain("Watch dumps")
  })

  test("shows enabled/disabled status", async () => {
    ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockReturnValue([
      { id: "t1", description: "Active", enabled: true },
      { id: "t2", description: "Inactive", enabled: false }
    ])
    const result = await tool.invoke(makeOptions({ action: "list_tasks" }), token as any)
    const text = extractText(result)
    expect(text).toContain("✅")
    expect(text).toContain("❌")
  })
})

// ============================================================================
// action: get_watchlist
// ============================================================================

describe("HeartbeatTool invoke - get_watchlist", () => {
  test("returns JSON when watchlist exists", async () => {
    ;(HeartbeatWatchlist.read as jest.Mock).mockReturnValue({
      version: 1,
      tasks: [{ id: "t1", description: "Test" }],
      lastModified: new Date().toISOString(),
      lastModifiedBy: "user"
    })
    const result = await tool.invoke(makeOptions({ action: "get_watchlist" }), token as any)
    const text = extractText(result)
    const parsed = JSON.parse(text)
    expect(parsed.version).toBe(1)
    expect(parsed.tasks).toHaveLength(1)
  })

  test("returns empty tasks JSON when no watchlist file", async () => {
    ;(HeartbeatWatchlist.read as jest.Mock).mockReturnValue(null)
    const result = await tool.invoke(makeOptions({ action: "get_watchlist" }), token as any)
    const text = extractText(result)
    const parsed = JSON.parse(text)
    expect(parsed.tasks).toHaveLength(0)
  })
})

// ============================================================================
// action: unknown
// ============================================================================

describe("HeartbeatTool invoke - unknown action", () => {
  test("returns 'Unknown action' message", async () => {
    const result = await tool.invoke(makeOptions({ action: "fly_to_moon" }), token as any)
    expect(extractText(result)).toMatch(/unknown action/i)
  })
})

// ============================================================================
// error handling in invoke
// ============================================================================

describe("HeartbeatTool invoke - error handling", () => {
  test("catches exceptions thrown inside switch cases and returns error message", async () => {
    // getHeartbeatService is called OUTSIDE the try-catch, but handleStatus is inside it.
    // Simulate an error thrown inside a handler by making getAllTasks throw.
    ;(HeartbeatWatchlist.getAllTasks as jest.Mock).mockImplementation(() => {
      throw new Error("Watchlist crashed")
    })
    ;(getHeartbeatService as jest.Mock).mockReturnValue(makeService())
    const result = await tool.invoke(makeOptions({ action: "status" }), token as any)
    expect(extractText(result)).toMatch(/error/i)
    expect(extractText(result)).toContain("Watchlist crashed")
  })
})

// ============================================================================
// registerHeartbeatTool
// ============================================================================

describe("registerHeartbeatTool", () => {
  test("calls registerToolWithRegistry with 'manage_heartbeat' and HeartbeatTool instance", () => {
    const mockContext = { subscriptions: { push: jest.fn() } } as any
    registerHeartbeatTool(mockContext)
    expect(registerToolWithRegistry).toHaveBeenCalledWith("manage_heartbeat", expect.any(HeartbeatTool))
    expect(mockContext.subscriptions.push).toHaveBeenCalled()
  })
})
