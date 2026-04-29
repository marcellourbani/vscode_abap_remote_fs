jest.mock("vscode", () => ({
  extensions: {
    getExtension: jest.fn().mockReturnValue({ packageJSON: { version: "2.1.0" } })
  },
  Disposable: jest.fn().mockImplementation((fn: () => void) => ({ dispose: fn })),
  commands: { executeCommand: jest.fn() }
}), { virtual: true })

jest.mock("./appInsightsService", () => ({
  AppInsightsService: {
    getInstance: jest.fn().mockReturnValue({ track: jest.fn() })
  }
}))

jest.mock("./reviewPrompt", () => ({
  incrementReviewCounter: jest.fn()
}))

jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  promises: {
    appendFile: jest.fn().mockResolvedValue(undefined)
  }
}))

jest.mock("os", () => ({
  hostname: jest.fn().mockReturnValue("test-machine"),
  userInfo: jest.fn().mockReturnValue({ username: "testuser" }),
  platform: jest.fn().mockReturnValue("linux")
}))

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")
  return {
    ...actual,
    randomUUID: jest.fn().mockReturnValue("00000000-0000-0000-0000-000000000001")
  }
})

import { TelemetryService, logTelemetry } from "./telemetry"
import { AppInsightsService } from "./appInsightsService"
import { incrementReviewCounter } from "./reviewPrompt"
import * as vscode from "vscode"
import * as fs from "fs"

const mockAppInsights = AppInsightsService.getInstance as jest.Mock
const mockIncrementReviewCounter = incrementReviewCounter as jest.Mock
const mockVscodeCommands = vscode.commands as any

function makeContext(version = "2.1.0") {
  const subscriptions: any[] = []
  return {
    globalStorageUri: { fsPath: "/tmp/test-storage" },
    subscriptions,
    extension: { packageJSON: { version } }
  } as any as import("vscode").ExtensionContext
}

beforeEach(() => {
  jest.clearAllMocks()
  // Reset singleton
  ;(TelemetryService as any).instance = undefined
})

// ─── initialize / getInstance ────────────────────────────────────────────────

describe("TelemetryService.initialize and getInstance", () => {
  test("initialize creates instance", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    expect(() => TelemetryService.getInstance()).not.toThrow()
  })

  test("getInstance throws when not initialized", () => {
    expect(() => TelemetryService.getInstance()).toThrow("TelemetryService not initialized")
  })

  test("initialize is idempotent — only one instance created", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const first = TelemetryService.getInstance()
    TelemetryService.initialize(ctx)
    const second = TelemetryService.getInstance()
    expect(first).toBe(second)
  })
})

// ─── log ─────────────────────────────────────────────────────────────────────

describe("TelemetryService.log", () => {
  test("buffered entry appears in getStats", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()

    svc.log("test_action")
    expect(svc.getStats().bufferSize).toBe(1)
  })

  test("multiple entries accumulate in buffer", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()

    svc.log("action_1")
    svc.log("action_2")
    svc.log("action_3")
    expect(svc.getStats().bufferSize).toBe(3)
  })

  test("buffer does not grow beyond maxBufferSize (1000)", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()

    // Fill beyond max - auto-flush fires at 25, so we need to prevent flushes
    jest.spyOn(svc as any, "flushToFile").mockImplementation(() => {
      // no-op to prevent real flushing during this test
    })

    for (let i = 0; i < 1100; i++) {
      svc.log(`action_${i}`)
    }

    expect(svc.getStats().bufferSize).toBeLessThanOrEqual(1000)
  })
})

// ─── getStats ─────────────────────────────────────────────────────────────────

