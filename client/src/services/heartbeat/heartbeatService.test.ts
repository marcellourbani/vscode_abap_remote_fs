/**
 * Tests for heartbeatService.ts - HeartbeatService, initializeHeartbeatService, getHeartbeatService
 */

vi.mock("vscode", () => {
  const mockStatusBarItem = {
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: "",
    command: undefined,
    tooltip: "",
    backgroundColor: undefined
  }
  const mockConfigObj = {
    get: vi.fn(function (key: string, def: any) {
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
    update: vi.fn().mockResolvedValue(undefined)
  }

  const disposablePush = vi.fn()

  return {
    workspace: {
      getConfiguration: vi.fn(function () {
        return mockConfigObj
      }),
      onDidChangeConfiguration: vi.fn(function () {
        return { dispose: vi.fn() }
      })
    },
    window: {
      createStatusBarItem: vi.fn(function () {
        return mockStatusBarItem
      }),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined)
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: vi.fn(function (id: string) {
      return { id }
    }),
    CancellationTokenSource: vi.fn(function () {
      return {
        token: { isCancellationRequested: false },
        cancel: vi.fn(),
        dispose: vi.fn()
      }
    }),
    ConfigurationTarget: { Workspace: 2 },
    commands: {
      executeCommand: vi.fn()
    }
  }
})

vi.mock("../../lib", () => ({ log: vi.fn() }))

vi.mock("./heartbeatLmClient", () => ({
  runHeartbeatLM: vi.fn()
}))

vi.mock("../funMessenger", () => ({
  funWindow: {
    createStatusBarItem: vi.fn(function () {
      return {
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        text: "",
        command: undefined,
        tooltip: "",
        backgroundColor: undefined
      }
    }),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined)
  }
}))

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  HeartbeatService,
  initializeHeartbeatService,
  getHeartbeatService
} from "./heartbeatService"
import { HeartbeatStateManager } from "./heartbeatStateManager"
import { runHeartbeatLM } from "./heartbeatLmClient"
import * as __$mock_vscode from "vscode"
import * as __$mock_funMessenger from "../funMessenger"
import type { Mock } from "vitest"

// ============================================================================
// HELPERS
// ============================================================================

let tmpDir: string
let context: any

function makeContext() {
  return {
    globalStorageUri: { fsPath: tmpDir },
    subscriptions: { push: vi.fn() }
  } as any
}

function makeRunHeartbeatLMMock(status: "ok" | "alert" | "error", extra: any = {}) {
  return vi.fn().mockResolvedValue({
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
  vi.clearAllMocks()

  const vscode = __$mock_vscode
  const funMessenger = __$mock_funMessenger

  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: vi.fn(function (key: string, def: any) {
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
    update: vi.fn().mockResolvedValue(undefined)
  } as any)

  vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() })

  vi.mocked(funMessenger.funWindow.createStatusBarItem).mockReturnValue({
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: "",
    command: undefined,
    tooltip: "",
    backgroundColor: undefined
  } as any)
  vi.mocked(funMessenger.funWindow.showWarningMessage).mockResolvedValue(undefined)
  vi.mocked(funMessenger.funWindow.showInformationMessage).mockResolvedValue(undefined)
  vi.mocked(funMessenger.funWindow.showErrorMessage).mockResolvedValue(undefined)
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
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(svc.getStatus().isRunning).toBe(true)
    vi.useRealTimers()
    svc.stop()
  })

  test("does not start when enabled=false in config", async () => {
    const vscode = __$mock_vscode
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(function (key: string, def: any) {
        return key === "enabled" ? false : def
      })
    } as any)
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(svc.getStatus().isRunning).toBe(false)
  })

  test("does not start when model is empty", async () => {
    const vscode = __$mock_vscode
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(function (key: string, def: any) {
        if (key === "enabled") return true
        if (key === "model") return ""
        return def
      })
    } as any)
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(svc.getStatus().isRunning).toBe(false)
  })

  test("does not start twice when already running", async () => {
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    const status1 = svc.getStatus()
    await svc.start() // second call
    const status2 = svc.getStatus()
    expect(status1.isRunning).toBe(status2.isRunning)
    vi.useRealTimers()
    svc.stop()
  })

  test("stop() sets isRunning to false", async () => {
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    svc.stop()
    expect(svc.getStatus().isRunning).toBe(false)
    vi.useRealTimers()
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
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    svc.pause()
    expect(svc.getStatus().isPaused).toBe(true)
    vi.useRealTimers()
    svc.stop()
  })

  test("pause() is a no-op when not running", () => {
    const svc = initializeHeartbeatService(context)
    svc.pause()
    expect(svc.getStatus().isPaused).toBe(false)
  })

  test("resume() sets isPaused=false", async () => {
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    svc.pause()
    svc.resume()
    expect(svc.getStatus().isPaused).toBe(false)
    vi.useRealTimers()
    svc.stop()
  })

  test("resume() is a no-op when not paused", async () => {
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    expect(() => svc.resume()).not.toThrow()
    vi.useRealTimers()
    svc.stop()
  })
})

