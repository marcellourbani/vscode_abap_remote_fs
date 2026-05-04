jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({ scheme: "adt", path: s.replace(/^adt:\/\/[^/]+/, ""), toString: () => s }))
  },
  DebugConfiguration: {},
  DebugSession: {}
}), { virtual: true })
jest.mock("@vscode/debugadapter", () => ({
  LoggingDebugSession: jest.fn().mockImplementation(function (this: any) {
    this.sendResponse = jest.fn()
    this.sendEvent = jest.fn()
  }),
  InitializedEvent: jest.fn().mockImplementation(() => ({ type: "initialized" })),
  Thread: jest.fn().mockImplementation((id: number, name: string) => ({ id, name }))
}))
jest.mock("./abapConfigurationProvider", () => ({
  DEBUGTYPE: "abap"
}))
jest.mock("../conections", () => ({
  getRoot: jest.fn()
}))
jest.mock("abapfs", () => ({
  isAbapFile: jest.fn(() => false)
}))
jest.mock("../../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  log: jest.fn()
}))
jest.mock("./debugListener", () => ({
  errorType: jest.fn()
}))
jest.mock("./replay/recordingIO", () => ({
  saveRecording: jest.fn().mockResolvedValue(undefined)
}))
jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn().mockResolvedValue(undefined),
    showErrorMessage: jest.fn()
  }
}))

import { AbapDebugSession } from "./abapDebugSession"
import { isAbapFile } from "abapfs"
import { getRoot } from "../conections"
import { errorType } from "./debugListener"
import { saveRecording } from "./replay/recordingIO"
import { funWindow as window } from "../../services/funMessenger"

const mockIsAbapFile = isAbapFile as jest.MockedFunction<typeof isAbapFile>
const mockGetRoot = getRoot as jest.MockedFunction<typeof getRoot>
const mockErrorType = errorType as jest.MockedFunction<typeof errorType>
const mockSaveRecording = saveRecording as jest.MockedFunction<typeof saveRecording>

function makeVariableManager() {
  return {
    getScopes: jest.fn().mockResolvedValue([]),
    getVariables: jest.fn().mockResolvedValue([]),
    setVariable: jest.fn().mockResolvedValue({ value: "newval", success: true }),
    evaluate: jest.fn().mockResolvedValue({ result: "42", variablesReference: 0 })
  }
}

function makeBreakpointManager() {
  return {
    setBreakpoints: jest.fn().mockResolvedValue([]),
    getBreakpoints: jest.fn().mockReturnValue([])
  }
}

