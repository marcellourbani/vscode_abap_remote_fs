/**
 * Tests for heartbeatService.ts - HeartbeatService, initializeHeartbeatService, getHeartbeatService
 */

jest.mock("vscode", () => {
  const mockStatusBarItem = {
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    text: "",
    command: undefined,
    tooltip: "",
    backgroundColor: undefined
  }
  const mockConfigObj = {
    get: jest.fn((key: string, def: any) => {
      const vals: Record<string, any> = {
        enabled: true,
        model: "TestModel",
        every: "5m",
        ackMaxChars: 300,
        maxHistory: 100,
        maxConsecutiveErrors: 5,
        notifyOnAlert: true,
        notifyOnError: true
      }
      return vals[key] !== undefined ? vals[key] : def
    }),
    update: jest.fn().mockResolvedValue(undefined)
  }

  const disposablePush = jest.fn()

  return {
    workspace: {
      getConfiguration: jest.fn(() => mockConfigObj),
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() }))
    },
    window: {
      createStatusBarItem: jest.fn(() => mockStatusBarItem),
      showWarningMessage: jest.fn().mockResolvedValue(undefined),
      showInformationMessage: jest.fn().mockResolvedValue(undefined),
      showErrorMessage: jest.fn().mockResolvedValue(undefined)
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: jest.fn((id: string) => ({ id })),
    CancellationTokenSource: jest.fn(() => ({
      token: { isCancellationRequested: false },
      cancel: jest.fn(),
      dispose: jest.fn()
    })),
    ConfigurationTarget: { Workspace: 2 },
    commands: {
      executeCommand: jest.fn()
    }
  }
}, { virtual: true })

jest.mock("../../lib", () => ({ log: jest.fn() }))

jest.mock("./heartbeatLmClient", () => ({
  runHeartbeatLM: jest.fn()
}))

jest.mock("../funMessenger", () => ({
  funWindow: {
    createStatusBarItem: jest.fn(() => ({
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
      text: "",
      command: undefined,
      tooltip: "",
      backgroundColor: undefined
    })),
    showWarningMessage: jest.fn().mockResolvedValue(undefined),
    showInformationMessage: jest.fn().mockResolvedValue(undefined),
    showErrorMessage: jest.fn().mockResolvedValue(undefined)
  }
}))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { HeartbeatService, initializeHeartbeatService, getHeartbeatService } from "./heartbeatService"
import { HeartbeatStateManager } from "./heartbeatStateManager"
import { runHeartbeatLM } from "./heartbeatLmClient"

// ============================================================================
// HELPERS
// ============================================================================

let tmpDir: string
let context: any

function makeContext() {
  return {
    globalStorageUri: { fsPath: tmpDir },
    subscriptions: { push: jest.fn() }
  } as any
}

function makeRunHeartbeatLMMock(status: "ok" | "alert" | "error", extra: any = {}) {
  return jest.fn().mockResolvedValue({
    status,
    response: status === "ok" ? "HEARTBEAT_OK" : status === "alert" ? "Found 3 dumps!" : "",
    toolsUsed: [],
    durationMs: 500,
    error: status === "error" ? "LM error" : undefined,
    ...extra
  })
}

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-svc-"))
  context = makeContext()
  jest.clearAllMocks()

  const vscode = require("vscode")
  const funMessenger = require("../funMessenger")

  vscode.workspace.getConfiguration.mockReturnValue({
    get: jest.fn((key: string, def: any) => {
      const vals: Record<string, any> = {
        enabled: true,
        model: "TestModel",
        every: "5m",
        ackMaxChars: 300,
        maxHistory: 100,
        maxConsecutiveErrors: 5,
        notifyOnAlert: true,
        notifyOnError: true
      }
      return vals[key] !== undefined ? vals[key] : def
    }),
    update: jest.fn().mockResolvedValue(undefined)
  })

  vscode.workspace.onDidChangeConfiguration.mockReturnValue({ dispose: jest.fn() })

  funMessenger.funWindow.createStatusBarItem.mockReturnValue({
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    text: "",
    command: undefined,
    tooltip: "",
    backgroundColor: undefined
  })
  funMessenger.funWindow.showWarningMessage.mockResolvedValue(undefined)
  funMessenger.funWindow.showInformationMessage.mockResolvedValue(undefined)
  funMessenger.funWindow.showErrorMessage.mockResolvedValue(undefined)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ============================================================================
// initializeHeartbeatService / getHeartbeatService
// ============================================================================

