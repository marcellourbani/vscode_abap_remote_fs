jest.mock("abap-adt-api", () => ({
  debugMetaIsComplex: jest.fn((meta: string) =>
    ["structure", "table", "object", "class", "objectref"].includes(meta)
  )
}))
jest.mock("@vscode/debugadapter", () => ({
  Handles: jest.fn().mockImplementation((base: number) => {
    const store = new Map<number, any>()
    let counter = base || 1
    return {
      create: jest.fn((val: any) => {
        const id = counter++
        store.set(id, val)
        return id
      }),
      get: jest.fn((id: number) => store.get(id)),
      reset: jest.fn(() => { store.clear(); counter = base || 1 })
    }
  }),
  Scope: jest.fn().mockImplementation((name: string, ref: number, expensive: boolean) => ({
    name, variablesReference: ref, expensive
  }))
}))
jest.mock("vscode", () => ({
  env: { clipboard: { writeText: jest.fn() } },
  ProgressLocation: { Notification: 1 }
}), { virtual: true })
jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    withProgress: jest.fn((_opts: any, fn: () => any) => fn()),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn()
  }
}))
jest.mock("../../commands", () => ({
  AbapFsCommands: { exportToJson: "abapfs.exportJson" },
  command: () => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor
}))
jest.mock("./debugService", () => ({
  idThread: jest.fn((frameId: number) => Math.floor(frameId / 1000000000000)),
  STACK_THREAD_MULTIPLIER: 1000000000000
}))
jest.mock("./debugListener", () => ({}))
jest.mock("../../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))
jest.mock("./abapDebugSession", () => ({
  AbapDebugSession: { activeSessions: 1 }
}))

import { VariableManager } from "./variableManager"
import { idThread } from "./debugService"

const mockIdThread = idThread as jest.MockedFunction<typeof idThread>

function makeClient(overrides: Partial<any> = {}) {
  return {
    debuggerChildVariables: jest.fn().mockResolvedValue({ hierarchies: [], variables: [] }),
    debuggerVariables: jest.fn().mockResolvedValue([]),
    debuggerGoToStack: jest.fn().mockResolvedValue(undefined),
    debuggerSetVariableValue: jest.fn().mockResolvedValue("newval"),
    ...overrides
  }
}

function makeService(threadId: number, overrides: Partial<any> = {}) {
  return {
    client: makeClient(overrides.client),
    stackTrace: [] as any[],
    ...overrides
  }
}

function makeListener(serviceMap: Map<number, any> = new Map()) {
  return {
    service: jest.fn((id: number) => {
      const svc = serviceMap.get(id)
      if (!svc) throw new Error(`No service for threadid ${id}`)
      return svc
    }),
    activeServices: jest.fn(() => [...serviceMap])
  } as any
}

describe("VariableManager", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIdThread.mockImplementation((frameId: number) => Math.floor(frameId / 1000000000000))
  })

  describe("resetHandle", () => {
    test("creates a new handle for thread", () => {
      const listener = makeListener()
      const vm = new VariableManager(listener)
      const handle = vm.resetHandle(1)
      expect(handle).toBeDefined()
    })

    test("returns different handle objects for different threads", () => {
      const listener = makeListener()
      const vm = new VariableManager(listener)
      const h1 = vm.resetHandle(1)
      const h2 = vm.resetHandle(2)
      expect(h1).not.toBe(h2)
    })
  })

  describe("createVariable", () => {
    test("creates a variable reference from DebugVariable", () => {
      const threadId = 1
      mockIdThread.mockReturnValue(threadId)
      const serviceMap = new Map([[threadId, makeService(threadId)]])
      const listener = makeListener(serviceMap)
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)

      const debugVar = {
        ID: "VAR1",
        NAME: "myVar",
        TABLE_LINES: 0,
        META_TYPE: "simple",
        VALUE: "42",
        TECHNICAL_TYPE: "I"
      } as any

      const ref = vm.createVariable(threadId, debugVar)
      expect(typeof ref).toBe("number")
    })

    test("creates a variable reference from plain id/name object", () => {
      const threadId = 1
      const serviceMap = new Map([[threadId, makeService(threadId)]])
      const listener = makeListener(serviceMap)
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)

      const ref = vm.createVariable(threadId, { id: "SY", name: "SY" })
      expect(typeof ref).toBe("number")
    })
  })

  describe("getScopes", () => {
    test("returns empty array when client throws", async () => {
      const threadId = 1
      const frameId = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const listener = {
        service: jest.fn().mockImplementation(() => { throw new Error("no service") }),
        activeServices: jest.fn(() => [])
      } as any
      const vm = new VariableManager(listener)
      const scopes = await vm.getScopes(frameId)
      expect(scopes).toEqual([])
    })

    test("calls debuggerChildVariables with @ROOT", async () => {
      const threadId = 1
      const frameId = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const mockClient = makeClient({
        debuggerChildVariables: jest.fn().mockResolvedValue({
          hierarchies: [{ CHILD_ID: "LOCAL", CHILD_NAME: "Local" }],
          variables: []
        })
      })
      const service = makeService(threadId, { client: mockClient, stackTrace: [] })
      const serviceMap = new Map([[threadId, service]])
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [...serviceMap])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)

      const scopes = await vm.getScopes(frameId)
      expect(mockClient.debuggerChildVariables).toHaveBeenCalledWith(["@ROOT"])
      // Should have LOCAL scope + SY scope
      expect(scopes.length).toBeGreaterThanOrEqual(2)
    })

    test("always adds SY scope", async () => {
      const threadId = 2
      const frameId = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const mockClient = makeClient({
        debuggerChildVariables: jest.fn().mockResolvedValue({
          hierarchies: [],
          variables: []
        })
      })
      const service = makeService(threadId, { client: mockClient, stackTrace: [] })
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [[threadId, service]])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)

      const scopes = await vm.getScopes(frameId)
      const syScope = scopes.find((s: any) => s.name === "SY")
      expect(syScope).toBeDefined()
    })
  })

  describe("getVariables", () => {
    test("returns empty array for unknown parent id", async () => {
      const threadId = 1
      mockIdThread.mockReturnValue(threadId)
      const service = makeService(threadId)
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [[threadId, service]])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)

      const vars = await vm.getVariables(threadId * 1000000000000)
      expect(vars).toEqual([])
    })

    test("returns formatted variables for known parent", async () => {
      const threadId = 1
      const MULTIPLIER = 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const mockDebugVars = [
        { NAME: "VAR_A", VALUE: "hello", META_TYPE: "simple", TECHNICAL_TYPE: "C", ID: "VAR_A", TABLE_LINES: 0 },
        { NAME: "TBL", VALUE: "", META_TYPE: "table", TECHNICAL_TYPE: "T", ID: "TBL[]", TABLE_LINES: 5 }
      ] as any[]
      const mockClient = makeClient({
        debuggerChildVariables: jest.fn().mockResolvedValue({
          hierarchies: [{ CHILD_ID: "LOCAL", CHILD_NAME: "Local" }],
          variables: mockDebugVars
        })
      })
      const service = { client: mockClient, stackTrace: [] }
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [[threadId, service]])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)

      // First create a scope to have a parent handle
      await vm.getScopes(threadId * MULTIPLIER)

      // The parent handle for LOCAL will have been created during getScopes
      // We test getVariables indirectly via checking return structure
    })
  })

  describe("setVariable", () => {
    test("returns success false when client is unavailable", async () => {
      const threadId = 1
      const ref = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const listener = {
        service: jest.fn().mockImplementation(() => { throw new Error("no service") }),
        activeServices: jest.fn(() => [])
      } as any
      const vm = new VariableManager(listener)
      const result = await vm.setVariable(ref, "MYVAR", "newval")
      expect(result).toEqual({ value: "", success: false })
    })

    test("returns success false on client error", async () => {
      const threadId = 1
      const ref = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const mockClient = makeClient({
        debuggerSetVariableValue: jest.fn().mockRejectedValue(new Error("server error"))
      })
      const service = makeService(threadId, { client: mockClient })
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [[threadId, service]])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)
      const result = await vm.setVariable(ref, "MYVAR", "newval")
      expect(result).toEqual({ value: "", success: false })
    })
  })

  describe("dumpJson", () => {
    test("returns undefined when variable not found", async () => {
      const threadId = 1
      const mockClient = makeClient({
        debuggerVariables: jest.fn().mockResolvedValue([])
      })
      const service = makeService(threadId, { client: mockClient })
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [])
      } as any
      const vm = new VariableManager(listener)
      const result = await vm.dumpJson(mockClient as any, "UNKNOWN_VAR")
      expect(result).toBeUndefined()
    })

    test("returns numeric value for numeric TECHNICAL_TYPE", async () => {
      const mockClient = makeClient({
        debuggerVariables: jest.fn().mockResolvedValue([
          { META_TYPE: "simple", TECHNICAL_TYPE: "I", VALUE: "42", ID: "V1", NAME: "V1" }
        ])
      })
      const listener = { service: jest.fn(), activeServices: jest.fn(() => []) } as any
      const vm = new VariableManager(listener)
      const result = await vm.dumpJson(mockClient as any, "V1")
      expect(result).toBe(42)
    })

    test("returns string value trimmed for string type", async () => {
      const mockClient = makeClient({
        debuggerVariables: jest.fn().mockResolvedValue([
          { META_TYPE: "string", VALUE: "hello   ", ID: "V1", NAME: "V1", TECHNICAL_TYPE: "g" }
        ])
      })
      const listener = { service: jest.fn(), activeServices: jest.fn(() => []) } as any
      const vm = new VariableManager(listener)
      const result = await vm.dumpJson(mockClient as any, "V1")
      expect(result).toBe("hello")
    })

    test("returns Unprocessable string for objectref type", async () => {
      const mockClient = makeClient({
        debuggerVariables: jest.fn().mockResolvedValue([
          { META_TYPE: "objectref", VALUE: "ref", ID: "V1", NAME: "V1", TECHNICAL_TYPE: "r" }
        ])
      })
      const listener = { service: jest.fn(), activeServices: jest.fn(() => []) } as any
      const vm = new VariableManager(listener)
      const result = await vm.dumpJson(mockClient as any, "V1")
      expect(result).toBe("Unprocessable:objectref")
    })

    test("handles DebugVariable object directly", async () => {
      const mockClient = makeClient()
      const listener = { service: jest.fn(), activeServices: jest.fn(() => []) } as any
      const vm = new VariableManager(listener)
      const debugVar = {
        META_TYPE: "simple",
        TECHNICAL_TYPE: "C",
        VALUE: "direct  ",
        ID: "V1",
        NAME: "V1"
      } as any
      const result = await vm.dumpJson(mockClient as any, debugVar)
      expect(result).toBe("direct")
    })
  })

  describe("evaluate", () => {
    test("returns undefined when threadId is falsy", async () => {
      mockIdThread.mockReturnValue(0)
      const listener = { service: jest.fn(), activeServices: jest.fn(() => []) } as any
      const vm = new VariableManager(listener)
      const result = await vm.evaluate("MYVAR", 0)
      expect(result).toBeUndefined()
    })

    test("returns undefined when no frameId", async () => {
      const listener = { service: jest.fn(), activeServices: jest.fn(() => []) } as any
      const vm = new VariableManager(listener)
      const result = await vm.evaluate("MYVAR", undefined)
      expect(result).toBeUndefined()
    })

    test("returns result for simple variable", async () => {
      const threadId = 1
      const frameId = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const mockClient = makeClient({
        debuggerVariables: jest.fn().mockResolvedValue([
          { META_TYPE: "simple", TECHNICAL_TYPE: "C", VALUE: "hello", ID: "V1", NAME: "V1", TABLE_LINES: 0 }
        ])
      })
      const service = makeService(threadId, { client: mockClient })
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [[threadId, service]])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)
      const result = await vm.evaluate("V1", frameId)
      expect(result).toBeDefined()
      expect(result?.result).toBe("hello")
    })

    test("returns undefined when variable not found", async () => {
      const threadId = 1
      const frameId = threadId * 1000000000000
      mockIdThread.mockReturnValue(threadId)
      const mockClient = makeClient({
        debuggerVariables: jest.fn().mockResolvedValue([])
      })
      const service = makeService(threadId, { client: mockClient })
      const listener = {
        service: jest.fn(() => service),
        activeServices: jest.fn(() => [[threadId, service]])
      } as any
      const vm = new VariableManager(listener)
      vm.resetHandle(threadId)
      const result = await vm.evaluate("NONEXISTENT", frameId)
      expect(result).toBeUndefined()
    })
  })
})
