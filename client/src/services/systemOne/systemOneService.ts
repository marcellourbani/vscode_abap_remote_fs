/**
 * Talks to a System One engine over `POST /v1/systemone`, which Jev and a self-hosted Laya
 * both speak.
 *
 * Every restriction and quirk that differs between the two is applied here rather than by
 * whoever calls: the caller names an engine, passes a request, and gets a typed outcome.
 * Nothing throws, and no engine-specific knowledge is needed to use it safely.
 */

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
  type RequestOptions
} from "@typesafe-ai/sdk"
import {
  readEnvironment,
  resolveBackend,
  type BackendResolution,
  type DecisionBackend,
  type DecisionEngine
} from "./backend"
import { engineLimits, stateLength, type EngineLimits } from "./engines"
import type {
  SystemOneAskOptions,
  SystemOneEntry,
  SystemOneFailureReason,
  SystemOneOutcome,
  SystemOneQuestion,
  SystemOneQuestions,
  SystemOneRequest,
  SystemOneResponse,
  SystemOneUsage
} from "./types"

type NonSuccessOutcome = Exclude<SystemOneOutcome, { readonly status: "success" }>
type FailedOutcome = Extract<SystemOneOutcome, { readonly status: "failed" }>

interface SystemOneTransport {
  systemOne(request: unknown, options?: RequestOptions): Promise<unknown>
}

export interface SystemOneServiceDependencies {
  resolveBackend(engine: DecisionEngine): BackendResolution
  createClient(backend: DecisionBackend): SystemOneTransport
}

const defaultDependencies: SystemOneServiceDependencies = {
  resolveBackend: engine => resolveBackend(engine, readEnvironment()),
  createClient: backend =>
    new TypeSafeClient({
      apiKey: backend.apiKey,
      // Both are explicit so one engine's configuration can never reach the other through
      // the SDK's own environment fallbacks.
      baseURL: backend.baseUrl,
      defaultModel: backend.defaultModel,
      logLevel: "off",
      retry: { maxRetries: 0 }
    })
}

export class SystemOneService {
  private readonly clients = new Map<string, SystemOneTransport>()

  constructor(private readonly dependencies: SystemOneServiceDependencies = defaultDependencies) {}

  async ask<const Questions extends SystemOneQuestions>(
    engine: DecisionEngine,
    request: SystemOneRequest<Questions>,
    options: SystemOneAskOptions = {}
  ): Promise<SystemOneOutcome<Questions>> {
    const limits = engineLimits(engine)
    if (options.signal?.aborted) return cancelled(limits.label)

    const resolution = this.dependencies.resolveBackend(engine)
    if (resolution.status !== "ready")
      return {
        status: "unavailable",
        reason: resolution.status === "invalid" ? "invalid-configuration" : "not-configured",
        message: resolution.message
      }

    const rejection = validateRequest(limits, request, options)
    if (rejection) return failed(rejection.reason, rejection.message, false)

    try {
      const client = this.getClient(resolution.backend)
      const requestOptions: RequestOptions = {
        signal: options.signal,
        retry: { maxRetries: options.maxRetries ?? 0 },
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs })
      }
      const rawResponse = await client.systemOne(
        withTokenBudget(request, limits, options.maxLen),
        requestOptions
      )
      const response = parseResponse(rawResponse, request.questions)
      if (!response)
        return failed(
          "invalid-response",
          `${limits.label} returned a response that ABAP FS could not validate.`,
          false
        )
      return { status: "success", response }
    } catch (error) {
      return mapError(limits, error)
    }
  }

  /**
   * One client per backend, kept so features alternating between engines do not rebuild a
   * client on every call.
   */
  private getClient(backend: DecisionBackend): SystemOneTransport {
    const key = [backend.engine, backend.baseUrl, backend.apiKey, backend.defaultModel].join(
      "\u0000"
    )
    const existing = this.clients.get(key)
    if (existing) return existing
    const client = this.dependencies.createClient(backend)
    this.clients.set(key, client)
    return client
  }
}

