import { EventEmitter } from "events"
import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  workers: [] as any[],
  handler: undefined as ((request: any) => void) | undefined,
  response: vi.fn()
}))
vi.mock("worker_threads", () => ({
  parentPort: {
    on: (_event: string, handler: (request: any) => void) => {
      mocks.handler = handler
    },
    postMessage: mocks.response
  },
  Worker: vi.fn(function () {
    const worker = new EventEmitter() as any
    worker.postMessage = vi.fn()
    worker.terminate = vi.fn(async () => 0)
    mocks.workers.push(worker)
    return worker
  })
}))
import { RepositoryFormatWorker, RepositoryFormatWorkerPool } from "./formatWorker"
import "./formatWorkerEntry"

describe("RepositoryFormatWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workers.length = 0
  })
  it("bounds parallel work and reuses idle pool workers", async () => {
    const pool = new RepositoryFormatWorkerPool(2)
    const first = pool.format({ fileName: "first.abap", source: "first" })
    const second = pool.format({ fileName: "second.abap", source: "second" })
    const third = pool.format({ fileName: "third.abap", source: "third" })
    await Promise.resolve()
    expect(mocks.workers).toHaveLength(2)
    expect(mocks.workers[0].postMessage).toHaveBeenCalledTimes(1)
    expect(mocks.workers[1].postMessage).toHaveBeenCalledTimes(1)
    mocks.workers[0].emit("message", { result: "FIRST" })
    mocks.workers[1].emit("message", { result: "SECOND" })
    await Promise.all([first, second])
    expect(mocks.workers[0].postMessage).toHaveBeenCalledTimes(2)
    mocks.workers[0].emit("message", { result: "THIRD" })
    expect(await third).toBe("THIRD")
    const fourth = pool.format({ fileName: "fourth.abap", source: "fourth" })
    await Promise.resolve()
    mocks.workers[0].emit("message", { result: "FOURTH" })
    expect(await fourth).toBe("FOURTH")
    expect(mocks.workers).toHaveLength(2)
    await pool.dispose()
    for (const worker of mocks.workers) expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it("reuses one worker and serializes requests", async () => {
    const formatter = new RepositoryFormatWorker()
    const first = formatter.format({ fileName: "first.abap", source: "first" })
    const second = formatter.format({ fileName: "second.abap", source: "second" })
    await Promise.resolve()
    const worker = mocks.workers[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    worker.emit("message", { result: "FIRST" })
    expect(await first).toBe("FIRST")
    await Promise.resolve()
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    worker.emit("message", { result: "SECOND" })
    expect(await second).toBe("SECOND")
    expect(mocks.workers).toHaveLength(1)
    await formatter.dispose()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it("isolates a crashed pool worker and replaces it for queued work", async () => {
    const pool = new RepositoryFormatWorkerPool(2)
    const first = pool.format({ fileName: "first.abap", source: "first" })
    const rejected = expect(first).rejects.toThrow("crashed")
    const second = pool.format({ fileName: "second.abap", source: "second" })
    const third = pool.format({ fileName: "third.abap", source: "third" })
    await Promise.resolve()
    mocks.workers[0].emit("error", new Error("crashed"))
    mocks.workers[1].emit("message", { result: "SECOND" })
    await rejected
    expect(await second).toBe("SECOND")
    expect(mocks.workers).toHaveLength(3)
    mocks.workers[2].emit("message", { result: "THIRD" })
    expect(await third).toBe("THIRD")
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
    await pool.dispose()
  })
  it("cancels active and queued pool work without starting queued workers", async () => {
    const handlers: (() => void)[] = []
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (handler: () => void) => {
        handlers.push(handler)
        return { dispose: vi.fn() }
      }
    }
    const pool = new RepositoryFormatWorkerPool(2)
    const tasks = Array.from({ length: 4 }, () =>
      pool.format({ fileName: "main.abap", source: "source" }, token as any)
    )
    const rejected = tasks.map(task => expect(task).rejects.toThrow("cancelled"))
    await Promise.resolve()
    token.isCancellationRequested = true
    for (const handler of handlers) handler()
    await Promise.all(rejected)
    expect(mocks.workers).toHaveLength(2)
    for (const worker of mocks.workers) expect(worker.terminate).toHaveBeenCalledTimes(1)
    await pool.dispose()
  })
  it("returns worker formatting errors", async () => {
    const formatter = new RepositoryFormatWorker()
    const result = formatter.format({ fileName: "main.abap", source: "invalid" })
    const rejected = expect(result).rejects.toThrow("invalid range")
    await Promise.resolve()
    mocks.workers[0].emit("message", { error: "invalid range" })
    await rejected
    await formatter.dispose()
  })
  it("rejects already cancelled tasks without starting a worker", async () => {
    const formatter = new RepositoryFormatWorker()
    await expect(
      formatter.format({ fileName: "main.abap", source: "source" }, {
        isCancellationRequested: true
      } as any)
    ).rejects.toThrow("cancelled")
    expect(mocks.workers).toHaveLength(0)
  })
  it.each(["error", "exit"])("terminates a failed worker on %s", async event => {
    const formatter = new RepositoryFormatWorker()
    const result = formatter.format({ fileName: "main.abap", source: "source" })
    const rejected = expect(result).rejects.toThrow()
    await Promise.resolve()
    mocks.workers[0].emit(event, event === "error" ? new Error("crashed") : 1)
    await rejected
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
  it("terminates the worker when a running task is cancelled", async () => {
    let cancel = () => {}
    const dispose = vi.fn()
    const formatter = new RepositoryFormatWorker()
    const result = formatter.format({ fileName: "main.abap", source: "source" }, {
      isCancellationRequested: false,
      onCancellationRequested: (handler: () => void) => {
        cancel = handler
        return { dispose }
      }
    } as any)
    const rejected = expect(result).rejects.toThrow("cancelled")
    await Promise.resolve()
    cancel()
    await rejected
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
  it("terminates a timed-out worker", async () => {
    vi.useFakeTimers()
    const formatter = new RepositoryFormatWorker()
    try {
      const result = formatter.format({ fileName: "main.abap", source: "source" })
      const rejected = expect(result).rejects.toThrow("timed out")
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(120_000)
      await rejected
      expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
    } finally {
      await formatter.dispose()
      vi.useRealTimers()
    }
  })
  it("terminates a worker when sending the request fails", async () => {
    const formatter = new RepositoryFormatWorker()
    const first = formatter.format({ fileName: "main.abap", source: "first" })
    await Promise.resolve()
    const worker = mocks.workers[0]
    worker.emit("message", { result: "FIRST" })
    await first
    worker.postMessage.mockImplementation(() => {
      throw new Error("send failed")
    })
    await expect(formatter.format({ fileName: "main.abap", source: "second" })).rejects.toThrow(
      "send failed"
    )
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

describe("formatter worker entry", () => {
  beforeEach(() => mocks.response.mockClear())

  it("executes ABAPLint in the worker entry", () => {
    mocks.handler!({ fileName: "ztest.prog.abap", source: "report ztest.\nwrite 'CaseSensitive'." })
    expect(mocks.response).toHaveBeenCalledWith({ result: "REPORT ztest.\nWRITE 'CaseSensitive'." })
  })

  it("sorts class methods using SAP links and inclusive ranges before formatting", () => {
    const source =
      "CLASS zcl_test DEFINITION. PUBLIC SECTION. METHODS: zebra, alpha. ENDCLASS.\n" +
      "CLASS zcl_test IMPLEMENTATION.\n" +
      "METHOD zebra.\nWRITE 'Z'.\nENDMETHOD.\n" +
      "METHOD alpha.\nWRITE 'A'.\nENDMETHOD.\nENDCLASS."
    const elements = [
      ["ZEBRA", 3, 5],
      ["ALPHA", 6, 8]
    ].map(([name, start, end]) => ({
      name,
      type: "CLAS/OM",
      children: [],
      links: [
        {
          rel: "http://www.sap.com/adt/relations/source/implementationBlock",
          href: `./source/main#start=${start},0;end=${end},9`
        }
      ]
    }))
    mocks.handler!({
      fileName: "zcl_test.clas.abap",
      source,
      methodMap: {
        className: "ZCL_TEST",
        sourceUrl: "/sap/bc/adt/oo/classes/zcl_test/source/main",
        elements
      }
    })
    const response = mocks.response.mock.calls[0][0]
    expect(response.error).toBeUndefined()
    expect(response.result.indexOf("METHOD alpha.")).toBeLessThan(
      response.result.indexOf("METHOD zebra.")
    )
    expect(response.result).toContain("WRITE 'A'.")
    expect(response.result).toContain("WRITE 'Z'.")
  })

  it("returns metadata validation failures rather than silently formatting unsorted source", () => {
    mocks.handler!({
      fileName: "zcl_test.clas.abap",
      source: "CLASS zcl_test IMPLEMENTATION. METHOD zebra. ENDMETHOD. ENDCLASS.",
      methodMap: {
        className: "ZCL_TEST",
        sourceUrl: "/sap/bc/adt/oo/classes/zcl_test/source/main",
        elements: []
      }
    })
    expect(mocks.response).toHaveBeenCalledWith({
      error: "ADT method inventory does not match downloaded global class source"
    })
  })
})
