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
  JevAskOptions,
  JevChoiceQuestion,
  JevEntry,
  JevFailureReason,
  JevOutcome,
  JevQuestion,
  JevQuestions,
  JevRequest,
  JevResponse
} from "./types"

type JevNonSuccessOutcome = Exclude<JevOutcome, { readonly status: "success" }>
type JevFailedOutcome = Extract<JevOutcome, { readonly status: "failed" }>

interface JevTransport {
  systemOne(request: unknown, options?: RequestOptions): Promise<unknown>
}

export interface JevServiceDependencies {
  readApiKey(): string | undefined
  createClient(apiKey: string): JevTransport
}

const defaultDependencies: JevServiceDependencies = {
  readApiKey: () => process.env.TYPESAFE_API_KEY,
  createClient: apiKey =>
    new TypeSafeClient({
      apiKey,
      logLevel: "off",
      retry: { maxRetries: 0 }
    })
}

export class JevService {
  private client?: JevTransport
  private clientApiKey?: string

  constructor(private readonly dependencies: JevServiceDependencies = defaultDependencies) {}

  async ask<const Questions extends JevQuestions>(
    request: JevRequest<Questions>,
    options: JevAskOptions = {}
  ): Promise<JevOutcome<Questions>> {
    if (options.signal?.aborted) return cancelled()

    const apiKey = this.dependencies.readApiKey()?.trim()
    if (!apiKey) {
      return {
        status: "unavailable",
        reason: "missing-api-key",
        message: "Jev is unavailable because TYPESAFE_API_KEY is not set."
      }
    }

    const validationError = validateRequest(request, options)
    if (validationError) return failed("invalid-request", validationError, false)

    try {
      const client = this.getClient(apiKey)
      const requestOptions: RequestOptions = {
        signal: options.signal,
        retry: { maxRetries: options.maxRetries ?? 0 },
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs })
      }
      const rawResponse = await client.systemOne(request, requestOptions)
      const response = parseResponse(rawResponse, request.questions)
      if (!response) {
        return failed(
          "invalid-response",
          "Jev returned a response that ABAP FS could not validate.",
          false
        )
      }
      return { status: "success", response }
    } catch (error) {
      return mapError(error)
    }
  }

  private getClient(apiKey: string): JevTransport {
    if (!this.client || this.clientApiKey !== apiKey) {
      this.client = this.dependencies.createClient(apiKey)
      this.clientApiKey = apiKey
    }
    return this.client
  }
}

const defaultService = new JevService()

export function askJev<const Questions extends JevQuestions>(
  request: JevRequest<Questions>,
  options?: JevAskOptions
): Promise<JevOutcome<Questions>> {
  return defaultService.ask(request, options)
}

function validateRequest(request: JevRequest, options: JevAskOptions): string | undefined {
  if (!isRecord(request)) return "Jev request must be an object."
  if (!isEntry(request.state)) return "Jev state must be text, an object, an array, or null."
  if (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim()))
    return "Jev model must be a non-empty string."
  if (!isRecord(request.questions) || !Object.keys(request.questions).length)
    return "Jev request must contain at least one question."
  for (const [id, question] of Object.entries(request.questions)) {
    const error = validateQuestion(id, question)
    if (error) return error
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  )
    return "Jev timeout must be a positive number of milliseconds."
  if (
    options.maxRetries !== undefined &&
    (!Number.isInteger(options.maxRetries) || options.maxRetries < 0)
  )
    return "Jev maxRetries must be a non-negative integer."
  return undefined
}

function validateQuestion(id: string, value: unknown): string | undefined {
  if (!id.trim() || !isRecord(value) || !isInstruction(value.instructions))
    return `Jev question "${id}" is invalid.`
  switch (value.type) {
    case "noul":
      if (value.criteria === undefined) return undefined
      if (
        !isRecord(value.criteria) ||
        Object.keys(value.criteria).some(key => key !== "true" && key !== "false") ||
        Object.values(value.criteria).some(description => !isEntry(description))
      )
        return `Jev Noul question "${id}" has invalid criteria.`
      return undefined
    case "choice":
      if (
        !isRecord(value.criteria) ||
        Object.keys(value.criteria).length < 2 ||
        Object.values(value.criteria).some(description => !isEntry(description))
      )
        return `Jev Choice question "${id}" needs at least two valid options.`
      return undefined
    case "score":
      if (
        !Array.isArray(value.criteria) ||
        value.criteria.length < 2 ||
        value.criteria.length > 10 ||
        value.criteria.some(description => !isEntry(description))
      )
        return `Jev Score question "${id}" needs between 2 and 10 valid levels.`
      return undefined
    default:
      return `Jev question "${id}" has an unsupported type.`
  }
}

function parseResponse<Questions extends JevQuestions>(
  value: unknown,
  questions: Questions
): JevResponse<Questions> | undefined {
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
    answers: value.answers as JevResponse<Questions>["answers"],
    usage: {
      inputTokens: value.usage.input_tokens,
      outputTokens: value.usage.output_tokens
    }
  }
}

function isValidAnswer(value: unknown, question: JevQuestion): boolean {
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

function isEntry(value: unknown): value is JevEntry {
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

function mapError(error: unknown): JevNonSuccessOutcome {
  if (error instanceof APIUserAbortError) return cancelled()
  if (error instanceof APIError && isContextLimitError(error))
    return apiFailure(
      error,
      "context-limit",
      "Jev could not evaluate the request because its context is too large.",
      false
    )
  if (error instanceof AuthenticationError)
    return apiFailure(error, "authentication", "Jev authentication failed.", false)
  if (error instanceof PermissionDeniedError)
    return apiFailure(error, "permission", "The TypeSafe account cannot use Jev.", false)
  if (error instanceof RateLimitError)
    return {
      ...apiFailure(error, "rate-limit", "Jev is rate limited. Try again later.", true),
      retryAfterMs: error.retryAfterMs
    }
  if (error instanceof APITimeoutError)
    return failed("timeout", "Jev did not respond before the timeout.", true)
  if (error instanceof APIConnectionError)
    return failed("connection", "ABAP FS could not reach Jev.", true)
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError)
    return apiFailure(error, "invalid-request", "Jev rejected the request.", false)
  if (error instanceof APIError)
    return apiFailure(
      error,
      "service",
      "Jev could not complete the request.",
      error.status === 408 || error.status >= 500
    )
  if (error instanceof TypeSafeError)
    return failed("invalid-request", "ABAP FS could not create a valid Jev request.", false)
  return failed("unknown", "Jev failed unexpectedly.", false)
}

function isContextLimitError(error: APIError): boolean {
  if (!isRecord(error.body) || !isRecord(error.body.detail)) return false
  return error.body.detail.error_type === "max_tokens_exceeded"
}

function apiFailure(
  error: APIError,
  reason: JevFailureReason,
  message: string,
  retryable: boolean
): JevFailedOutcome {
  return {
    ...failed(reason, message, retryable),
    statusCode: error.status,
    requestId: error.requestId
  } as const
}

function failed(reason: JevFailureReason, message: string, retryable: boolean): JevFailedOutcome {
  return { status: "failed", reason, message, retryable }
}

function cancelled(): JevNonSuccessOutcome {
  return { status: "cancelled", message: "The Jev request was cancelled." }
}