describe("initializeHeartbeatService / getHeartbeatService", () => {
  test("creates a HeartbeatService instance", () => {
    const svc = initializeHeartbeatService(context)
    expect(svc).toBeInstanceOf(HeartbeatService)
  })

  test("getHeartbeatService returns the initialized instance", () => {
    const svc = initializeHeartbeatService(context)
    expect(getHeartbeatService()).toBe(svc)
  })

  test("re-initializing replaces the singleton", () => {
    const svc1 = initializeHeartbeatService(context)
    const svc2 = initializeHeartbeatService(makeContext())
    expect(getHeartbeatService()).toBe(svc2)
    expect(svc1).not.toBe(svc2)
  })
})

// ============================================================================
// HeartbeatService.start / stop
// ============================================================================

describe("HeartbeatService start / stop", () => {
  test("starts successfully when config is valid", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(svc.getStatus().isRunning).toBe(true)
    jest.useRealTimers()
    svc.stop()
  })

  test("does not start when enabled=false in config", async () => {
    const vscode = require("vscode")
    vscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, def: any) => key === "enabled" ? false : def)
    })
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(svc.getStatus().isRunning).toBe(false)
  })

  test("does not start when model is empty", async () => {
    const vscode = require("vscode")
    vscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "enabled") return true
        if (key === "model") return ""
        return def
      })
    })
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(svc.getStatus().isRunning).toBe(false)
  })

  test("does not start twice when already running", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    const status1 = svc.getStatus()
    await svc.start() // second call
    const status2 = svc.getStatus()
    expect(status1.isRunning).toBe(status2.isRunning)
    jest.useRealTimers()
    svc.stop()
  })

  test("stop() sets isRunning to false", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    svc.stop()
    expect(svc.getStatus().isRunning).toBe(false)
    jest.useRealTimers()
  })

  test("stop() is a no-op when already stopped", () => {
    const svc = initializeHeartbeatService(context)
    expect(() => svc.stop()).not.toThrow()
  })
})

// ============================================================================
// HeartbeatService.pause / resume
// ============================================================================

describe("HeartbeatService pause / resume", () => {
  test("pause() sets isPaused=true when running", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    svc.pause()
    expect(svc.getStatus().isPaused).toBe(true)
    jest.useRealTimers()
    svc.stop()
  })

  test("pause() is a no-op when not running", () => {
    const svc = initializeHeartbeatService(context)
    svc.pause()
    expect(svc.getStatus().isPaused).toBe(false)
  })

  test("resume() sets isPaused=false", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    svc.pause()
    svc.resume()
    expect(svc.getStatus().isPaused).toBe(false)
    jest.useRealTimers()
    svc.stop()
  })

  test("resume() is a no-op when not paused", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(() => svc.resume()).not.toThrow()
    jest.useRealTimers()
    svc.stop()
  })
})

// ============================================================================
// HeartbeatService.triggerNow
// ============================================================================

describe("HeartbeatService.triggerNow", () => {
  test("returns ran result when LM succeeds with ok status", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "ok",
      response: "HEARTBEAT_OK",
      toolsUsed: [],
      durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    const result = await svc.triggerNow()
    expect(result.status).toBe("ran")
  })

  test("returns ran result when LM returns alert", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "alert",
      response: "3 new dumps!",
      toolsUsed: [],
      durationMs: 200
    })
    const svc = initializeHeartbeatService(context)
    const result = await svc.triggerNow()
    expect(result.status).toBe("ran")
  })

  test("returns ran result when LM returns error status", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "error",
      response: "",
      toolsUsed: [],
      durationMs: 50,
      error: "LM error"
    })
    const svc = initializeHeartbeatService(context)
    const result = await svc.triggerNow()
    expect(result.status).toBe("ran")
  })

  test("records run in state manager", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "ok",
      response: "HEARTBEAT_OK",
      toolsUsed: ["tool1"],
      durationMs: 300
    })
    const svc = initializeHeartbeatService(context)
    await svc.triggerNow()
    const status = svc.getStatus()
    expect(status.stats.totalRuns).toBeGreaterThan(0)
  })

  test("shows notification when alert and notifyOnAlert=true", async () => {
    const funMessenger = require("../funMessenger")
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "alert",
      response: "Found new errors!",
      toolsUsed: [],
      durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    await svc.triggerNow()
    expect(funMessenger.funWindow.showInformationMessage).toHaveBeenCalled()
  })

  test("shows error notification when error and notifyOnError=true", async () => {
    const funMessenger = require("../funMessenger")
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "error",
      response: "",
      toolsUsed: [],
      durationMs: 50,
      error: "Connection refused"
    })
    const svc = initializeHeartbeatService(context)
    await svc.triggerNow()
    expect(funMessenger.funWindow.showErrorMessage).toHaveBeenCalled()
  })

  test("does not show notification when notifyOnAlert=false", async () => {
    const vscode = require("vscode")
    const funMessenger = require("../funMessenger")
    vscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "enabled") return true
        if (key === "model") return "TestModel"
        if (key === "every") return "5m"
        if (key === "notifyOnAlert") return false
        if (key === "notifyOnError") return true
        if (key === "ackMaxChars") return 300
        if (key === "maxHistory") return 100
        if (key === "maxConsecutiveErrors") return 5
        return def
      })
    })
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "alert",
      response: "Alert!",
      toolsUsed: [],
      durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    await svc.triggerNow()
    expect(funMessenger.funWindow.showInformationMessage).not.toHaveBeenCalled()
  })
})

