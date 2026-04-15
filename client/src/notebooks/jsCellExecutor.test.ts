/**
 * Tests for jsCellExecutor.ts
 *
 * The module spawns real Worker threads. We mock "worker_threads" to avoid
 * actual subprocess creation while still exercising all the branching logic.
 */

import EventEmitter from "events"
import { JS_EXECUTION_TIMEOUT_MS } from "./types"
import type { CellResult } from "./types"

// ── Worker mock factory ──────────────────────────────────────────────────────

type MockWorker = EventEmitter & {
  postMessage: jest.Mock
  terminate: jest.Mock
  _triggerMessage: (data: any) => void
  _triggerError: (err: Error) => void
  _triggerExit: (code: number) => void
}

let lastWorker: MockWorker | undefined

function createMockWorker(): MockWorker {
  const emitter = new EventEmitter() as MockWorker
  emitter.postMessage = jest.fn()
  emitter.terminate = jest.fn()
  emitter._triggerMessage = (data: any) => emitter.emit("message", data)
  emitter._triggerError = (err: Error) => emitter.emit("error", err)
  emitter._triggerExit = (code: number) => emitter.emit("exit", code)
  return emitter
}

jest.mock("worker_threads", () => ({
  Worker: jest.fn().mockImplementation(() => {
    lastWorker = createMockWorker()
    return lastWorker
  }),
}))

import { executeJsCell } from "./jsCellExecutor"

const { Worker: MockWorkerClass } = require("worker_threads")

beforeEach(() => {
  jest.clearAllMocks()
  lastWorker = undefined
  MockWorkerClass.mockImplementation(() => {
    lastWorker = createMockWorker()
    return lastWorker
  })
})

// ── Happy paths ──────────────────────────────────────────────────────────────

describe("executeJsCell — happy paths", () => {
  test("returns {result: undefined} for empty code", async () => {
    const result = await executeJsCell("", 0, new Map())
    expect(result).toEqual({ result: undefined })
    expect(MockWorkerClass).not.toHaveBeenCalled()
  })

  test("returns {result: undefined} for whitespace-only code", async () => {
    const result = await executeJsCell("   \n\t  ", 0, new Map())
    expect(result).toEqual({ result: undefined })
  })

  test("resolves with result from worker success message", async () => {
    const promise = executeJsCell("1 + 1", 0, new Map())
    lastWorker!._triggerMessage({ success: true, result: 42 })
    const result = await promise
    expect(result.result).toBe(42)
  })

  test("resolves with logs from worker when present", async () => {
    const promise = executeJsCell("console.log('hi')", 0, new Map())
    lastWorker!._triggerMessage({ success: true, result: undefined, logs: ["hi"] })
    const result = await promise
    expect(result.logs).toEqual(["hi"])
  })

  test("does not include logs key when worker returns empty logs", async () => {
    const promise = executeJsCell("1", 0, new Map())
    lastWorker!._triggerMessage({ success: true, result: 1, logs: [] })
    const result = await promise
    expect(result.logs).toBeUndefined()
  })

  test("resolves with error field when worker reports failure", async () => {
    const promise = executeJsCell("throw new Error('x')", 0, new Map())
    lastWorker!._triggerMessage({ success: false, error: "x", logs: [] })
    const result = await promise
    expect(result.error).toBe("x")
    expect(result.result).toBeUndefined()
  })

  test("fills default error message when worker sends failure without error string", async () => {
    const promise = executeJsCell("badCode()", 0, new Map())
    lastWorker!._triggerMessage({ success: false })
    const result = await promise
    expect(result.error).toBeTruthy()
  })

  test("sends code and cellIndex to worker via postMessage", async () => {
    const promise = executeJsCell("return 1", 3, new Map())
    lastWorker!._triggerMessage({ success: true, result: 1 })
    await promise
    expect(lastWorker!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ code: "return 1", cellIndex: 3 })
    )
  })

  test("includes only referenced cell results in worker message", async () => {
    const cellResults = new Map<number, CellResult>([
      [0, { result: "A" }],
      [1, { result: "B" }],
      [2, { result: "C" }],
    ])
    // code only references cells[1]
    const promise = executeJsCell("cells[1].result", 3, cellResults)
    lastWorker!._triggerMessage({ success: true, result: "B" })
    await promise
    const msg = lastWorker!.postMessage.mock.calls[0][0]
    expect(msg.cellResults["1"]).toEqual({ result: "B" })
    expect(msg.cellResults["0"]).toBeUndefined()
    expect(msg.cellResults["2"]).toBeUndefined()
  })

  test("skips missing cell indices gracefully", async () => {
    const cellResults = new Map<number, CellResult>([[1, { result: "X" }]])
    // code references cells[99] which doesn't exist
    const promise = executeJsCell("cells[99].result", 2, cellResults)
    lastWorker!._triggerMessage({ success: true, result: undefined })
    await promise
    const msg = lastWorker!.postMessage.mock.calls[0][0]
    expect(msg.cellResults["99"]).toBeUndefined()
  })

  test("includes timeoutMs in worker postMessage", async () => {
    const promise = executeJsCell("1", 0, new Map())
    lastWorker!._triggerMessage({ success: true, result: 1 })
    await promise
    const msg = lastWorker!.postMessage.mock.calls[0][0]
    expect(msg.timeoutMs).toBe(JS_EXECUTION_TIMEOUT_MS)
  })
})

