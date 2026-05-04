jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({ scheme: "adt", path: s, toString: () => s }))
  },
  workspace: {
    fs: {
      readFile: jest.fn().mockResolvedValue(Buffer.from("REPORT Z."))
    }
  }
}), { virtual: true })
jest.mock("../../../lib", () => ({
  log: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e))
}))
jest.mock("../../../services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: jest.fn()
  }
}))
jest.mock("./variableCapture", () => ({
  captureScopesBatched: jest.fn().mockResolvedValue([
    { name: "LOCAL", variables: [{ id: "V1", name: "X", value: "10", type: "I", metaType: "simple" }] }
  ])
}))

import { DebugRecorder } from "./debugRecorder"
import { captureScopesBatched } from "./variableCapture"
import { funWindow as window } from "../../../services/funMessenger"
import { DEFAULT_CAPTURE_OPTIONS } from "./types"
import type { CapturedStackFrame } from "./types"

const mockCaptureScopesBatched = captureScopesBatched as jest.MockedFunction<typeof captureScopesBatched>

function makeStackFrames(count = 1): CapturedStackFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `FRAME_${i}`,
    sourcePath: `adt://TST/path_${i}`,
    adtUri: `/sap/bc/adt/programs/programs/ZPROG_${i}`,
    line: i + 1,
    stackPosition: i
  }))
}

function makeClient() {
  return {} as any // captureScopesBatched is mocked, so client doesn't need real methods
}

