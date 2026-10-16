import { randomUUID } from "crypto"
import type { CancellationToken } from "vscode"
import { Uri } from "vscode"

export type TransportIntentProcess = "normal-edit" | "repository-assisted-apply"

export type ObjectSaveTransportChoice =
  { type: "existing"; number: string } | { type: "new"; description: string } | { type: "local" }

export type TransportIntentStatus =
  "armed" | "claimed" | "succeeded" | "failed" | "cancelled" | "expired"

export interface TransportIntentResult {
  intentId: string
  status: TransportIntentStatus | "timed-out"
  process: TransportIntentProcess
  objectUri: string
  transportRequest?: string
  error?: string
  completedAt?: string
}

export interface TransportIntent {
  intentId: string
  status: TransportIntentStatus
  process: TransportIntentProcess
  objectUri: string
  canonicalKey: string
  transportChoice: ObjectSaveTransportChoice
  workflowId?: string
  objectKey?: string
  createdAt: string
  expiresAt: string
}

interface IntentRecord extends TransportIntent {
  resultPromise: Promise<TransportIntentResult>
  resolveResult: (result: TransportIntentResult) => void
  result?: TransportIntentResult
}

const DEFAULT_INTENT_TTL_MS = 2 * 60_000

export class TransportIntentService {
  private static instance: TransportIntentService | undefined
  private readonly byKey = new Map<string, IntentRecord>()
  private readonly byId = new Map<string, IntentRecord>()

  static get() {
    if (!this.instance) this.instance = new TransportIntentService()
    return this.instance
  }

