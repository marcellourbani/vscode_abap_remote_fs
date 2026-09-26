vi.mock("abap-adt-api", () => ({
  isAdtError: vi.fn(function (e: any) {
    return e && e.__isAdtError === true
  }),
  session_types: { stateful: "stateful" }
}))
vi.mock("vscode", () => ({
  EventEmitter: vi.fn().mockImplementation(function () {
    const listeners: any[] = []
    return {
      event: vi.fn((listener: any, _thisArg?: any, disposables?: any[]) => {
        listeners.push(listener)
        const d = { dispose: vi.fn() }
        if (Array.isArray(disposables)) disposables.push(d)
        return d
      }),
      fire: vi.fn((e: any) => {
        listeners.forEach(l => l(e))
      }),
      dispose: vi.fn()
    }
  }),
  Disposable: vi.fn().mockImplementation(function (fn: any) {
    return { dispose: fn }
  })
}))
vi.mock("@vscode/debugadapter", () => ({
  ContinuedEvent: vi.fn().mockImplementation(function (threadId: number) {
    return { type: "continued", threadId }
  }),
  StoppedEvent: vi.fn().mockImplementation(function (reason: string, threadId: number) {
    return {
      type: "stopped",
      reason,
      threadId
    }
  }),
  ThreadEvent: vi.fn().mockImplementation(function (reason: string, threadId: number) {
    return {
      type: "thread",
      reason,
      threadId
    }
  }),
  Source: vi.fn().mockImplementation(function (name: string, path: string) {
    return { name, path }
  })
}))
vi.mock("./functions", () => ({
  newClientFromKey: vi.fn()
}))
vi.mock("../../lib", () => ({
  log: vi.fn(),
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  ignore: vi.fn()
}))
vi.mock("../../langClient", () => ({
  vsCodeUri: vi.fn()
}))
vi.mock("./debugListener", () => ({
  THREAD_EXITED: "exited",
  errorType: vi.fn()
}))
vi.mock("./replay/types", () => ({}))

import { DebugService, idThread, isEnded, STACK_THREAD_MULTIPLIER } from "./debugService"
import { ADTClient, isAdtError, session_types } from "abap-adt-api"
import { newClientFromKey } from "./functions"
import { vsCodeUri } from "../../langClient"
import { errorType } from "./debugListener"
import type { MockedFunction } from "vitest"

const mockNewClientFromKey = newClientFromKey as MockedFunction<typeof newClientFromKey>
const mockIsAdtError = isAdtError as MockedFunction<typeof isAdtError>
const mockVsCodeUri = vsCodeUri as MockedFunction<typeof vsCodeUri>
const mockErrorType = errorType as MockedFunction<typeof errorType>

function makeClient(overrides: Partial<any> = {}) {
  const client = {
    stateful: undefined as any,
    statelessClone: {
      logout: vi.fn().mockResolvedValue(undefined),
      debuggerDeleteBreakpoints: vi.fn().mockResolvedValue(undefined)
    },
    adtCoreDiscovery: vi.fn().mockResolvedValue(undefined),
    debuggerAttach: vi.fn().mockResolvedValue(undefined),
    debuggerSaveSettings: vi.fn().mockResolvedValue(undefined),
    debuggerStackTrace: vi.fn().mockResolvedValue({ stack: [] }),
    debuggerStep: vi.fn().mockResolvedValue({}),
    dropSession: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }

  return client as typeof client & ADTClient
}

function makeDebuggee(overrides: Partial<any> = {}) {
  return {
    DEBUGGEE_ID: "DEBUGGEE1",
    NAME: "TestUser",
    CLIENT: "100",
    TERMINAL_ID: "TERM1",
    IDE_ID: "IDE1",
    DEBUGGEE_USER: "TESTUSER",
    DEBUGGEE_TYPE: "user",
    ...overrides
  } as any
}

function makeUI() {
  return {
    Confirmator: vi.fn().mockResolvedValue(true),
    ShowError: vi.fn()
  }
}

function makeListener(overrides: Partial<any> = {}) {
  return {
    mode: "user",
    username: "TESTUSER",
    variableManager: {
      resetHandle: vi.fn()
    },
    shouldRecordThread: vi.fn().mockReturnValue(false),
    recorder: undefined,
    ...overrides
  } as any
}

describe("idThread", () => {
  test("divides by STACK_THREAD_MULTIPLIER and floors", () => {
    expect(idThread(1 * STACK_THREAD_MULTIPLIER)).toBe(1)
    expect(idThread(2 * STACK_THREAD_MULTIPLIER + 5)).toBe(2)
    expect(idThread(0)).toBe(0)
  })
})

