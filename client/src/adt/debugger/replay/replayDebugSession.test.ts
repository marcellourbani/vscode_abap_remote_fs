jest.mock("@vscode/debugadapter", () => ({
  LoggingDebugSession: jest.fn().mockImplementation(function (this: any) {
    this.sendResponse = jest.fn()
    this.sendEvent = jest.fn()
  }),
  InitializedEvent: jest.fn().mockImplementation(() => ({ type: "initialized" })),
  StoppedEvent: jest.fn().mockImplementation((reason: string, threadId: number) => ({ type: "stopped", reason, threadId })),
  TerminatedEvent: jest.fn().mockImplementation(() => ({ type: "terminated" })),
  Thread: jest.fn().mockImplementation((id: number, name: string) => ({ id, name })),
  Source: jest.fn().mockImplementation((name: string, path: string) => ({ name, path }))
}))
jest.mock("abap-adt-api", () => ({
  debugMetaIsComplex: jest.fn((meta: string) =>
    ["structure", "table", "object", "class"].includes(meta)
  )
}))
jest.mock("@vscode/debugprotocol", () => ({}))
// ReplayVariableManager is a real import but its deps are mocked above
jest.mock("./replayVariableManager", () => {
  return {
    ReplayVariableManager: jest.fn().mockImplementation(() => ({
      reset: jest.fn(),
      getScopes: jest.fn().mockReturnValue([]),
      getVariables: jest.fn().mockReturnValue([]),
      evaluate: jest.fn().mockReturnValue(undefined)
    }))
  }
})

import { ReplayDebugSession } from "./replayDebugSession"
import type { DebugRecording, DebugSnapshot } from "./types"
import { TerminatedEvent, StoppedEvent } from "@vscode/debugadapter"

function makeSnapshot(step: number, overrides: Partial<DebugSnapshot> = {}): DebugSnapshot {
  return {
    stepNumber: step,
    timestamp: Date.now(),
    threadId: 1,
    stack: [{ name: "ZPROG", sourcePath: "adt://TST/some/path", adtUri: "/sap/bc/adt/programs/programs/ZPROG", line: step + 1, stackPosition: step }],
    scopes: [{ name: "LOCAL", variables: [] }],
    changedVars: [],
    ...overrides
  }
}

function makeRecording(steps: number, overrides: Partial<DebugRecording> = {}): DebugRecording {
  const snapshots: DebugSnapshot[] = Array.from({ length: steps }, (_, i) => makeSnapshot(i))
  return {
    version: 1,
    recordedAt: "2026-01-01T00:00:00.000Z",
    connectionId: "TST",
    totalSteps: steps,
    duration: 1000,
    snapshots,
    ...overrides
  }
}

function makeResponse<T extends object = {}>(body: T = {} as T) {
  return { body, success: true, message: "" } as any
}

