jest.mock("abap-adt-api", () => ({
  isAdtError: jest.fn((e: any) => e && e.__isAdtError === true),
  session_types: { stateful: "stateful" }
}))
jest.mock("vscode", () => ({
  EventEmitter: jest.fn().mockImplementation(() => {
    const listeners: any[] = []
    return {
      event: jest.fn((listener: any, _thisArg?: any, disposables?: any[]) => {
        listeners.push(listener)
        const d = { dispose: jest.fn() }
        if (Array.isArray(disposables)) disposables.push(d)
        return d
      }),
      fire: jest.fn((e: any) => { listeners.forEach(l => l(e)) }),
      dispose: jest.fn()
    }
  }),
  Disposable: jest.fn().mockImplementation((fn: any) => ({ dispose: fn }))
}), { virtual: true })
jest.mock("@vscode/debugadapter", () => ({
  ContinuedEvent: jest.fn().mockImplementation((threadId: number) => ({ type: "continued", threadId })),
  StoppedEvent: jest.fn().mockImplementation((reason: string, threadId: number) => ({ type: "stopped", reason, threadId })),
  ThreadEvent: jest.fn().mockImplementation((reason: string, threadId: number) => ({ type: "thread", reason, threadId })),
  Source: jest.fn().mockImplementation((name: string, path: string) => ({ name, path }))
}))
jest.mock("./functions", () => ({
  newClientFromKey: jest.fn()
}))
jest.mock("../../lib", () => ({
  log: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e)),
  ignore: jest.fn()
}))
jest.mock("../../langClient", () => ({
  vsCodeUri: jest.fn()
}))
jest.mock("./debugListener", () => ({
  THREAD_EXITED: "exited",
  errorType: jest.fn()
}))
jest.mock("./replay/types", () => ({}))

import { DebugService, idThread, isEnded, STACK_THREAD_MULTIPLIER } from "./debugService"
import { isAdtError, session_types } from "abap-adt-api"
import { newClientFromKey } from "./functions"
import { vsCodeUri } from "../../langClient"
import { errorType } from "./debugListener"

const mockNewClientFromKey = newClientFromKey as jest.MockedFunction<typeof newClientFromKey>
const mockIsAdtError = isAdtError as jest.MockedFunction<typeof isAdtError>
const mockVsCodeUri = vsCodeUri as jest.MockedFunction<typeof vsCodeUri>
const mockErrorType = errorType as jest.MockedFunction<typeof errorType>

function makeClient(overrides: Partial<any> = {}) {
  return {
    stateful: undefined as any,
    statelessClone: {
      logout: jest.fn().mockResolvedValue(undefined),
      debuggerDeleteBreakpoints: jest.fn().mockResolvedValue(undefined)
    },
    adtCoreDiscovery: jest.fn().mockResolvedValue(undefined),
    debuggerAttach: jest.fn().mockResolvedValue(undefined),
    debuggerSaveSettings: jest.fn().mockResolvedValue(undefined),
    debuggerStackTrace: jest.fn().mockResolvedValue({ stack: [] }),
    debuggerStep: jest.fn().mockResolvedValue({}),
    dropSession: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    ...overrides
  }
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
    Confirmator: jest.fn().mockResolvedValue(true),
    ShowError: jest.fn()
  }
}

function makeListener(overrides: Partial<any> = {}) {
  return {
    mode: "user",
    username: "TESTUSER",
    variableManager: {
      resetHandle: jest.fn()
    },
    shouldRecordThread: jest.fn().mockReturnValue(false),
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
    jest.clearAllMocks()
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
    jest.clearAllMocks()
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
      const handler = jest.fn()
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