  register(input: {
    objectUri: string | Uri
    process: TransportIntentProcess
    transportChoice: ObjectSaveTransportChoice
    workflowId?: string
    objectKey?: string
    ttlMs?: number
  }): TransportIntent {
    const uri = typeof input.objectUri === "string" ? Uri.parse(input.objectUri) : input.objectUri
    if (uri.scheme !== "adt") throw new Error("Transport intents require an adt:// object URI")
    if (!uri.authority.trim()) throw new Error("Transport intent URI must include a connection")
    const canonicalKey = canonicalTransportIntentKey(uri)
    const previous = this.byKey.get(canonicalKey)
    if (previous) {
      this.expireIfNeeded(previous)
      if (this.byKey.get(canonicalKey))
        throw new Error(`A transport intent is already active for ${uri.toString()}`)
    }
    const transportChoice = normalizeTransportChoice(input.transportChoice)
    const now = Date.now()
    let resolveResult!: (result: TransportIntentResult) => void
    const resultPromise = new Promise<TransportIntentResult>(resolve => {
      resolveResult = resolve
    })
    const record: IntentRecord = {
      intentId: randomUUID(),
      status: "armed",
      process: input.process,
      objectUri: uri.toString(),
      canonicalKey,
      transportChoice,
      workflowId: input.workflowId,
      objectKey: input.objectKey?.trim().toUpperCase() || undefined,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(1, input.ttlMs ?? DEFAULT_INTENT_TTL_MS)).toISOString(),
      resultPromise,
      resolveResult
    }
    this.byKey.set(canonicalKey, record)
    this.byId.set(record.intentId, record)
    return publicIntent(record)
  }

  claim(objectUri: string | Uri): TransportIntent | undefined {
    const uri = typeof objectUri === "string" ? Uri.parse(objectUri) : objectUri
    const record = this.byKey.get(canonicalTransportIntentKey(uri))
    if (!record) return undefined
    if (this.expireIfNeeded(record)) return undefined
    if (record.status !== "armed")
      throw new Error(`Transport intent ${record.intentId} is already ${record.status}`)
    record.status = "claimed"
    return publicIntent(record)
  }

  succeed(intentId: string, transportRequest: string): TransportIntentResult {
    return this.complete(intentId, {
      status: "succeeded",
      transportRequest: transportRequest || undefined
    })
  }

  fail(intentId: string, error: unknown, transportRequest?: string): TransportIntentResult {
    return this.complete(intentId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      transportRequest: transportRequest || undefined
    })
  }

  cancel(intentId: string, error = "Transport intent was cancelled"): TransportIntentResult {
    return this.complete(intentId, { status: "cancelled", error })
  }

  async waitForResult(
    intentId: string,
    token?: CancellationToken,
    timeoutMs = 60_000
  ): Promise<TransportIntentResult> {
    const record = this.byId.get(intentId)
    if (!record) throw new Error(`Transport intent not found: ${intentId}`)
    if (record.result) return record.result
    const unknownResult = (error: string): TransportIntentResult => ({
      intentId,
      status: "timed-out",
      process: record.process,
      objectUri: record.objectUri,
      error
    })
    if (token?.isCancellationRequested)
      return unknownResult("Waiting was cancelled; the save operation may still complete.")
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<TransportIntentResult>(resolve => {
      timeoutHandle = setTimeout(
        () =>
          resolve(unknownResult("Save result is still unknown; the operation may still complete.")),
        Math.max(1, timeoutMs)
      )
    })
    let cancellationDisposable: { dispose(): unknown } | undefined
    const cancellation = token
      ? new Promise<TransportIntentResult>(resolve => {
          cancellationDisposable = token.onCancellationRequested(() =>
            resolve(unknownResult("Waiting was cancelled; the save operation may still complete."))
          )
        })
      : new Promise<TransportIntentResult>(() => {})
    try {
      return await Promise.race([record.resultPromise, timeout, cancellation])
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      cancellationDisposable?.dispose()
    }
  }

  get(intentId: string): TransportIntent | TransportIntentResult | undefined {
    const record = this.byId.get(intentId)
    if (!record) return undefined
    this.expireIfNeeded(record)
    return record.result ?? publicIntent(record)
  }

  resetForTests() {
    this.byKey.clear()
    this.byId.clear()
  }

  private expireIfNeeded(record: IntentRecord): boolean {
    if (record.result || record.status !== "armed" || Date.parse(record.expiresAt) > Date.now())
      return false
    this.complete(record.intentId, {
      status: "expired",
      error: "Transport intent expired before the object was saved"
    })
    return true
  }

  private complete(
    intentId: string,
    completion: {
      status: Exclude<TransportIntentStatus, "armed" | "claimed">
      transportRequest?: string
      error?: string
    }
  ): TransportIntentResult {
    const record = this.byId.get(intentId)
    if (!record) throw new Error(`Transport intent not found: ${intentId}`)
    if (record.result) return record.result
    record.status = completion.status
    const result: TransportIntentResult = {
      intentId,
      status: completion.status,
      process: record.process,
      objectUri: record.objectUri,
      transportRequest: completion.transportRequest,
      error: completion.error,
      completedAt: new Date().toISOString()
    }
    record.result = result
    if (this.byKey.get(record.canonicalKey)?.intentId === intentId)
      this.byKey.delete(record.canonicalKey)
    record.resolveResult(result)
    return result
  }
}

export function canonicalTransportIntentKey(uri: Uri): string {
  return `${uri.authority.trim().toLowerCase()}${uri.path}`
}

function normalizeTransportChoice(choice: ObjectSaveTransportChoice): ObjectSaveTransportChoice {
  if (choice.type === "local") return choice
  if (choice.type === "existing") {
    const number = choice.number?.trim().toUpperCase()
    if (!number) throw new Error("Existing transport choice requires a request number")
    return { type: "existing", number }
  }
  const description = choice.description?.trim()
  if (!description) throw new Error("New transport choice requires a description")
  return { type: "new", description }
}

function publicIntent(record: IntentRecord): TransportIntent {
  const {
    resultPromise: _resultPromise,
    resolveResult: _resolveResult,
    result: _result,
    ...intent
  } = record
  return intent
}
