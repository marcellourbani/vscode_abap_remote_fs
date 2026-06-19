/**
 * JavaScript cell executor using worker_threads for true isolation.
 *
 * Each JS cell runs in a NEW Worker thread. The worker processes one
 * message, sends the result, and exits. If the cell hangs, the main
 * thread terminates the worker after a timeout.
 *
 * Data is transferred via postMessage which uses V8's structured clone
 * algorithm — preserves Date, Map, Set, RegExp, ArrayBuffer, typed
 * arrays, and all other cloneable types natively. No JSON round-trip.
 */

import { Worker } from "worker_threads"
import * as path from "path"
import { CellResult, JS_EXECUTION_TIMEOUT_MS } from "./types"

function getWorkerScriptPath(): string {
  return path.join(__dirname, "jsWorkerEntry.js")
}

interface WorkerResponse {
  success: boolean
  result?: unknown
  logs?: string[]
  error?: string
}

export async function executeJsCell(
  code: string,
  cellIndex: number,
  cellResults: Map<number, CellResult>,
  abortSignal?: AbortSignal
): Promise<CellResult> {
  if (!code.trim()) {
    return { result: undefined }
  }

  const referencedIndices = findReferencedCellIndices(code)
  const cellData = buildCellData(cellResults, referencedIndices)

  return new Promise<CellResult>((resolve, reject) => {
    let settled = false
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (onAbort) abortSignal?.removeEventListener("abort", onAbort)
      fn()
      setImmediate(() => {
        try { worker?.terminate() } catch { /* already dead */ }
      })
    }

    timer = setTimeout(() => {
      settle(() => {
        reject(new Error(
          `JavaScript cell timed out after ${JS_EXECUTION_TIMEOUT_MS / 1000}s. ` +
          `Possible infinite loop — the worker was killed.`
        ))
      })
    }, JS_EXECUTION_TIMEOUT_MS)

    const onAbort = () => {
      settle(() => reject(new Error("Interrupted by user.")))
    }

    if (abortSignal?.aborted) {
      if (timer) clearTimeout(timer)
      reject(new Error("Interrupted by user."))
      return
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true })

    try {
      worker = new Worker(getWorkerScriptPath())
    } catch (err: any) {
      settle(() => reject(new Error(`Failed to start JS worker: ${err.message}`)))
      return
    }

    worker.on("message", (response: WorkerResponse) => {
      settle(() => {
        if (response.success) {
          resolve({
            result: response.result,
            ...(response.logs && response.logs.length > 0 ? { logs: response.logs } : {})
          })
        } else {
          resolve({
            result: undefined,
            error: response.error || "Unknown error in JS cell",
            ...(response.logs && response.logs.length > 0 ? { logs: response.logs } : {})
          })
        }
      })
    })

    worker.on("error", (err) => {
      settle(() => reject(new Error(`JS worker error: ${err.message}`)))
    })

    worker.on("exit", (_exitCode) => {
      settle(() => {
        reject(new Error("JS worker exited without sending a result. Check cell syntax."))
      })
    })

    try {
      worker.postMessage({
        code,
        cellIndex,
        cellResults: cellData,
        timeoutMs: JS_EXECUTION_TIMEOUT_MS
      })
    } catch (err: any) {
      settle(() => reject(new Error(`Failed to send data to JS worker: ${err.message}`)))
    }
  })
}

function findReferencedCellIndices(code: string): Set<number> {
  const indices = new Set<number>()
  const pattern = /cells\[(\d+)\]/g
  let match
  while ((match = pattern.exec(code)) !== null) {
    indices.add(parseInt(match[1], 10))
  }
  return indices
}

function buildCellData(
  cellResults: Map<number, CellResult>,
  referencedIndices: Set<number>
): Record<string, { result: unknown }> {
  const data: Record<string, { result: unknown }> = {}
  for (const idx of referencedIndices) {
    const cellResult = cellResults.get(idx)
    if (!cellResult) continue
    data[String(idx)] = { result: cellResult.result }
  }
  return data
}