describe("TelemetryService.getStats", () => {
  test("returns sessionId, userId, version and bufferSize", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()

    const stats = svc.getStats()
    expect(stats).toHaveProperty("sessionId")
    expect(stats).toHaveProperty("userId")
    expect(stats).toHaveProperty("version")
    expect(stats).toHaveProperty("bufferSize")
    expect(typeof stats.bufferSize).toBe("number")
  })

  test("sessionId starts with 'session-'", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()
    expect(svc.getStats().sessionId).toMatch(/^session-/)
  })

  test("userId starts with 'user-'", () => {
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()
    expect(svc.getStats().userId).toMatch(/^user-/)
  })

  test("version comes from extension context", () => {
    const ctx = makeContext("2.1.0")
    TelemetryService.initialize(ctx)
    const svc = TelemetryService.getInstance()
    // The version is read from vscode.extensions.getExtension(), which is mocked to return "2.1.0"
    expect(svc.getStats().version).toBe("2.1.0")
  })
})

// ─── logTelemetry ─────────────────────────────────────────────────────────────

describe("logTelemetry", () => {
  beforeEach(() => {
    ;(TelemetryService as any).instance = undefined
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
  })

  test("calls AppInsightsService.track", () => {
    const trackMock = jest.fn()
    mockAppInsights.mockReturnValue({ track: trackMock })

    logTelemetry("command_activate_called")
    expect(trackMock).toHaveBeenCalledWith("command_activate_called", undefined)
  })

  test("calls incrementReviewCounter for command_ actions", () => {
    mockAppInsights.mockReturnValue({ track: jest.fn() })
    logTelemetry("command_activate_called")
    expect(mockIncrementReviewCounter).toHaveBeenCalled()
  })

  test("calls incrementReviewCounter for tool_ actions", () => {
    mockAppInsights.mockReturnValue({ track: jest.fn() })
    logTelemetry("tool_search_abap_objects_called")
    expect(mockIncrementReviewCounter).toHaveBeenCalled()
  })

  test("does NOT call incrementReviewCounter for non-command/tool actions", () => {
    mockAppInsights.mockReturnValue({ track: jest.fn() })
    logTelemetry("some_internal_event")
    expect(mockIncrementReviewCounter).not.toHaveBeenCalled()
  })

  test("sets walkthrough context key for known tool actions", () => {
    mockAppInsights.mockReturnValue({ track: jest.fn() })
    logTelemetry("tool_search_abap_objects_called")
    expect(mockVscodeCommands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "abapfs:toolUsed:search",
      true
    )
  })

  test("does not set context key for unknown actions", () => {
    mockAppInsights.mockReturnValue({ track: jest.fn() })
    logTelemetry("completely_unknown_action")
    expect(mockVscodeCommands.executeCommand).not.toHaveBeenCalled()
  })

  test("silently handles AppInsights failures", () => {
    mockAppInsights.mockReturnValue({
      track: jest.fn().mockImplementation(() => {
        throw new Error("AppInsights down")
      })
    })

    expect(() => logTelemetry("command_activate_called")).not.toThrow()
  })

  test("passes options to AppInsights.track", () => {
    const trackMock = jest.fn()
    mockAppInsights.mockReturnValue({ track: trackMock })

    const options = { connectionId: "dev100" }
    logTelemetry("tool_search_abap_objects_called", options)

    expect(trackMock).toHaveBeenCalledWith("tool_search_abap_objects_called", options)
  })
})

// ─── shouldCountForReviewPrompt (indirect via logTelemetry) ──────────────────

describe("shouldCountForReviewPrompt logic", () => {
  beforeEach(() => {
    ;(TelemetryService as any).instance = undefined
    const ctx = makeContext()
    TelemetryService.initialize(ctx)
    mockAppInsights.mockReturnValue({ track: jest.fn() })
  })

  const shouldCount = ["command_anything_called", "tool_anything_called"]
  const shouldNotCount = ["Number of code lines changed: 5", "internal_event", ""]

  test.each(shouldCount)("'%s' counts toward review prompt", action => {
    logTelemetry(action)
    expect(mockIncrementReviewCounter).toHaveBeenCalled()
  })

  test.each(shouldNotCount)("'%s' does NOT count toward review prompt", action => {
    logTelemetry(action)
    expect(mockIncrementReviewCounter).not.toHaveBeenCalled()
  })
})