// ── Error/abort paths ────────────────────────────────────────────────────────

describe("executeJsCell — error and abort paths", () => {
  test("rejects when worker emits error event", async () => {
    const promise = executeJsCell("bad()", 0, new Map())
    lastWorker!._triggerError(new Error("worker exploded"))
    await expect(promise).rejects.toThrow("worker exploded")
  })

  test("rejects when worker exits without sending a result", async () => {
    const promise = executeJsCell("// endless", 0, new Map())
    lastWorker!._triggerExit(1)
    await expect(promise).rejects.toThrow(/exited without sending/)
  })

  test("rejects with 'Interrupted by user' when abort signal is already aborted", async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(executeJsCell("1", 0, new Map(), ac.signal)).rejects.toThrow("Interrupted by user")
  })

  test("rejects with 'Interrupted by user' when signal aborts mid-execution", async () => {
    const ac = new AbortController()
    const promise = executeJsCell("longRunning()", 0, new Map(), ac.signal)
    ac.abort()
    await expect(promise).rejects.toThrow("Interrupted by user")
  })

  test("terminates worker when abort signal fires", async () => {
    const ac = new AbortController()
    const promise = executeJsCell("longRunning()", 0, new Map(), ac.signal).catch(() => {})
    ac.abort()
    await promise
    // terminate is called asynchronously via setImmediate, give it a tick
    await new Promise(r => setImmediate(r))
    expect(lastWorker!.terminate).toHaveBeenCalled()
  })

  test("rejects when Worker constructor throws", async () => {
    MockWorkerClass.mockImplementationOnce(() => {
      throw new Error("cannot spawn worker")
    })
    await expect(executeJsCell("1", 0, new Map())).rejects.toThrow("cannot spawn worker")
  })

  test("rejects when postMessage throws (non-serializable data)", async () => {
    // Override Worker constructor to create a worker whose postMessage throws
    MockWorkerClass.mockImplementationOnce(() => {
      lastWorker = createMockWorker()
      lastWorker.postMessage.mockImplementation(() => {
        throw new Error("DataCloneError")
      })
      return lastWorker
    })
    await expect(executeJsCell("1", 0, new Map())).rejects.toThrow("DataCloneError")
  })

  test("only settles once — second message is ignored after first", async () => {
    const promise = executeJsCell("1", 0, new Map())
    lastWorker!._triggerMessage({ success: true, result: 42 })
    lastWorker!._triggerMessage({ success: true, result: 999 })
    const result = await promise
    expect(result.result).toBe(42)
  })

  test("only settles once — exit after success message is ignored", async () => {
    const promise = executeJsCell("1", 0, new Map())
    lastWorker!._triggerMessage({ success: true, result: "first" })
    lastWorker!._triggerExit(0)
    const result = await promise
    expect(result.result).toBe("first")
  })
})

// ── Timeout ──────────────────────────────────────────────────────────────────

describe("executeJsCell — timeout", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test("rejects with timeout message after JS_EXECUTION_TIMEOUT_MS", async () => {
    const promise = executeJsCell("while(true){}", 0, new Map())
    jest.advanceTimersByTime(JS_EXECUTION_TIMEOUT_MS + 1)
    await expect(promise).rejects.toThrow(/timed out/)
  })

  test("terminates worker on timeout", async () => {
    const promise = executeJsCell("while(true){}", 0, new Map()).catch(() => {})
    jest.advanceTimersByTime(JS_EXECUTION_TIMEOUT_MS + 1)
    await promise
    // terminate is called via setImmediate which is faked — advance timers to flush it
    jest.advanceTimersByTime(0)
    expect(lastWorker!.terminate).toHaveBeenCalled()
  })

  test("does not timeout if result arrives in time", async () => {
    const promise = executeJsCell("1", 0, new Map())
    jest.advanceTimersByTime(100)
    lastWorker!._triggerMessage({ success: true, result: 1 })
    const result = await promise
    expect(result.result).toBe(1)
  })
})
