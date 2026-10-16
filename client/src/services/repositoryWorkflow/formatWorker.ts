import { Worker } from "worker_threads"
import * as path from "path"
import type { CancellationToken } from "vscode"
import type { ClassMethodSnapshotMap } from "./types"

export interface FormatWorkerRequest {
  fileName: string
  source: string
  methodMap?: ClassMethodSnapshotMap
}

export type FormatWorkerResponse =
  { result: string; error?: never } | { result?: never; error: string }

export class RepositoryFormatWorkerPool {
  private readonly slots: { worker: RepositoryFormatWorker; pending: number }[] = []

  constructor(private readonly size = 5) {}

  async format(request: FormatWorkerRequest, token?: CancellationToken): Promise<string> {
    if (token?.isCancellationRequested) throw new Error("Formatting cancelled")
    let slot = this.slots.find(candidate => candidate.pending === 0)
    if (!slot && this.slots.length < this.size) {
      slot = { worker: new RepositoryFormatWorker(), pending: 0 }
      this.slots.push(slot)
    }
    slot ??= this.slots.reduce((least, candidate) =>
      candidate.pending < least.pending ? candidate : least
    )
    slot.pending++
    try {
      return await slot.worker.format(request, token)
    } finally {
      slot.pending--
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(this.slots.map(slot => slot.worker.dispose()))
    this.slots.length = 0
  }
}

export class RepositoryFormatWorker {
  private worker?: Worker
  private queue: Promise<unknown> = Promise.resolve()

  format(request: FormatWorkerRequest, token?: CancellationToken): Promise<string> {
    const task = this.queue.then(() => this.execute(request, token))
    this.queue = task.catch(() => {})
    return task
  }

  private execute(request: FormatWorkerRequest, token?: CancellationToken): Promise<string> {
    if (token?.isCancellationRequested) return Promise.reject(new Error("Formatting cancelled"))
    return new Promise((resolve, reject) => {
      let worker: Worker
      try {
        worker = this.worker ??= new Worker(path.join(__dirname, "repositoryFormatWorkerEntry.js"))
      } catch (error) {
        reject(error)
        return
      }
      let settled = false
      const finish = (error?: Error, result?: string, terminate = false) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cancellation?.dispose()
        worker.removeListener("message", onMessage)
        worker.removeListener("error", onError)
        worker.removeListener("exit", onExit)
        if (terminate) void this.dispose()
        if (error) reject(error)
        else resolve(result ?? "")
      }
      const onMessage = (response: FormatWorkerResponse) => {
        if (typeof response.result === "string") finish(undefined, response.result)
        else finish(new Error(response.error || "Invalid formatter worker response"))
      }
      const onError = (error: Error) => finish(error, undefined, true)
      const onExit = (code: number) =>
        finish(new Error(`Formatter worker exited (${code})`), undefined, true)
      const timer = setTimeout(
        () => finish(new Error("Formatter worker timed out"), undefined, true),
        120_000
      )
      const cancellation = token?.onCancellationRequested(() =>
        finish(new Error("Formatting cancelled"), undefined, true)
      )
      worker.once("message", onMessage)
      worker.once("error", onError)
      worker.once("exit", onExit)
      try {
        worker.postMessage(request)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)), undefined, true)
      }
    })
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    if (worker) await worker.terminate()
  }
}