describe("isEnded", () => {
  test("returns true when errorType is debuggeeEnded", () => {
    mockErrorType.mockReturnValueOnce("debuggeeEnded")
    expect(isEnded(new Error("ended"))).toBe(true)
  })

  test("returns false when errorType is something else", () => {
    mockErrorType.mockReturnValueOnce("somethingElse")
    expect(isEnded(new Error("other"))).toBe(false)
  })

  test("returns false when errorType is undefined", () => {
    mockErrorType.mockReturnValueOnce(undefined)
    expect(isEnded(new Error("no type"))).toBe(false)
  })
})

describe("DebugService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("throws when client cannot be created", async () => {
    mockNewClientFromKey.mockResolvedValueOnce(undefined as any)
    const listener = makeListener()
    const ui = makeUI()
    await expect(DebugService.create("TST", ui, listener, makeDebuggee())).rejects.toThrow(
      "Unable to create client for TST"
    )
  })

  test("creates service and sets stateful session", async () => {
    const client = makeClient()
    mockNewClientFromKey.mockResolvedValueOnce(client as any)
    const listener = makeListener()
    const ui = makeUI()
    const service = await DebugService.create("TST", ui, listener, makeDebuggee())
    expect(service).toBeInstanceOf(DebugService)
    expect(client.stateful).toBe(session_types.stateful)
    expect(client.adtCoreDiscovery).toHaveBeenCalled()
  })
})