// ============================================================================
// HeartbeatService.getStatus
// ============================================================================

describe("HeartbeatService.getStatus", () => {
  test("returns isRunning=false initially", () => {
    const svc = initializeHeartbeatService(context)
    expect(svc.getStatus().isRunning).toBe(false)
  })

  test("returns stats with totalRuns after triggerNow", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "ok", response: "HEARTBEAT_OK", toolsUsed: [], durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    await svc.triggerNow()
    expect(svc.getStatus().stats.totalRuns).toBe(1)
  })
})

// ============================================================================
// HeartbeatService.onEvent
// ============================================================================

describe("HeartbeatService.onEvent", () => {
  test("listener receives 'started' event when start() is called", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    const events: string[] = []
    svc.onEvent(e => events.push(e.type))
    await svc.start()
    expect(events).toContain("started")
    jest.useRealTimers()
    svc.stop()
  })

  test("listener receives 'stopped' event when stop() is called", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    const events: string[] = []
    svc.onEvent(e => events.push(e.type))
    svc.stop()
    expect(events).toContain("stopped")
    jest.useRealTimers()
  })

  test("listener receives 'beat_started' event on triggerNow", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "ok", response: "HEARTBEAT_OK", toolsUsed: [], durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    const events: string[] = []
    svc.onEvent(e => events.push(e.type))
    await svc.triggerNow()
    expect(events).toContain("beat_started")
    expect(events).toContain("beat_completed")
  })

  test("listener receives 'alert' event for alert response", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "alert", response: "New errors found!", toolsUsed: [], durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    const alertEvents: any[] = []
    svc.onEvent(e => { if (e.type === "alert") alertEvents.push(e) })
    await svc.triggerNow()
    expect(alertEvents).toHaveLength(1)
    expect((alertEvents[0] as any).message).toContain("New errors found!")
  })

  test("disposable removes listener", async () => {
    jest.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    const events: string[] = []
    const disposable = svc.onEvent(e => events.push(e.type))
    disposable.dispose()
    await svc.start()
    expect(events).toHaveLength(0)
    jest.useRealTimers()
    svc.stop()
  })

  test("error in listener does not crash the service", async () => {
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "ok", response: "HEARTBEAT_OK", toolsUsed: [], durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    svc.onEvent(() => { throw new Error("listener crash") })
    await expect(svc.triggerNow()).resolves.not.toThrow()
  })
})

// ============================================================================
// consecutive errors → auto-pause
// ============================================================================

describe("HeartbeatService consecutive error handling", () => {
  test("pauses after maxConsecutiveErrors errors when using timer-based beat", async () => {
    // Set maxConsecutiveErrors to 2 for faster testing
    const vscode = require("vscode")
    vscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "enabled") return true
        if (key === "model") return "TestModel"
        if (key === "every") return "5m"
        if (key === "maxConsecutiveErrors") return 2
        if (key === "ackMaxChars") return 300
        if (key === "maxHistory") return 100
        if (key === "notifyOnAlert") return false
        if (key === "notifyOnError") return false
        return def
      })
    })
    ;(runHeartbeatLM as jest.Mock).mockResolvedValue({
      status: "error", response: "", toolsUsed: [], durationMs: 50, error: "fail"
    })

    const svc = initializeHeartbeatService(context)
    // Manually trigger beats to accumulate errors
    await svc.triggerNow()
    await svc.triggerNow()
    // Third trigger should be skipped because maxConsecutiveErrors reached
    const result = await svc.triggerNow()
    expect(result.status).toBe("skipped")
    expect((result as any).reason).toBe("too-many-errors")
  })
})