describe("DebugRecorder", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset captureScopesBatched to return one scope each time
    mockCaptureScopesBatched.mockResolvedValue([
      { name: "LOCAL", variables: [{ id: "V1", name: "X", value: "10", type: "I", metaType: "simple" }] }
    ])
  })

  describe("initial state", () => {
    test("isRecording is false initially", () => {
      const recorder = new DebugRecorder()
      expect(recorder.isRecording).toBe(false)
    })

    test("stepCount is 0 initially", () => {
      const recorder = new DebugRecorder()
      expect(recorder.stepCount).toBe(0)
    })
  })

  describe("startRecording", () => {
    test("sets isRecording to true", () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      expect(recorder.isRecording).toBe(true)
    })

    test("resets snapshots and sourceCache", () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      expect(recorder.stepCount).toBe(0)
    })
  })

  describe("captureSnapshot", () => {
    test("does nothing when not recording", async () => {
      const recorder = new DebugRecorder()
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      expect(recorder.stepCount).toBe(0)
      expect(mockCaptureScopesBatched).not.toHaveBeenCalled()
    })

    test("captures a snapshot when recording", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      expect(recorder.stepCount).toBe(1)
    })

    test("includes stack info in snapshot", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const frames = makeStackFrames(2)
      await recorder.captureSnapshot(makeClient(), 1, frames)
      // After capture, we can verify by stopping and checking the recording
      const recording = await recorder.stopRecording()
      expect(recording!.snapshots[0].stack).toEqual(frames)
    })

    test("assigns sequential step numbers", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const client = makeClient()
      await recorder.captureSnapshot(client, 1, makeStackFrames())
      await recorder.captureSnapshot(client, 1, makeStackFrames())
      await recorder.captureSnapshot(client, 1, makeStackFrames())
      const recording = await recorder.stopRecording()
      expect(recording!.snapshots[0].stepNumber).toBe(0)
      expect(recording!.snapshots[1].stepNumber).toBe(1)
      expect(recording!.snapshots[2].stepNumber).toBe(2)
    })

    test("detects changed variables between snapshots", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const client = makeClient()

      // First snapshot: X = 10
      mockCaptureScopesBatched.mockResolvedValueOnce([
        { name: "LOCAL", variables: [{ id: "V1", name: "X", value: "10", type: "I", metaType: "simple" }] }
      ])
      await recorder.captureSnapshot(client, 1, makeStackFrames())

      // Second snapshot: X = 20 (changed)
      mockCaptureScopesBatched.mockResolvedValueOnce([
        { name: "LOCAL", variables: [{ id: "V1", name: "X", value: "20", type: "I", metaType: "simple" }] }
      ])
      await recorder.captureSnapshot(client, 1, makeStackFrames())

      const recording = await recorder.stopRecording()
      expect(recording!.snapshots[0].changedVars).toEqual([]) // first snapshot no previous
      expect(recording!.snapshots[1].changedVars).toContain("LOCAL.X")
    })

    test("stops recording when maxSteps is reached", async () => {
      const recorder = new DebugRecorder({ ...DEFAULT_CAPTURE_OPTIONS, maxSteps: 2 })
      recorder.startRecording("TST")
      const client = makeClient()
      await recorder.captureSnapshot(client, 1, makeStackFrames())
      await recorder.captureSnapshot(client, 1, makeStackFrames())
      // This capture should trigger the stop
      await recorder.captureSnapshot(client, 1, makeStackFrames())
      expect(recorder.isRecording).toBe(false)
      expect(window.showWarningMessage).toHaveBeenCalled()
    })

    test("handles capture errors gracefully", async () => {
      mockCaptureScopesBatched.mockRejectedValueOnce(new Error("ADT error"))
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await expect(recorder.captureSnapshot(makeClient(), 1, makeStackFrames())).resolves.not.toThrow()
      expect(recorder.stepCount).toBe(0) // no snapshot on error
    })

    test("caches source files from stack", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const frames: CapturedStackFrame[] = [
        { name: "ZPROG", sourcePath: "adt://TST/some/path", adtUri: "/p", line: 1, stackPosition: 0 }
      ]
      await recorder.captureSnapshot(makeClient(), 1, frames)
      const recording = await recorder.stopRecording()
      expect(recording!.sources).toBeDefined()
      expect(recording!.sources!["adt://TST/some/path"]).toBe("REPORT Z.")
    })

    test("does not capture after recording stopped mid-async", async () => {
      let resolveFn: () => void
      const waitForCapture = new Promise<void>(r => (resolveFn = r))
      mockCaptureScopesBatched.mockImplementationOnce(async () => {
        resolveFn!()
        await new Promise(r => setTimeout(r, 10))
        return []
      })
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const capturePromise = recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      await waitForCapture
      await recorder.stopRecording() // stop while capture in flight
      await capturePromise
      // Snapshot should not be counted after stop
      expect(recorder.stepCount).toBe(0)
    })
  })

  describe("stopRecording", () => {
    test("returns undefined when no snapshots", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const recording = await recorder.stopRecording()
      expect(recording).toBeUndefined()
    })

    test("returns recording when snapshots exist", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      const recording = await recorder.stopRecording()
      expect(recording).toBeDefined()
      expect(recording!.version).toBe(1)
      expect(recording!.connectionId).toBe("TST")
      expect(recording!.totalSteps).toBe(1)
    })

    test("sets isRecording to false", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      await recorder.stopRecording()
      expect(recorder.isRecording).toBe(false)
    })

    test("returns undefined on second stop (snapshots cleared)", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      await recorder.stopRecording()
      // Re-check: after stop, stepCount is 0 and second stop returns undefined
      const second = await recorder.stopRecording()
      expect(second).toBeUndefined()
    })

    test("recording duration is positive", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      const recording = await recorder.stopRecording()
      expect(recording!.duration).toBeGreaterThanOrEqual(0)
    })

    test("recording includes recordedAt timestamp", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      await recorder.captureSnapshot(makeClient(), 1, makeStackFrames())
      const recording = await recorder.stopRecording()
      expect(new Date(recording!.recordedAt).getTime()).not.toBeNaN()
    })

    test("includes sources in recording output", async () => {
      const recorder = new DebugRecorder()
      recorder.startRecording("TST")
      const frames: CapturedStackFrame[] = [
        { name: "ZPROG", sourcePath: "adt://TST/my/path", adtUri: "/p", line: 1, stackPosition: 0 }
      ]
      await recorder.captureSnapshot(makeClient(), 1, frames)
      const recording = await recorder.stopRecording()
      expect(recording!.sources).toBeDefined()
    })
  })
})