// ============================================================================
// HeartbeatService.triggerNow
// ============================================================================

describe("HeartbeatService.triggerNow", () => {
  test("returns ran result when LM succeeds with ok status", async () => {
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    const funMessenger = __$mock_funMessenger
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    const funMessenger = __$mock_funMessenger
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    const vscode = __$mock_vscode
    const funMessenger = __$mock_funMessenger
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(function (key: string, def: any) {
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
    } as any)
    ;(runHeartbeatLM as Mock).mockResolvedValue({
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
    ;(runHeartbeatLM as Mock).mockResolvedValue({
      status: "ok",
      response: "HEARTBEAT_OK",
      toolsUsed: [],
      durationMs: 100
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
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    const events: string[] = []
    svc.onEvent(e => events.push(e.type))
    await svc.start()
    expect(events).toContain("started")
    vi.useRealTimers()
    svc.stop()
  })

  test("listener receives 'stopped' event when stop() is called", async () => {
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    await svc.start()
    const events: string[] = []
    svc.onEvent(e => events.push(e.type))
    svc.stop()
    expect(events).toContain("stopped")
    vi.useRealTimers()
  })

  test("listener receives 'beat_started' event on triggerNow", async () => {
    ;(runHeartbeatLM as Mock).mockResolvedValue({
      status: "ok",
      response: "HEARTBEAT_OK",
      toolsUsed: [],
      durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    const events: string[] = []
    svc.onEvent(e => events.push(e.type))
    await svc.triggerNow()
    expect(events).toContain("beat_started")
    expect(events).toContain("beat_completed")
  })

  test("listener receives 'alert' event for alert response", async () => {
    ;(runHeartbeatLM as Mock).mockResolvedValue({
      status: "alert",
      response: "New errors found!",
      toolsUsed: [],
      durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    const alertEvents: any[] = []
    svc.onEvent(e => {
      if (e.type === "alert") alertEvents.push(e)
    })
    await svc.triggerNow()
    expect(alertEvents).toHaveLength(1)
    expect((alertEvents[0] as any).message).toContain("New errors found!")
  })

  test("disposable removes listener", async () => {
    vi.useFakeTimers()
    const svc = initializeHeartbeatService(context)
    const events: string[] = []
    const disposable = svc.onEvent(e => events.push(e.type))
    disposable.dispose()
    await svc.start()
    expect(events).toHaveLength(0)
    vi.useRealTimers()
    svc.stop()
  })

  test("error in listener does not crash the service", async () => {
    ;(runHeartbeatLM as Mock).mockResolvedValue({
      status: "ok",
      response: "HEARTBEAT_OK",
      toolsUsed: [],
      durationMs: 100
    })
    const svc = initializeHeartbeatService(context)
    svc.onEvent(() => {
      throw new Error("listener crash")
    })
    await expect(svc.triggerNow()).resolves.not.toThrow()
  })
})

// ============================================================================
// consecutive errors → auto-pause
// ============================================================================

describe("HeartbeatService consecutive error handling", () => {
  test("pauses after maxConsecutiveErrors errors when using timer-based beat", async () => {
    // Set maxConsecutiveErrors to 2 for faster testing
    const vscode = __$mock_vscode
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(function (key: string, def: any) {
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
    } as any)
    ;(runHeartbeatLM as Mock).mockResolvedValue({
      status: "error",
      response: "",
      toolsUsed: [],
      durationMs: 50,
      error: "fail"
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