describe("DebugService instance", () => {
  let client: ReturnType<typeof makeClient>
  let listener: ReturnType<typeof makeListener>
  let ui: ReturnType<typeof makeUI>
  let service: DebugService

  beforeEach(() => {
    vi.clearAllMocks()
    client = makeClient()
    listener = makeListener()
    ui = makeUI()
    service = new (DebugService as any)("TST", client, listener, makeDebuggee(), ui)
    service.threadId = 1
  })

  describe("client getter", () => {
    test("returns client when not killed", () => {
      expect(service.client).toBe(client)
    })

    test("throws when killed via logout", async () => {
      await service.logout()
      expect(() => service.client).toThrow("Disconnected")
    })
  })

  describe("getStack", () => {
    test("returns empty array initially", () => {
      expect(service.getStack()).toEqual([])
    })
  })

  describe("addListener", () => {
    test("adds event listener and returns disposable", () => {
      const handler = vi.fn()
      const disposable = service.addListener(handler)
      expect(disposable).toBeDefined()
      expect(typeof disposable.dispose).toBe("function")
    })
  })

  describe("debuggerStep", () => {
    test("fires StoppedEvent on success", async () => {
      client.debuggerStep.mockResolvedValueOnce({})
      client.debuggerStackTrace.mockResolvedValueOnce({ stack: [] })

      const events: any[] = []
      service.addListener((e: any) => events.push(e))
      await service.debuggerStep("stepOver", 1)
      // Should have fired ContinuedEvent and StoppedEvent
      expect(events.length).toBeGreaterThanOrEqual(1)
    })

    test("calls ShowError on non-ADT error", async () => {
      client.debuggerStep.mockRejectedValueOnce(new Error("generic failure"))
      mockIsAdtError.mockReturnValueOnce(false)
      await service.debuggerStep("stepOver", 1)
      expect(ui.ShowError).toHaveBeenCalled()
    })

    test("fires ThreadEvent on ended ADT error (non-jump)", async () => {
      const adtErr = { __isAdtError: true, message: "ended" }
      client.debuggerStep.mockRejectedValueOnce(adtErr)
      mockIsAdtError.mockReturnValueOnce(true)
      mockErrorType.mockReturnValueOnce("debuggeeEnded") // isEnded = true
      const events: any[] = []
      service.addListener((e: any) => events.push(e))
      await service.debuggerStep("stepOver", 1)
      expect(events.some((e: any) => e.type === "thread")).toBe(true)
    })

    test("rethrows on jump step with ADT error", async () => {
      const adtErr = { __isAdtError: true, message: "not possible" }
      client.debuggerStep.mockRejectedValueOnce(adtErr)
      mockIsAdtError.mockReturnValueOnce(true)
      mockErrorType.mockReturnValueOnce("stepNotPossible") // not ended
      await expect(service.debuggerStep("stepRunToLine", 1, "some-url")).rejects.toBeDefined()
    })
  })

  describe("attach", () => {
    test("calls debuggerAttach and updateStack", async () => {
      client.debuggerStackTrace.mockResolvedValueOnce({ stack: [] })
      await service.attach()
      expect(client.debuggerAttach).toHaveBeenCalledWith("user", "DEBUGGEE1", "TESTUSER", true)
    })

    test("saves the connection system debugging setting", async () => {
      const systemDebugging = makeListener({ systemDebugging: true })
      const configuredService = new DebugService(
        "conn",
        client,
        systemDebugging,
        makeDebuggee(),
        makeUI()
      )

      await configuredService.attach()

      expect(client.debuggerSaveSettings).toHaveBeenCalledWith({ systemDebugging: true })
    })
  })

  describe("post-mortem debugging", () => {
    test("attach captures post-mortem state from attach response", async () => {
      client.debuggerAttach.mockResolvedValueOnce({ isPostMortem: true })
      await service.attach()
      expect(service.isPostMortem).toBe(true)
      expect(service.stoppedReason).toBe("exception")
    })

    test("normal attach is not post-mortem", async () => {
      client.debuggerAttach.mockResolvedValueOnce({
        isPostMortem: false,
        isSteppingPossible: true
      })
      await service.attach()
      expect(service.isPostMortem).toBe(false)
      expect(service.stoppedReason).toBe("breakpoint")
    })

    test("debuggee with dump id is post-mortem before attach", () => {
      const dumped = new (DebugService as any)(
        "TST",
        client,
        listener,
        makeDebuggee({ DUMPID: "DUMP123" }),
        ui
      )
      expect(dumped.isPostMortem).toBe(true)
      expect(dumped.stoppedReason).toBe("exception")
      expect(dumped.stoppedText).toContain("DUMP123")
    })

    test("step is refused without calling SAP when post-mortem", async () => {
      client.debuggerAttach.mockResolvedValueOnce({ isPostMortem: true })
      await service.attach()
      const events: any[] = []
      service.addListener((e: any) => events.push(e))
      await expect(service.debuggerStep("stepOver", 1)).rejects.toThrow(
        "Stepping is not possible in this state. Inspection only - continue to close the thread"
      )
      expect(client.debuggerStep).not.toHaveBeenCalled()
      expect(ui.ShowError).toHaveBeenCalled()
      expect(events.length).toBe(0)
    })

    test("continue on post-mortem thread reports thread exited", async () => {
      client.debuggerAttach.mockResolvedValueOnce({ isPostMortem: true })
      await service.attach()
      const events: any[] = []
      service.addListener((e: any) => events.push(e))
      await service.debuggerStep("stepContinue", 1)
      expect(client.debuggerStep).not.toHaveBeenCalled()
      expect(events.some((e: any) => e.type === "thread" && e.reason === "exited")).toBe(true)
    })

    test("jump step throws when post-mortem", async () => {
      client.debuggerAttach.mockResolvedValueOnce({ isPostMortem: true })
      await service.attach()
      await expect(service.debuggerStep("stepJumpToLine", 1, "some-url")).rejects.toThrow()
      expect(client.debuggerStep).not.toHaveBeenCalled()
    })

    test("stepping blocked when attach reports stepping impossible", async () => {
      client.debuggerAttach.mockResolvedValueOnce({ isSteppingPossible: false })
      await service.attach()
      await expect(service.debuggerStep("stepOver", 1)).rejects.toThrow(
        "Stepping is not possible in this state. Inspection only - continue to close the thread"
      )
      expect(client.debuggerStep).not.toHaveBeenCalled()
      expect(ui.ShowError).toHaveBeenCalled()
    })

    test("step result with isSteppingPossible false blocks further steps", async () => {
      client.debuggerStep.mockResolvedValueOnce({ isSteppingPossible: false })
      await service.debuggerStep("stepOver", 1)
      expect(client.debuggerStep).toHaveBeenCalledTimes(1)
      await expect(service.debuggerStep("stepOver", 1)).rejects.toThrow(
        "Stepping is not possible in this state. Inspection only - continue to close the thread"
      )
      expect(client.debuggerStep).toHaveBeenCalledTimes(1)
      expect(ui.ShowError).toHaveBeenCalled()
    })
  })

  describe("logout", () => {
    test("calls client logout", async () => {
      await service.logout()
      expect(client.logout).toHaveBeenCalled()
    })

    test("is idempotent - second logout is no-op", async () => {
      await service.logout()
      await service.logout()
      // logout on client only called once
      expect(client.logout).toHaveBeenCalledTimes(1)
    })
  })
})
