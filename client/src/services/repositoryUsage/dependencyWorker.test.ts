import { EventEmitter } from "events"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createRequire } from "module"
import { transpileModule, ModuleKind, ScriptTarget } from "typescript"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DependencyGraphRequest } from "./dependencyWorker"

const mocks = vi.hoisted(() => ({
  workers: [] as (EventEmitter & {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
  })[],
  handler: undefined as ((request: DependencyGraphRequest) => void) | undefined,
  response: vi.fn()
}))
vi.mock("worker_threads", () => ({
  parentPort: {
    on: (_event: string, handler: (request: DependencyGraphRequest) => void) => {
      mocks.handler = handler
    },
    postMessage: mocks.response
  },
  Worker: vi.fn(function () {
    const worker = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      terminate: vi.fn(async () => 0)
    })
    mocks.workers.push(worker)
    return worker
  })
}))
import { DependencyGraphWorker } from "./dependencyWorker"
import "./dependencyWorkerEntry"

const request: DependencyGraphRequest = {
  inventory: ["A", "B"].map(name => ({
    pgmid: "R3TR",
    objectType: "PROG",
    objectName: name,
    packageName: "ZPACKAGE"
  })),
  observations: [
    { id: "seed", source: "jobs", keys: ["R3TR:PROG:A"], seeds: ["R3TR:PROG:A"], reason: "Job" }
  ],
  edges: [{ caller: "R3TR:PROG:A", dependency: "R3TR:PROG:B", source: "Where-used" }]
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.workers.length = 0
})
describe("dependency graph worker", () => {
  it("computes classifications in a real worker thread", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-worker-"))
    const { Worker: NativeWorker } = createRequire(import.meta.url)(
      "node:worker_threads"
    ) as typeof import("worker_threads")
    let worker: InstanceType<typeof NativeWorker> | undefined
    try {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }))
      for (const name of ["analysis", "dependencyWorkerEntry"]) {
        const source = await fs.readFile(path.join(import.meta.dirname, `${name}.ts`), "utf8")
        const output = transpileModule(source, {
          compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 }
        }).outputText.replace('from "./analysis"', 'from "./analysis.js"')
        await fs.writeFile(path.join(root, `${name}.js`), output)
      }
      worker = new NativeWorker(path.join(root, "dependencyWorkerEntry.js"))
      const active = worker
      const response = new Promise<unknown>((resolve, reject) => {
        active.once("message", resolve)
        active.once("error", reject)
        active.once("exit", code => reject(new Error(`Worker exited (${code})`)))
      })
      active.postMessage({
        ...request,
        inventory: [
          ...request.inventory,
          { pgmid: "R3TR", objectType: "PROG", objectName: "C", packageName: "ZPACKAGE" }
        ],
        edges: [
          ...request.edges,
          { caller: "R3TR:PROG:B", dependency: "R3TR:PROG:C", source: "Where-used" }
        ],
        previousUsed: ["R3TR:PROG:A"]
      })
      expect(await response).toEqual({ used: ["R3TR:PROG:A", "R3TR:PROG:B"] })
    } finally {
      await worker?.terminate()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
  it("reuses one worker for pass reassessments and releases it at the end", async () => {
    const graph = new DependencyGraphWorker()
    const first = graph.evaluate(request, new AbortController().signal)
    mocks.workers[0].emit("message", { used: ["R3TR:PROG:A", "R3TR:PROG:B"] })
    expect(await first).toHaveLength(2)
    const second = graph.evaluate(request, new AbortController().signal)
    expect(mocks.workers).toHaveLength(1)
    mocks.workers[0].emit("message", { used: ["R3TR:PROG:A"] })
    expect(await second).toHaveLength(1)
    await graph.dispose()
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
  it("cancels reassessment and terminates its worker", async () => {
    const graph = new DependencyGraphWorker()
    const controller = new AbortController()
    const pending = graph.evaluate(request, controller.signal)
    const rejected = expect(pending).rejects.toThrow("Analysis paused")
    controller.abort()
    await rejected
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
  it("runs scoped transitive classification in the worker entry", () => {
    mocks.handler!(request)
    expect(mocks.response).toHaveBeenCalledWith({ used: ["R3TR:PROG:A", "R3TR:PROG:B"] })
  })
  it("propagates worker crashes rather than reporting empty dependency results", async () => {
    const graph = new DependencyGraphWorker()
    const pending = graph.evaluate(request, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow("Worker failed")
    mocks.workers[0].emit("error", new Error("Worker failed"))
    await rejected
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
})
