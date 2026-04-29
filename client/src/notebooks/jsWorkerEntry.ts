/**
 * Worker thread entry point for JavaScript cell execution.
 *
 * Runs in an isolated Worker thread. Processes exactly ONE message,
 * sends the result, then exits.
 *
 * Data transfer uses postMessage's structured clone — preserves Date,
 * Map, Set, RegExp, ArrayBuffer, typed arrays. No JSON round-trip.
 *
 * SECURITY: The worker_threads boundary is the real isolation — the
 * worker cannot access extension host memory, VS Code APIs, or SAP
 * session tokens.
 */

import { parentPort } from "worker_threads"
import * as vm from "vm"
import * as v8 from "v8"

interface WorkerRequest {
  code: string
  cellIndex: number
  cellResults: Record<string, { result: unknown }>
  timeoutMs: number
}

interface WorkerResponse {
  success: boolean
  result?: unknown
  logs?: string[]
  error?: string
}

if (!parentPort) {
  process.exit(1)
}

const MAX_RESULT_BYTES = 50 * 1024 * 1024

parentPort.once("message", async (request: WorkerRequest) => {
  const { code, cellIndex, cellResults, timeoutMs } = request
  const logs: string[] = []

  try {
    const cellsProxy = buildCellsAccessor(cellResults)

    const sandbox: Record<string, unknown> = {
      cells: cellsProxy,
      console: {
        log: (...args: unknown[]) => logs.push(args.map(formatLogArg).join(" ")),
        warn: (...args: unknown[]) => logs.push("[warn] " + args.map(formatLogArg).join(" ")),
        error: (...args: unknown[]) => logs.push("[error] " + args.map(formatLogArg).join(" "))
      },
      Math, Date, JSON,
      parseInt, parseFloat, isNaN, isFinite,
      Array, Object, String, Number, Boolean,
      Map, Set, RegExp, Error, Promise
    }

    const wrappedCode = wrapAsAsyncFunction(code)
    const context = vm.createContext(sandbox)
    const script = new vm.Script(wrappedCode, { filename: `cell_${cellIndex}.js` })

    const asyncFn = script.runInContext(context, { timeout: timeoutMs })

    let result: unknown
    if (typeof asyncFn === "function") {
      result = await withTimeout(asyncFn(), timeoutMs)
    } else {
      result = asyncFn
    }

    let sizeBytes: number
    try {
      sizeBytes = v8.serialize(result).byteLength
    } catch {
      sizeBytes = MAX_RESULT_BYTES + 1
    }

    if (sizeBytes > MAX_RESULT_BYTES) {
      sendResponse({
        success: false,
        error: `Result too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Max ${MAX_RESULT_BYTES / 1024 / 1024}MB. Filter or reduce data.`,
        ...(logs.length > 0 ? { logs } : {})
      })
    } else {
      sendResponse({
        success: true,
        result,
        ...(logs.length > 0 ? { logs } : {})
      })
    }
  } catch (err: any) {
    sendResponse({
      success: false,
      error: err?.message || String(err),
      ...(logs.length > 0 ? { logs } : {})
    })
  }
})

function sendResponse(response: WorkerResponse): void {
  parentPort!.postMessage(response)
  setTimeout(() => process.exit(0), 50)
}

function buildCellsAccessor(
  cellResults: Record<string, { result: unknown }>
): Record<string, { result: unknown }> {
  return new Proxy({} as Record<string, { result: unknown }>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined
      const entry = cellResults[prop]
      if (!entry) {
        throw new Error(`Cell [${prop}] has no result yet. Run it first.`)
      }
      return entry
    }
  })
}

function wrapAsAsyncFunction(code: string): string {
  const trimmed = code.trim()

  if (/^\s*return\s/m.test(trimmed) &&
    !trimmed.startsWith("const ") &&
    !trimmed.startsWith("let ") &&
    !trimmed.startsWith("var ") &&
    !trimmed.startsWith("function")) {
    return `(async function() {\n${trimmed}\n})`
  }

  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "")
  const lines = withoutTrailingSemicolon.split("\n")
  const lastLine = lines[lines.length - 1].trim()

  if (!lastLine || lastLine.startsWith("//") || lastLine.startsWith("/*")) {
    return `(async function() {\n${trimmed}\n})`
  }

  const isNonReturnable = /^(const |let |var |if\b|for\b|while\b|switch\b|try\b|class\b|function\b|throw\b|do\b|\{|\}|\[)/.test(lastLine)

  if (isNonReturnable) {
    return `(async function() {\n${trimmed}\n})`
  }

  if (lines.length === 1) {
    return `(async function() {\nreturn (${withoutTrailingSemicolon})\n})`
  }

  const allButLast = lines.slice(0, -1).join("\n")
  return `(async function() {\n${allButLast}\nreturn (${lastLine})\n})`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)
    promise.then(
      val => { clearTimeout(timer); resolve(val) },
      err => { clearTimeout(timer); reject(err) }
    )
  })
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg
  try {
    return JSON.stringify(arg, null, 2)
  } catch {
    return String(arg)
  }
}