const defaultService = new SystemOneService()

export function askSystemOne<const Questions extends SystemOneQuestions>(
  engine: DecisionEngine,
  request: SystemOneRequest<Questions>,
  options?: SystemOneAskOptions
): Promise<SystemOneOutcome<Questions>> {
  return defaultService.ask(engine, request, options)
}

/**
 * Laya sizes the state it reads from the request rather than from a server setting, so a
 * budget can only come from here. None is sent unless the caller names one, leaving the
 * checkpoint default in place. Jev sizes its own context and never receives the field.
 */
function withTokenBudget(
  request: SystemOneRequest,
  limits: EngineLimits,
  budget: number | undefined
): unknown {
  if (!limits.tokenBudget || budget === undefined) return request
  return { ...request, max_len: budget }
}

interface Rejection {
  readonly reason: SystemOneFailureReason
  readonly message: string
}

const invalid = (message: string): Rejection => ({ reason: "invalid-request", message })

/**
 * `context-limit` is reserved for the state being too long, which is the one breach a
 * caller can act on by sending less. A question or option count over the limit is an
 * authoring mistake, so it reads as an invalid request even though the server answers both
 * with a 413.
 */
function validateRequest(
  limits: EngineLimits,
  request: SystemOneRequest,
  options: SystemOneAskOptions
): Rejection | undefined {
  const { label } = limits
  if (!isRecord(request)) return invalid(`${label} request must be an object.`)
  if (!isEntry(request.state))
    return invalid(`${label} state must be text, an object, an array, or null.`)
  if (limits.requiresState && request.state === null)
    return invalid(`${label} needs a state to reason about.`)
  if (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim()))
    return invalid(`${label} model must be a non-empty string.`)
  if (!isRecord(request.questions) || !Object.keys(request.questions).length)
    return invalid(`${label} request must contain at least one question.`)

  const questions = Object.entries(request.questions)
  if (limits.maxQuestions !== undefined && questions.length > limits.maxQuestions)
    return invalid(
      `${label} answers at most ${limits.maxQuestions} questions in one request, not ${questions.length}.`
    )

  let totalOptions = 0
  for (const [id, question] of questions) {
    const error = validateQuestion(limits, id, question)
    if (error) return error
    totalOptions += optionCount(question)
  }
  if (limits.maxTotalOptions !== undefined && totalOptions > limits.maxTotalOptions)
    return invalid(
      `${label} accepts at most ${limits.maxTotalOptions} options and score levels across all questions, not ${totalOptions}.`
    )

  const stateError = validateStateSize(limits, request.state)
  if (stateError) return stateError

  return validateOptions(limits, options)
}

function validateStateSize(limits: EngineLimits, state: SystemOneEntry): Rejection | undefined {
  if (limits.maxStateChars === undefined) return undefined
  const length = stateLength(state)
  if (length <= limits.maxStateChars) return undefined
  return {
    reason: "context-limit",
    message: `${limits.label} refuses a state over ${limits.maxStateChars.toLocaleString()} characters; this one is ${length.toLocaleString()}.`
  }
}

function validateOptions(
  limits: EngineLimits,
  options: SystemOneAskOptions
): Rejection | undefined {
  const { label } = limits
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  )
    return invalid(`${label} timeout must be a positive number of milliseconds.`)
  if (
    options.maxRetries !== undefined &&
    (!Number.isInteger(options.maxRetries) || options.maxRetries < 0)
  )
    return invalid(`${label} maxRetries must be a non-negative integer.`)
  // A budget for an engine that sizes its own context is dropped rather than refused, so a
  // caller can pass the same options to either engine.
  const budget = limits.tokenBudget
  if (!budget || options.maxLen === undefined) return undefined
  if (
    !Number.isInteger(options.maxLen) ||
    options.maxLen < budget.min ||
    options.maxLen > budget.max
  )
    return invalid(
      `${label} token budget must be a whole number between ${budget.min.toLocaleString()} and ${budget.max.toLocaleString()}.`
    )
  return undefined
}