function makeService(threadId: number, overrides: Partial<any> = {}) {
  return {
    debuggee: { NAME: "TestUser", DEBUGGEE_ID: "DBG1" },
    getStack: jest.fn().mockReturnValue([]),
    debuggerStep: jest.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function makeListener(overrides: Partial<any> = {}) {
  const serviceMap = new Map<number, any>([[1, makeService(1)]])
  return {
    breakpointManager: makeBreakpointManager(),
    variableManager: makeVariableManager(),
    addListener: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    service: jest.fn((id: number) => {
      const s = serviceMap.get(id)
      if (!s) throw new Error(`No service for ${id}`)
      return s
    }),
    activeServices: jest.fn(() => [...serviceMap]),
    fireMainLoop: jest.fn().mockResolvedValue(true),
    logout: jest.fn().mockResolvedValue(undefined),
    isRecording: false,
    stopRecording: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as any
}

// Helper to create a mock DAP response object
function makeResponse<T extends object = {}>(body: T = {} as T) {
  return { body, success: true, message: "" } as any
}

describe("AbapDebugSession", () => {
  let session: AbapDebugSession
  let listener: ReturnType<typeof makeListener>

  beforeEach(() => {
    jest.clearAllMocks()
    // Clear static session map between tests
    ;(AbapDebugSession as any).sessions = new Map()
    listener = makeListener()
    session = new AbapDebugSession("TST", listener)
  })

  afterEach(() => {
    ;(AbapDebugSession as any).sessions = new Map()
  })

  describe("static sessions", () => {
    test("activeSessions returns count of sessions", () => {
      expect(AbapDebugSession.activeSessions).toBe(1)
    })

    test("byConnection returns session for connId", () => {
      expect(AbapDebugSession.byConnection("TST")).toBe(session)
    })

    test("byConnection returns undefined for unknown connId", () => {
      expect(AbapDebugSession.byConnection("UNKNOWN")).toBeUndefined()
    })

    test("throws if second session created for same connId", () => {
      expect(() => new AbapDebugSession("TST", listener)).toThrow(
        "Debug session already running on TST"
      )
    })

    test("allSessions returns iterator with all sessions", () => {
      const all = [...AbapDebugSession.allSessions()]
      expect(all).toHaveLength(1)
      expect(all[0]).toBe(session)
    })
  })

  describe("debugListener getter", () => {
    test("returns the listener", () => {
      expect(session.debugListener).toBe(listener)
    })
  })

  describe("initializeRequest", () => {
    test("sends response with capabilities and fires InitializedEvent", () => {
      const response = makeResponse()
      ;(session as any).initializeRequest(response, {})
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
      expect(response.body.supportsBreakpointLocationsRequest).toBe(true)
      expect(response.body.supportsGotoTargetsRequest).toBe(true)
      expect(response.body.supportsEvaluateForHovers).toBe(true)
      expect(response.body.supportsSetVariable).toBe(true)
      expect((session as any).sendEvent).toHaveBeenCalled()
    })
  })

  describe("setBreakPointsRequest", () => {
    test("delegates to breakpointManager and sends response", async () => {
      const response = makeResponse()
      const args = {
        source: { path: "adt://TST/some/path" },
        breakpoints: [{ line: 10 }]
      }
      await (session as any).setBreakPointsRequest(response, args)
      expect(listener.breakpointManager.setBreakpoints).toHaveBeenCalledWith(
        args.source,
        args.breakpoints
      )
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })
  })

  describe("threadsRequest", () => {
    test("returns active services as threads", () => {
      const response = makeResponse()
      ;(session as any).threadsRequest(response)
      expect(response.body.threads).toHaveLength(1)
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })
  })

  describe("stepInRequest", () => {
    test("calls debuggerStep with stepInto", async () => {
      const response = makeResponse()
      const args = { threadId: 1 }
      await (session as any).stepInRequest(response, args)
      expect(listener.service(1).debuggerStep).toHaveBeenCalledWith("stepInto", 1)
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })
  })

  describe("continueRequest", () => {
    test("calls debuggerStep with stepContinue", async () => {
      const response = makeResponse()
      const args = { threadId: 1 }
      await (session as any).continueRequest(response, args)
      expect(listener.service(1).debuggerStep).toHaveBeenCalledWith("stepContinue", 1)
      expect(response.body.allThreadsContinued).toBe(false)
    })
  })

  describe("nextRequest", () => {
    test("calls debuggerStep with stepOver", async () => {
      const response = makeResponse()
      const args = { threadId: 1 }
      await (session as any).nextRequest(response, args)
      expect(listener.service(1).debuggerStep).toHaveBeenCalledWith("stepOver", 1)
    })
  })

  describe("stepOutRequest", () => {
    test("calls debuggerStep with stepReturn", async () => {
      const response = makeResponse()
      const args = { threadId: 1 }
      await (session as any).stepOutRequest(response, args)
      expect(listener.service(1).debuggerStep).toHaveBeenCalledWith("stepReturn", 1)
    })
  })

  describe("stackTraceRequest", () => {
    test("returns stack frames from service", () => {
      const frames = [{ id: 1000000000000, name: "ZPROG", line: 10, column: 0 }]
      listener.service(1).getStack.mockReturnValueOnce(frames)
      const response = makeResponse()
      ;(session as any).stackTraceRequest(response, { threadId: 1 })
      expect(response.body.stackFrames).toBe(frames)
      expect(response.body.totalFrames).toBe(1)
    })
  })

  describe("breakpointLocationsRequest", () => {
    test("returns breakpoints for known source path", () => {
      const fakeBps = [{ verified: true, line: 10 }]
      listener.breakpointManager.getBreakpoints.mockReturnValueOnce(fakeBps)
      const response = makeResponse()
      ;(session as any).breakpointLocationsRequest(
        response,
        { source: { path: "/some/path" }, line: 10 }
      )
      expect(response.body.breakpoints).toHaveLength(1)
    })

    test("returns empty when no source path", () => {
      const response = makeResponse()
      ;(session as any).breakpointLocationsRequest(
        response,
        { source: {}, line: 10 }
      )
      expect(response.body.breakpoints).toEqual([])
    })
  })

  describe("scopesRequest", () => {
    test("delegates to variableManager.getScopes", async () => {
      const scopes = [{ name: "LOCAL", variablesReference: 1000000000001 }]
      listener.variableManager.getScopes.mockResolvedValueOnce(scopes)
      const response = makeResponse()
      await (session as any).scopesRequest(response, { frameId: 1000000000000 })
      expect(response.body.scopes).toBe(scopes)
    })
  })

  describe("variablesRequest", () => {
    test("delegates to variableManager.getVariables", async () => {
      const vars = [{ name: "A", value: "1", variablesReference: 0 }]
      listener.variableManager.getVariables.mockResolvedValueOnce(vars)
      const response = makeResponse()
      await (session as any).variablesRequest(response, { variablesReference: 1000000000001 })
      expect(response.body.variables).toBe(vars)
    })
  })

  describe("setVariableRequest", () => {
    test("sets variable and sends response", async () => {
      listener.variableManager.setVariable.mockResolvedValueOnce({ value: "42", success: true })
      const response = makeResponse()
      await (session as any).setVariableRequest(response, {
        variablesReference: 1000000000001,
        name: "MYVAR",
        value: "42"
      })
      expect(response.body.value).toBe("42")
      expect(response.success).toBe(true)
    })
  })

  describe("evaluateRequest", () => {
    test("returns body when evaluate succeeds", async () => {
      listener.variableManager.evaluate.mockResolvedValueOnce({ result: "hello", variablesReference: 0 })
      const response = makeResponse()
      await (session as any).evaluateRequest(response, { expression: "MYVAR", frameId: 1000000000000 })
      expect(response.body.result).toBe("hello")
    })

    test("sets success false when evaluate returns undefined", async () => {
      listener.variableManager.evaluate.mockResolvedValueOnce(undefined)
      const response = makeResponse()
      await (session as any).evaluateRequest(response, { expression: "BAD", frameId: 1000000000000 })
      expect(response.success).toBe(false)
    })
  })

  describe("attachRequest", () => {
    test("sets success from fireMainLoop result", async () => {
      listener.fireMainLoop.mockResolvedValueOnce(true)
      const response = makeResponse()
      await (session as any).attachRequest(response, {})
      expect(response.success).toBe(true)
    })

    test("sets message when fireMainLoop fails", async () => {
      listener.fireMainLoop.mockResolvedValueOnce(false)
      const response = makeResponse()
      await (session as any).attachRequest(response, {})
      expect(response.success).toBe(false)
      expect(response.message).toBe("Could not attach to process")
    })
  })

  describe("disconnectRequest", () => {
    test("calls logOut and sends response", async () => {
      const response = makeResponse()
      const logOutSpy = jest.spyOn(session, "logOut").mockResolvedValueOnce(undefined)
      await (session as any).disconnectRequest(response, {})
      expect(logOutSpy).toHaveBeenCalled()
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })
  })

  describe("logOut", () => {
    test("calls listener.logout and removes session", async () => {
      await session.logOut()
      expect(listener.logout).toHaveBeenCalled()
      expect(AbapDebugSession.byConnection("TST")).toBeUndefined()
      expect(AbapDebugSession.activeSessions).toBe(0)
    })

    test("calls onClose callback if registered", async () => {
      const onClose = jest.fn()
      session.onClose(onClose)
      await session.logOut()
      expect(onClose).toHaveBeenCalled()
    })

    test("prompts to save recording when recording has steps", async () => {
      const recording = { totalSteps: 3 }
      listener.isRecording = true
      listener.stopRecording = jest.fn().mockResolvedValue(recording)
      ;(window.showInformationMessage as jest.Mock).mockResolvedValueOnce("Save")
      await session.logOut()
      expect(mockSaveRecording).toHaveBeenCalledWith(recording)
    })

    test("discards recording when user chooses Discard", async () => {
      const recording = { totalSteps: 3 }
      listener.isRecording = true
      listener.stopRecording = jest.fn().mockResolvedValue(recording)
      ;(window.showInformationMessage as jest.Mock).mockResolvedValueOnce("Discard")
      await session.logOut()
      expect(mockSaveRecording).not.toHaveBeenCalled()
    })
  })

  describe("gotoTargetsRequest", () => {
    test("returns success false when source has no path", async () => {
      const response = makeResponse()
      await (session as any).gotoTargetsRequest(response, { source: {}, line: 10 })
      expect(response.success).toBe(false)
    })

    test("creates goto target for ABAP file", async () => {
      const node = {
        object: {
          structure: {},
          contentsPath: jest.fn(() => "/sap/bc/adt/programs/programs/ZPROG"),
          loadStructure: jest.fn().mockResolvedValue(undefined)
        }
      }
      mockGetRoot.mockReturnValueOnce({ getNodeAsync: jest.fn().mockResolvedValue(node) } as any)
      mockIsAbapFile.mockReturnValueOnce(true)
      const response = makeResponse()
      await (session as any).gotoTargetsRequest(response, {
        source: { path: "adt://TST/some/path", name: "ZPROG" },
        line: 10
      })
      expect(response.success).toBe(true)
      expect(response.body.targets[0].line).toBe(10)
    })
  })
})
