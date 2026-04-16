jest.mock("vscode", () => ({
  extensions: {
    getExtension: jest.fn().mockReturnValue({ packageJSON: { version: "2.1.0" } })
  },
  version: "1.85.0",
  Disposable: jest.fn().mockImplementation((fn: () => void) => ({ dispose: fn }))
}), { virtual: true })

jest.mock("../lib", () => ({ log: jest.fn() }))

jest.mock("applicationinsights", () => ({
  setup: jest.fn().mockReturnThis(),
  setAutoCollectRequests: jest.fn().mockReturnThis(),
  setAutoCollectPerformance: jest.fn().mockReturnThis(),
  setAutoCollectExceptions: jest.fn().mockReturnThis(),
  setAutoCollectDependencies: jest.fn().mockReturnThis(),
  setAutoCollectConsole: jest.fn().mockReturnThis(),
  setUseDiskRetryCaching: jest.fn().mockReturnThis(),
  setSendLiveMetrics: jest.fn().mockReturnThis(),
  setInternalLogging: jest.fn().mockReturnThis(),
  start: jest.fn(),
  defaultClient: {
    config: {
      maxBatchIntervalMs: 0,
      enableAutoCollectConsole: false,
      enableAutoCollectDependencies: false,
      enableAutoCollectExceptions: false,
      enableAutoCollectPerformance: false,
      enableAutoCollectRequests: false
    },
    commonProperties: {},
    trackEvent: jest.fn(),
    trackMetric: jest.fn(),
    flush: jest.fn()
  }
}))

jest.mock("os", () => ({
  hostname: jest.fn().mockReturnValue("test-machine"),
  userInfo: jest.fn().mockReturnValue({ username: "testuser" }),
  platform: jest.fn().mockReturnValue("linux"),
  arch: jest.fn().mockReturnValue("x64")
}))

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")
  return {
    ...actual,
    randomUUID: jest.fn().mockReturnValue("00000000-0000-0000-0000-000000000001")
  }
})

jest.mock("../config", () => ({
  RemoteManager: {
    get: jest.fn().mockReturnValue({
      byId: jest.fn().mockReturnValue(null),
      remoteList: jest.fn().mockReturnValue([])
    })
  }
}))

jest.mock("./sapSystemValidator", () => ({
  SapSystemValidator: {
    getInstance: jest.fn().mockReturnValue({
      getUserMapping: jest.fn().mockReturnValue(null)
    })
  }
}))

import { AppInsightsService } from "./appInsightsService"
import * as appInsights from "applicationinsights"

const mockDefaultClient = appInsights.defaultClient as any

function makeContext() {
  const subscriptions: any[] = []
  return {
    globalStorageUri: { fsPath: "/tmp/test-storage" },
    subscriptions,
    extension: { packageJSON: { version: "2.1.0" } }
  } as any as import("vscode").ExtensionContext
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(AppInsightsService as any).instance = undefined
})

// ─── getInstance ──────────────────────────────────────────────────────────────

describe("AppInsightsService.getInstance", () => {
  test("throws without context on first call", () => {
    expect(() => AppInsightsService.getInstance()).toThrow(
      "AppInsightsService requires ExtensionContext"
    )
  })

  test("creates instance with context", () => {
    const ctx = makeContext()
    const svc = AppInsightsService.getInstance(ctx)
    expect(svc).toBeDefined()
  })

  test("returns same instance on subsequent calls", () => {
    const ctx = makeContext()
    const a = AppInsightsService.getInstance(ctx)
    const b = AppInsightsService.getInstance()
    expect(a).toBe(b)
  })
})

// ─── track — not initialized ──────────────────────────────────────────────────

describe("AppInsightsService.track when not initialized (placeholder key)", () => {
  test("does nothing when isInitialized is false", () => {
    // The connection string in source contains 'your-key-here', so initialize() bails out
    const ctx = makeContext()
    const svc = AppInsightsService.getInstance(ctx)

    svc.track("command_activate_called")

    expect(mockDefaultClient.trackEvent).not.toHaveBeenCalled()
  })
})

// ─── parseTelemetryText ───────────────────────────────────────────────────────

describe("parseTelemetryText (via private method access)", () => {
  test("parses command action", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("command_activate_called")
    expect(result).toEqual({ type: "command", name: "activate" })
  })

  test("parses tool action", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("tool_search_abap_objects_called")
    expect(result).toEqual({ type: "tool", name: "search_abap_objects" })
  })

  test("parses code change action", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("Number of code lines changed: 42")
    expect(result).toEqual({ type: "code_change", linesChanged: 42 })
  })

  test("returns unknown for unrecognized action", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("something_random")
    expect(result).toEqual({ type: "unknown" })
  })

  test("action missing _called suffix is not parsed as command", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("command_activate")
    expect(result.type).toBe("unknown")
  })

  test("action missing command_ prefix is not parsed as command", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("activate_called")
    expect(result.type).toBe("unknown")
  })

  test("code change with invalid number returns unknown", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("Number of code lines changed: not-a-number")
    expect(result.type).toBe("unknown")
  })

  test("code change with 0 lines", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).parseTelemetryText("Number of code lines changed: 0")
    expect(result).toEqual({ type: "code_change", linesChanged: 0 })
  })
})

// ─── flush ────────────────────────────────────────────────────────────────────

describe("AppInsightsService.flush", () => {
  test("does nothing when not initialized", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    // isInitialized is false because placeholder key
    expect(() => svc.flush()).not.toThrow()
    expect(mockDefaultClient.flush).not.toHaveBeenCalled()
  })
})

// ─── getUserMapping priority ──────────────────────────────────────────────────

describe("getUserMapping priority", () => {
  test("returns null when no username can be resolved", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())
    const result = (svc as any).getUserMapping(undefined)
    expect(result).toBeNull()
  })

  test("uses username directly when provided", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())

    const mockValidator = require("./sapSystemValidator").SapSystemValidator.getInstance()
    mockValidator.getUserMapping.mockReturnValue({ uniqueId: "dev-abc", manager: "Boss" })

    const result = (svc as any).getUserMapping({ username: "john.doe" })
    expect(mockValidator.getUserMapping).toHaveBeenCalledWith("john.doe")
  })

  test("returns null when validator getUserMapping returns null", () => {
    ;(AppInsightsService as any).instance = undefined
    const svc = AppInsightsService.getInstance(makeContext())

    const mockValidator = require("./sapSystemValidator").SapSystemValidator.getInstance()
    mockValidator.getUserMapping.mockReturnValue(null)

    const result = (svc as any).getUserMapping({ username: "unknown.user" })
    expect(result).toBeNull()
  })
})