function validateQuestion(limits: EngineLimits, id: string, value: unknown): Rejection | undefined {
  const { label } = limits
  if (!id.trim() || !isRecord(value) || !isInstruction(value.instructions))
    return invalid(`${label} question "${id}" is invalid.`)
  switch (value.type) {
    case "noul":
      if (value.criteria === undefined) return undefined
      if (
        !isRecord(value.criteria) ||
        Object.keys(value.criteria).some(key => key !== "true" && key !== "false") ||
        Object.values(value.criteria).some(description => !isEntry(description))
      )
        return invalid(`${label} Noul question "${id}" has invalid criteria.`)
      return undefined
    case "choice": {
      if (
        !isRecord(value.criteria) ||
        Object.keys(value.criteria).length < 2 ||
        Object.values(value.criteria).some(description => !isEntry(description))
      )
        return invalid(`${label} Choice question "${id}" needs at least two valid options.`)
      const count = Object.keys(value.criteria).length
      if (limits.maxChoiceOptions !== undefined && count > limits.maxChoiceOptions)
        return invalid(
          `${label} accepts at most ${limits.maxChoiceOptions} options in one Choice question, and "${id}" has ${count}.`
        )
      return undefined
    }
    case "score":
      if (
        !Array.isArray(value.criteria) ||
        value.criteria.length < 2 ||
        value.criteria.length > limits.maxScoreLevels ||
        value.criteria.some(description => !isEntry(description))
      )
        return invalid(
          `${label} Score question "${id}" needs between 2 and ${limits.maxScoreLevels} valid levels.`
        )
      return undefined
    default:
      return invalid(`${label} question "${id}" has an unsupported type.`)
  }
}

/** Options and score levels count towards one shared per-request total; Noul adds nothing. */
function optionCount(question: unknown): number {
  if (!isRecord(question)) return 0
  if (question.type === "choice" && isRecord(question.criteria))
    return Object.keys(question.criteria).length
  if (question.type === "score" && Array.isArray(question.criteria)) return question.criteria.length
  return 0
}

function parseResponse<Questions extends SystemOneQuestions>(
  value: unknown,
  questions: Questions
): SystemOneResponse<Questions> | undefined {
  if (
    !isRecord(value) ||
    typeof value.model !== "string" ||
    !value.model ||
    !isRecord(value.answers) ||
    !isRecord(value.usage) ||
    !isNonNegativeNumber(value.usage.input_tokens) ||
    !isNonNegativeNumber(value.usage.output_tokens)
  )
    return undefined

  for (const [id, question] of Object.entries(questions)) {
    if (!isValidAnswer(value.answers[id], question)) return undefined
  }

  return {
    model: value.model,
    answers: value.answers as SystemOneResponse<Questions>["answers"],
    usage: parseUsage(value.usage)
  }
}

/**
 * Laya reports how much of the state reached the model. Without these fields a state that
 * overflowed the token budget is answered normally, with no sign that most of it was
 * dropped, so they are read when present and left absent for a service that omits them.
 */
function parseUsage(usage: Record<string, unknown>): SystemOneUsage {
  return {
    inputTokens: usage.input_tokens as number,
    outputTokens: usage.output_tokens as number,
    ...(isNonNegativeNumber(usage.state_tokens) ? { stateTokens: usage.state_tokens } : {}),
    ...(isNonNegativeNumber(usage.state_tokens_dropped)
      ? { stateTokensDropped: usage.state_tokens_dropped }
      : {}),
    ...(typeof usage.truncated === "boolean" ? { truncated: usage.truncated } : {})
  }
}