describe("ReplayDebugSession", () => {
  describe("initializeRequest", () => {
    test("sends capabilities with supportsStepBack=true", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      const response = makeResponse()
      ;(session as any).initializeRequest(response, {})
      expect(response.body.supportsStepBack).toBe(true)
      expect(response.body.supportsConfigurationDoneRequest).toBe(true)
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
      expect((session as any).sendEvent).toHaveBeenCalled()
    })
  })

  describe("configurationDoneRequest", () => {
    test("fires StoppedEvent when recording has steps", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      const response = makeResponse()
      ;(session as any).configurationDoneRequest(response, {})
      expect((session as any).sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "stopped" })
      )
    })

    test("fires TerminatedEvent when recording has no steps", () => {
      const session = new ReplayDebugSession(makeRecording(0))
      const response = makeResponse()
      ;(session as any).configurationDoneRequest(response, {})
      expect((session as any).sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "terminated" })
      )
    })
  })

  describe("threadsRequest", () => {
    test("returns one replay thread", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).threadsRequest(response)
      expect(response.body.threads).toHaveLength(1)
      expect(response.body.threads[0].id).toBe(1)
    })

    test("thread name includes current step and total", () => {
      const session = new ReplayDebugSession(makeRecording(5))
      const response = makeResponse()
      ;(session as any).threadsRequest(response)
      expect(response.body.threads[0].name).toContain("1/5")
    })
  })

  describe("stackTraceRequest", () => {
    test("returns stack frames for current snapshot", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).stackTraceRequest(response, { threadId: 1 })
      expect(response.body.stackFrames).toHaveLength(1)
      expect(response.body.stackFrames[0].name).toBe("ZPROG")
      expect(response.body.stackFrames[0].line).toBe(1)
    })

    test("returns empty when no snapshot", () => {
      const session = new ReplayDebugSession(makeRecording(0))
      const response = makeResponse()
      ;(session as any).stackTraceRequest(response, { threadId: 1 })
      expect(response.body.stackFrames).toEqual([])
    })
  })

  describe("scopesRequest", () => {
    test("returns scopes for top frame (frameId 0)", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).scopesRequest(response, { frameId: 0 })
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })

    test("returns empty scopes for non-top frames", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).scopesRequest(response, { frameId: 1 })
      expect(response.body.scopes).toEqual([])
    })

    test("returns empty when no snapshot", () => {
      const session = new ReplayDebugSession(makeRecording(0))
      const response = makeResponse()
      ;(session as any).scopesRequest(response, { frameId: 0 })
      expect(response.body.scopes).toEqual([])
    })
  })

  describe("variablesRequest", () => {
    test("delegates to variableManager.getVariables", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).variablesRequest(response, { variablesReference: 1000 })
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })
  })

  describe("evaluateRequest", () => {
    test("sets success false when no snapshot", () => {
      const session = new ReplayDebugSession(makeRecording(0))
      const response = makeResponse()
      ;(session as any).evaluateRequest(response, { expression: "MYVAR" })
      expect(response.success).toBe(false)
    })

    test("sets success false when variable not found", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).evaluateRequest(response, { expression: "UNKNOWN" })
      // variableManager.evaluate returns undefined by default
      expect(response.success).toBe(false)
    })

    test("sets body when variable found", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const vm = (session as any).variableManager
      vm.evaluate.mockReturnValueOnce({ result: "42", variablesReference: 0 })
      const response = makeResponse()
      ;(session as any).evaluateRequest(response, { expression: "MY_VAR" })
      expect(response.body.result).toBe("42")
    })
  })

  describe("forward stepping", () => {
    test("nextRequest advances to step 1", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      const response = makeResponse()
      ;(session as any).nextRequest(response, {})
      expect((session as any).currentStep).toBe(1)
      expect((session as any).sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "stopped" })
      )
    })

    test("stepInRequest advances step", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      const response = makeResponse()
      ;(session as any).stepInRequest(response, {})
      expect((session as any).currentStep).toBe(1)
    })

    test("stepOutRequest advances step", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      const response = makeResponse()
      ;(session as any).stepOutRequest(response, {})
      expect((session as any).currentStep).toBe(1)
    })

    test("fires TerminatedEvent when stepping past last step", () => {
      const session = new ReplayDebugSession(makeRecording(1))
      // currentStep is 0, totalSteps is 1, stepping to 1 = past end
      const response = makeResponse()
      ;(session as any).nextRequest(response, {})
      expect((session as any).sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "terminated" })
      )
    })

    test("continueRequest jumps to last step", () => {
      const session = new ReplayDebugSession(makeRecording(5))
      const response = makeResponse()
      ;(session as any).continueRequest(response, {})
      expect((session as any).currentStep).toBe(4)
    })

    test("continueRequest fires TerminatedEvent when already at last step", () => {
      const session = new ReplayDebugSession(makeRecording(1))
      // step 0 is last
      const response = makeResponse()
      ;(session as any).continueRequest(response, {})
      expect((session as any).sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "terminated" })
      )
    })
  })

  describe("backward stepping", () => {
    test("stepBackRequest goes back one step", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      ;(session as any).currentStep = 2
      const response = makeResponse()
      ;(session as any).stepBackRequest(response, {})
      expect((session as any).currentStep).toBe(1)
    })

    test("stepBackRequest does not go below 0", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      ;(session as any).currentStep = 0
      const response = makeResponse()
      ;(session as any).stepBackRequest(response, {})
      expect((session as any).currentStep).toBe(0)
    })

    test("reverseContinueRequest jumps to step 0", () => {
      const session = new ReplayDebugSession(makeRecording(5))
      ;(session as any).currentStep = 4
      const response = makeResponse()
      ;(session as any).reverseContinueRequest(response, {})
      expect((session as any).currentStep).toBe(0)
    })
  })

  describe("launchRequest", () => {
    test("resets currentStep to 0", () => {
      const session = new ReplayDebugSession(makeRecording(3))
      ;(session as any).currentStep = 2
      const response = makeResponse()
      ;(session as any).launchRequest(response, {})
      expect((session as any).currentStep).toBe(0)
    })
  })

  describe("disconnectRequest & terminateRequest", () => {
    test("disconnectRequest sends response", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).disconnectRequest(response, {})
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })

    test("terminateRequest fires TerminatedEvent", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).terminateRequest(response, {})
      expect((session as any).sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "terminated" })
      )
    })
  })

  describe("setBreakPointsRequest", () => {
    test("returns all breakpoints as unverified", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).setBreakPointsRequest(response, {
        source: {},
        breakpoints: [{ line: 10 }, { line: 20 }]
      })
      expect(response.body.breakpoints).toHaveLength(2)
      expect(response.body.breakpoints[0].verified).toBe(false)
      expect(response.body.breakpoints[1].verified).toBe(false)
    })

    test("handles empty breakpoints array", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).setBreakPointsRequest(response, { source: {}, breakpoints: [] })
      expect(response.body.breakpoints).toEqual([])
    })

    test("handles undefined breakpoints", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).setBreakPointsRequest(response, { source: {} })
      expect(response.body.breakpoints).toEqual([])
    })
  })

  describe("sourceRequest", () => {
    test("returns empty source when no path or reference matches", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      const response = makeResponse()
      ;(session as any).sourceRequest(response, { source: {}, sourceReference: 9999 })
      expect((session as any).sendResponse).toHaveBeenCalledWith(response)
    })

    test("returns source from recording sources map", () => {
      const recording = makeRecording(1, { sources: { "adt://TST/some/path": "REPORT Z." } })
      const session = new ReplayDebugSession(recording)
      const response = makeResponse()
      ;(session as any).sourceRequest(response, { source: { path: "adt://TST/some/path" } })
      expect(response.body?.content).toBe("REPORT Z.")
    })
  })

  describe("source reference map", () => {
    test("assigns consistent source references to the same path", () => {
      const session = new ReplayDebugSession(makeRecording(2))
      // Request stack twice to trigger getSourceRef for same path
      const r1 = makeResponse()
      const r2 = makeResponse()
      ;(session as any).stackTraceRequest(r1, { threadId: 1 })
      ;(session as any).stackTraceRequest(r2, { threadId: 1 })
      const ref1 = r1.body.stackFrames[0].source.sourceReference
      const ref2 = r2.body.stackFrames[0].source.sourceReference
      expect(ref1).toBe(ref2)
    })

    test("assigns different source references to different paths", () => {
      const snap0 = makeSnapshot(0, {
        stack: [{ name: "ZPROG_A", sourcePath: "adt://TST/path/A", adtUri: "/A", line: 1, stackPosition: 0 }]
      })
      const snap1 = makeSnapshot(1, {
        stack: [{ name: "ZPROG_B", sourcePath: "adt://TST/path/B", adtUri: "/B", line: 2, stackPosition: 0 }]
      })
      const rec: DebugRecording = {
        version: 1, recordedAt: "", connectionId: "TST",
        totalSteps: 2, duration: 100, snapshots: [snap0, snap1]
      }
      const session = new ReplayDebugSession(rec)
      const r0 = makeResponse()
      ;(session as any).stackTraceRequest(r0, { threadId: 1 })
      ;(session as any).currentStep = 1
      const r1 = makeResponse()
      ;(session as any).stackTraceRequest(r1, { threadId: 1 })
      const ref0 = r0.body.stackFrames[0].source.sourceReference
      const ref1 = r1.body.stackFrames[0].source.sourceReference
      expect(ref0).not.toBe(ref1)
    })
  })
})
