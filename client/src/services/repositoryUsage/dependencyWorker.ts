import { Worker } from "worker_threads"
import * as path from "path"
import { abortIfNeeded } from "./query"
import type { DependencyEdge, InventoryObject, Observation } from "./types"

export interface DependencyGraphRequest {
  inventory: InventoryObject[]
  observations: Observation[]
  edges: DependencyEdge[]
  previousUsed?: string[]
}
export type DependencyGraphResponse =
  { used: string[]; error?: never } | { used?: never; error: string }

export class DependencyGraphWorker {
  private worker?: Worker

  evaluate(request: DependencyGraphRequest, signal: AbortSignal): Promise<string[]> {
    abortIfNeeded(signal)
    return new Promise((resolve, reject) => {
      const worker = (this.worker ??= new Worker(
        path.join(__dirname, "repositoryUsageWorkerEntry.js")
      ))
      let settled = false
      const finish = (error?: Error, used?: string[], terminate = false) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
        worker.removeListener("message", onMessage)
        worker.removeListener("error", onError)
        worker.removeListener("exit", onExit)
        if (terminate) void this.dispose()
        if (error) reject(error)
        else resolve(used || [])
      }
      const onMessage = (response: DependencyGraphResponse) => {
        if (Array.isArray(response.used)) finish(undefined, response.used)
        else
          finish(new Error(response.error || "Invalid dependency worker response"), undefined, true)
      }
      const onError = (error: Error) => finish(error, undefined, true)
      const onExit = (code: number) =>
        finish(new Error(`Dependency worker exited (${code})`), undefined, true)
      const onAbort = () => finish(new Error("Analysis paused"), undefined, true)
      const timer = setTimeout(
        () => finish(new Error("Dependency reassessment timed out"), undefined, true),
        120_000
      )
      worker.once("message", onMessage)
      worker.once("error", onError)
      worker.once("exit", onExit)
      signal.addEventListener("abort", onAbort, { once: true })
      try {
        const { inventory, observations, edges, previousUsed } = request
        worker.postMessage({ inventory, observations, edges, previousUsed })
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)), undefined, true)
      }
    })
  }

  async dispose() {
    const worker = this.worker
    this.worker = undefined
    if (worker) await worker.terminate()
  }
}