function isValidAnswer(value: unknown, question: SystemOneQuestion): boolean {
  if (!isRecord(value) || value.type !== question.type) return false
  switch (question.type) {
    case "noul":
      return isProbability(value.noul)
    case "choice":
      return (
        typeof value.choice === "string" &&
        hasOwn(question.criteria, value.choice) &&
        isProbability(value.confidence) &&
        hasProbabilities(value.probabilities, Object.keys(question.criteria))
      )
    case "score":
      return (
        typeof value.score === "number" &&
        Number.isFinite(value.score) &&
        isProbability(value.confidence) &&
        isRecord(value.legend) &&
        hasProbabilities(
          value.probabilities,
          question.criteria.map((_, index) => String(index))
        )
      )
  }
}

function hasProbabilities(value: unknown, keys: string[]): boolean {
  return isRecord(value) && keys.every(key => hasOwn(value, key) && isProbability(value[key]))
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isInstruction(value: unknown): boolean {
  return value !== null && isEntry(value)
}

function isEntry(value: unknown): value is SystemOneEntry {
  return (
    value === null ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every(isJsonValue)) ||
    (isRecord(value) && Object.values(value).every(isJsonValue))
  )
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function mapError(limits: EngineLimits, error: unknown): NonSuccessOutcome {
  const { label, apiKeyVariable } = limits
  if (error instanceof APIUserAbortError) return cancelled(label)
  if (error instanceof APIError && isContextLimitError(error))
    return apiFailure(error, "context-limit", contextLimitMessage(label, error), false)
  if (error instanceof AuthenticationError)
    return apiFailure(
      error,
      "authentication",
      `${label} rejected the credential. Check that ${apiKeyVariable} holds a valid key, then restart VS Code.`,
      false
    )
  if (error instanceof PermissionDeniedError)
    return apiFailure(error, "permission", `${label} denied the request.`, false)
  if (error instanceof RateLimitError)
    return {
      ...apiFailure(error, "rate-limit", `${label} is rate limited. Try again later.`, true),
      retryAfterMs: error.retryAfterMs
    }
  if (error instanceof APITimeoutError)
    return failed("timeout", `${label} did not respond before the timeout.`, true)
  if (error instanceof APIConnectionError)
    return failed("connection", `ABAP FS could not reach ${label}.`, true)
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError)
    return apiFailure(error, "invalid-request", rejectedMessage(label, error), false)
  if (error instanceof APIError)
    return apiFailure(
      error,
      "service",
      `${label} could not complete the request.`,
      error.status === 408 || error.status === 503 || error.status >= 500
    )
  if (error instanceof TypeSafeError)
    return failed("invalid-request", `ABAP FS could not create a valid ${label} request.`, false)
  return failed("unknown", `${label} failed unexpectedly.`, false)
}

/**
 * Jev names an oversized request in a structured `detail`; Laya answers 413 before it
 * tokenizes anything. Both mean the request has to shrink.
 */
function isContextLimitError(error: APIError): boolean {
  if (error.status === 413) return true
  if (!isRecord(error.body) || !isRecord(error.body.detail)) return false
  return error.body.detail.error_type === "max_tokens_exceeded"
}

function contextLimitMessage(label: string, error: APIError): string {
  const detail = detailText(error)
  if (detail) return `${label} refused the request: ${detail}`
  return `${label} could not evaluate the request because its context is too large.`
}

function rejectedMessage(label: string, error: APIError): string {
  const detail = detailText(error)
  return detail ? `${label} rejected the request: ${detail}` : `${label} rejected the request.`
}

function detailText(error: APIError): string | undefined {
  if (!isRecord(error.body)) return undefined
  const detail = error.body.detail
  return typeof detail === "string" && detail.trim() ? detail.trim() : undefined
}

function apiFailure(
  error: APIError,
  reason: SystemOneFailureReason,
  message: string,
  retryable: boolean
): FailedOutcome {
  return {
    ...failed(reason, message, retryable),
    statusCode: error.status,
    requestId: error.requestId
  } as const
}

function failed(
  reason: SystemOneFailureReason,
  message: string,
  retryable: boolean
): FailedOutcome {
  return { status: "failed", reason, message, retryable }
}

function cancelled(label: string): NonSuccessOutcome {
  return { status: "cancelled", message: `The ${label} request was cancelled.` }
}
