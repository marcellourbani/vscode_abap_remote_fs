import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeError
} from "@typesafe-ai/sdk"
import { vi } from "vitest"
import type { BackendResolution, DecisionBackend, DecisionEngine } from "./backend"
import { SystemOneService } from "./systemOneService"

const request = {
  state: {
    source: "CLASS zcl_example DEFINITION.",
    candidate: { name: "ZCL_EXAMPLE", description: "Example class" }
  },
  questions: {
    relevant: {
      type: "noul",
      instructions: "Is `candidate` relevant to `source`?",
      criteria: { true: "Directly relevant", false: "Not relevant" }
    },
    category: {
      type: "choice",
      instructions: "Which category best describes `candidate`?",
      criteria: {
        business: "Business logic",
        technical: "Technical infrastructure"
      }
    },
    quality: {
      type: "score",
      instructions: "How useful is `candidate`?",
      criteria: ["Not useful", "Somewhat useful", "Very useful"]
    }
  }
} as const

const response = {
  model: "jev-1.13.0",
  answers: {
    relevant: { type: "noul", noul: 0.92 },
    category: {
      type: "choice",
      choice: "business",
      confidence: 0.8,
      probabilities: { business: 0.9, technical: 0.1 }
    },
    quality: {
      type: "score",
      score: 1.75,
      confidence: 0.7,
      legend: { "0": "Not useful", "1": "Somewhat useful", "2": "Very useful" },
      probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 }
    }
  },
  usage: { input_tokens: 120, output_tokens: 18 }
} as const

const jevBackend: DecisionBackend = {
  engine: "jev",
  baseUrl: "https://api.typesafe.ai",
  apiKey: "test-key",
  defaultModel: "jev-latest"
}

const layaBackend: DecisionBackend = {
  engine: "laya",
  baseUrl: "http://127.0.0.1:8000",
  apiKey: "laya-local-no-auth",
  defaultModel: "convaiinnovations/laya"
}

function setup(resolution: BackendResolution = { status: "ready", backend: jevBackend }) {
  const systemOne = vi.fn()
  const createClient = vi.fn(() => ({ systemOne }))
  const resolveBackend = vi.fn(() => resolution)
  const service = new SystemOneService({ resolveBackend, createClient })
  return { service, systemOne, createClient, resolveBackend }
}

describe("SystemOneService", () => {
  test("stays dormant when the engine is not configured", async () => {
    const { service, createClient } = setup({
      status: "unconfigured",
      engine: "jev",
      message: "Jev is unavailable because TYPESAFE_API_KEY is not set."
    })

    await expect(service.ask("jev", request)).resolves.toEqual({
      status: "unavailable",
      reason: "not-configured",
      message: "Jev is unavailable because TYPESAFE_API_KEY is not set."
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  test("reports a misconfigured base URL separately from an absent one", async () => {
    const { service, createClient } = setup({
      status: "invalid",
      engine: "laya",
      message: "LAYA_BASE_URL is not a valid URL: 127.0.0.1:8000"
    })

    await expect(service.ask("laya", request)).resolves.toEqual({
      status: "unavailable",
      reason: "invalid-configuration",
      message: "LAYA_BASE_URL is not a valid URL: 127.0.0.1:8000"
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  test("returns typed mixed answers and translates usage", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue(response)

    const result = await service.ask("jev", request, { timeoutMs: 2500, maxRetries: 1 })

    expect(result).toEqual({
      status: "success",
      response: {
        model: "jev-1.13.0",
        answers: response.answers,
        usage: { inputTokens: 120, outputTokens: 18 }
      }
    })
    expect(systemOne).toHaveBeenCalledWith(request, {
      signal: undefined,
      retry: { maxRetries: 1 },
      timeout: 2500
    })
    if (result.status === "success") {
      const category: "business" | "technical" = result.response.answers.category.choice
      expect(category).toBe("business")
    }
  })

  test("sends no token budget to Jev", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue(response)

    await service.ask("jev", request)

    expect(systemOne.mock.calls[0][0]).not.toHaveProperty("max_len")
  })

  test("leaves the budget to Laya when the caller names none", async () => {
    const { service, systemOne } = setup({ status: "ready", backend: layaBackend })
    systemOne.mockResolvedValue(response)

    await service.ask("laya", request)

    expect(systemOne.mock.calls[0][0]).not.toHaveProperty("max_len")
  })

  test("lets the caller trade latency for a longer state", async () => {
    const { service, systemOne } = setup({ status: "ready", backend: layaBackend })
    systemOne.mockResolvedValue(response)

    await service.ask("laya", request, { maxLen: 8192 })

    expect(systemOne.mock.calls[0][0]).toEqual({ ...request, max_len: 8192 })
  })

  test("ignores a token budget for an engine that sizes its own context", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue(response)

    await service.ask("jev", request, { maxLen: 1024 })

    expect(systemOne.mock.calls[0][0]).not.toHaveProperty("max_len")
  })

  test("holds a token budget to the range the engine accepts", async () => {
    const { service, systemOne } = setup({ status: "ready", backend: layaBackend })
    const expected = {
      status: "failed",
      reason: "invalid-request",
      message: "Laya token budget must be a whole number between 256 and 8,192."
    }

    await expect(service.ask("laya", request, { maxLen: 0 })).resolves.toMatchObject(expected)
    await expect(service.ask("laya", request, { maxLen: 9000 })).resolves.toMatchObject(expected)
    expect(systemOne).not.toHaveBeenCalled()
  })

  test("reports truncation so a silently shortened state is visible", async () => {
    const { service, systemOne } = setup({ status: "ready", backend: layaBackend })
    systemOne.mockResolvedValue({
      ...response,
      usage: {
        input_tokens: 8200,
        output_tokens: 0,
        state_tokens: 9633,
        state_tokens_dropped: 1475,
        truncated: true
      }
    })

    const result = await service.ask("laya", request)

    expect(result).toMatchObject({
      status: "success",
      response: {
        usage: {
          inputTokens: 8200,
          outputTokens: 0,
          stateTokens: 9633,
          stateTokensDropped: 1475,
          truncated: true
        }
      }
    })
  })

  test("lazily reuses a client for the same backend", async () => {
    const { service, systemOne, createClient } = setup()
    systemOne.mockResolvedValue(response)

    await service.ask("jev", request)
    await service.ask("jev", request)

    expect(createClient).toHaveBeenCalledTimes(1)
    expect(systemOne).toHaveBeenCalledTimes(2)
  })

  test("keeps a client per backend so alternating engines does not rebuild them", async () => {
    let backend = jevBackend
    const systemOne = vi.fn().mockResolvedValue(response)
    const createClient = vi.fn(() => ({ systemOne }))
    const service = new SystemOneService({
      resolveBackend: () => ({ status: "ready", backend }),
      createClient
    })

    await service.ask("jev", request)
    backend = layaBackend
    await service.ask("laya", request)
    backend = jevBackend
    await service.ask("jev", request)

    expect(createClient).toHaveBeenNthCalledWith(1, jevBackend)
    expect(createClient).toHaveBeenNthCalledWith(2, layaBackend)
    expect(createClient).toHaveBeenCalledTimes(2)
  })

  test("does not create a client for an already cancelled request", async () => {
    const { service, createClient } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(service.ask("jev", request, { signal: controller.signal })).resolves.toEqual({
      status: "cancelled",
      message: "The Jev request was cancelled."
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  test("names the active engine in its messages", async () => {
    const { service, systemOne } = setup({ status: "ready", backend: layaBackend })
    systemOne.mockRejectedValue(new APIConnectionError())

    const result = await service.ask("laya", request)

    expect(result).toMatchObject({ status: "failed", reason: "connection" })
    if (result.status === "success") throw new Error("Expected the request to fail")
    expect(result.message).toBe("ABAP FS could not reach Laya.")
  })

  test("rejects invalid requests before calling the SDK", async () => {
    const { service, systemOne } = setup()
    const invalid = {
      state: "source",
      questions: {
        category: {
          type: "choice",
          instructions: "Choose",
          criteria: { only: "One option" }
        }
      }
    }

    const result = await service.ask("jev", invalid as any)

    expect(result).toMatchObject({ status: "failed", reason: "invalid-request" })
    expect(systemOne).not.toHaveBeenCalled()
  })

  test("rejects a malformed SDK response", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue({
      ...response,
      answers: { ...response.answers, relevant: { type: "noul", noul: 2 } }
    })

    await expect(service.ask("jev", request)).resolves.toMatchObject({
      status: "failed",
      reason: "invalid-response",
      retryable: false
    })
  })

  test.each([
    {
      name: "user cancellation",
      error: new APIUserAbortError(),
      expected: { status: "cancelled" }
    },
    {
      name: "authentication",
      error: APIError.fromResponse(401, {}, new Headers()),
      expected: { status: "failed", reason: "authentication", statusCode: 401, retryable: false }
    },
    {
      name: "permission",
      error: APIError.fromResponse(403, {}, new Headers()),
      expected: { status: "failed", reason: "permission", statusCode: 403, retryable: false }
    },
    {
      name: "rate limit",
      error: APIError.fromResponse(429, {}, new Headers({ "retry-after": "2" })),
      expected: {
        status: "failed",
        reason: "rate-limit",
        statusCode: 429,
        retryable: true,
        retryAfterMs: 2000
      }
    },
    {
      name: "timeout",
      error: new APITimeoutError(1000),
      expected: { status: "failed", reason: "timeout", retryable: true }
    },
    {
      name: "connection",
      error: new APIConnectionError(),
      expected: { status: "failed", reason: "connection", retryable: true }
    },
    {
      name: "context limit",
      error: APIError.fromResponse(
        400,
        { detail: { error_type: "max_tokens_exceeded" } },
        new Headers()
      ),
      expected: { status: "failed", reason: "context-limit", statusCode: 400, retryable: false }
    },
    {
      name: "oversized state refused before inference",
      error: APIError.fromResponse(
        413,
        { detail: "state too large (90164 > 50000 chars)" },
        new Headers()
      ),
      expected: { status: "failed", reason: "context-limit", statusCode: 413, retryable: false }
    },
    {
      name: "bad request",
      error: APIError.fromResponse(422, {}, new Headers()),
      expected: { status: "failed", reason: "invalid-request", statusCode: 422, retryable: false }
    },
    {
      name: "service error",
      error: APIError.fromResponse(503, {}, new Headers()),
      expected: { status: "failed", reason: "service", statusCode: 503, retryable: true }
    },
    {
      name: "SDK validation",
      error: new TypeSafeError("invalid"),
      expected: { status: "failed", reason: "invalid-request", retryable: false }
    },
    {
      name: "unexpected error",
      error: new Error("secret details"),
      expected: { status: "failed", reason: "unknown", retryable: false }
    }
  ])("maps $name without exposing raw error details", async ({ error, expected }) => {
    const { service, systemOne } = setup()
    systemOne.mockRejectedValue(error)

    const result = await service.ask("jev", request)

    expect(result).toMatchObject(expected)
    if (result.status === "success") throw new Error("Expected Jev to fail")
    expect(result.message).not.toContain("secret details")
  })

  test.each([
    { engine: "jev" as const, backend: jevBackend, variable: "TYPESAFE_API_KEY" },
    { engine: "laya" as const, backend: layaBackend, variable: "LAYA_API_KEY" }
  ])(
    "points at $variable when $engine rejects the credential",
    async ({ engine, backend, variable }) => {
      const { service, systemOne } = setup({ status: "ready", backend })
      systemOne.mockRejectedValue(APIError.fromResponse(401, {}, new Headers()))

      const result = await service.ask(engine, request)

      if (result.status === "success") throw new Error("Expected the request to fail")
      expect(result.message).toContain(variable)
    }
  )

  test("quotes the server's own reason for an oversized state", async () => {
    const { service, systemOne } = setup({ status: "ready", backend: layaBackend })
    systemOne.mockRejectedValue(
      APIError.fromResponse(413, { detail: "state too large (90164 > 50000 chars)" }, new Headers())
    )

    const result = await service.ask("laya", request)

    if (result.status === "success") throw new Error("Expected the request to fail")
    expect(result.message).toBe("Laya refused the request: state too large (90164 > 50000 chars)")
  })

  test("can recover after a transient failure", async () => {
    const { service, systemOne, createClient } = setup()
    systemOne.mockRejectedValueOnce(new APIConnectionError()).mockResolvedValueOnce(response)

    await expect(service.ask("jev", request)).resolves.toMatchObject({
      status: "failed",
      reason: "connection"
    })
    await expect(service.ask("jev", request)).resolves.toMatchObject({ status: "success" })
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})

describe("per-engine limits", () => {
  const laya = () => setup({ status: "ready", backend: layaBackend })
  const noul = { type: "noul", instructions: "Does it hold?" } as const
  const choice = (count: number) => ({
    type: "choice" as const,
    instructions: "Pick one",
    criteria: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`option${index}`, `Option ${index}`])
    )
  })
  const score = (levels: number) => ({
    type: "score" as const,
    instructions: "Rate",
    criteria: Array.from({ length: levels }, (_, index) => `Level ${index}`) as [
      string,
      string,
      ...string[]
    ]
  })

  test("refuses a state longer than Laya will accept, without a round trip", async () => {
    const { service, systemOne } = laya()

    const result = await service.ask("laya", { state: "x".repeat(50_001), questions: { noul } })

    expect(result).toMatchObject({ status: "failed", reason: "context-limit" })
    if (result.status === "success") throw new Error("Expected the request to fail")
    expect(result.message).toBe("Laya refuses a state over 50,000 characters; this one is 50,001.")
    expect(systemOne).not.toHaveBeenCalled()
  })

  test("measures the serialized state, so an object pays for its own punctuation", async () => {
    const { service, systemOne } = laya()
    systemOne.mockResolvedValue({ ...response, answers: { noul: { type: "noul", noul: 0.5 } } })

    // The same text as a bare string fits; wrapped in an object it serializes to 50,001.
    await service.ask("laya", { state: "x".repeat(49_990), questions: { noul } })
    const wrapped = await service.ask("laya", {
      state: { body: "x".repeat(49_990) },
      questions: { noul }
    })

    expect(systemOne).toHaveBeenCalledTimes(1)
    expect(wrapped).toMatchObject({
      status: "failed",
      reason: "context-limit",
      message: "Laya refuses a state over 50,000 characters; this one is 50,001."
    })
  })

  test("sends Jev a state Laya would refuse, because Jev counts tokens instead", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue({ ...response, answers: { noul: { type: "noul", noul: 0.5 } } })

    await service.ask("jev", { state: "x".repeat(60_000), questions: { noul } })

    expect(systemOne).toHaveBeenCalledTimes(1)
  })

  test("refuses more questions than Laya answers in one request", async () => {
    const { service, systemOne } = laya()
    const questions = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`q${index}`, noul])
    )

    const result = await service.ask("laya", { state: "text", questions })

    expect(result).toMatchObject({
      status: "failed",
      reason: "invalid-request",
      message: "Laya answers at most 64 questions in one request, not 65."
    })
    expect(systemOne).not.toHaveBeenCalled()
  })

  test("refuses more options than Laya allows in one Choice question", async () => {
    const { service } = laya()

    const result = await service.ask("laya", { state: "text", questions: { a: choice(101) } })

    expect(result).toMatchObject({
      status: "failed",
      message: 'Laya accepts at most 100 options in one Choice question, and "a" has 101.'
    })
  })

  test("adds options and score levels up across questions", async () => {
    const { service } = laya()
    const questions = {
      a: choice(100),
      b: choice(100),
      c: choice(100),
      d: choice(100),
      e: choice(100),
      f: score(13)
    }

    const result = await service.ask("laya", { state: "text", questions })

    expect(result).toMatchObject({
      status: "failed",
      message: "Laya accepts at most 512 options and score levels across all questions, not 513."
    })
  })

  test("allows each engine its own number of score levels", async () => {
    const questions = { rating: score(12) }
    const jev = setup()
    const withLaya = setup({ status: "ready", backend: layaBackend })
    withLaya.systemOne.mockResolvedValue({
      ...response,
      answers: {
        rating: {
          type: "score",
          score: 1,
          confidence: 0.5,
          legend: {},
          probabilities: Object.fromEntries(
            questions.rating.criteria.map((_, index) => [String(index), 0])
          )
        }
      }
    })

    await expect(jev.service.ask("jev", { state: "text", questions })).resolves.toMatchObject({
      status: "failed",
      message: 'Jev Score question "rating" needs between 2 and 10 valid levels.'
    })
    await expect(withLaya.service.ask("laya", { state: "text", questions })).resolves.toMatchObject(
      { status: "success" }
    )
  })

  test("refuses a null state for Laya, which requires one, but not for Jev", async () => {
    const withLaya = setup({ status: "ready", backend: layaBackend })
    const jev = setup()
    jev.systemOne.mockResolvedValue({ ...response, answers: { noul: { type: "noul", noul: 0.5 } } })

    await expect(
      withLaya.service.ask("laya", { state: null, questions: { noul } })
    ).resolves.toMatchObject({
      status: "failed",
      reason: "invalid-request",
      message: "Laya needs a state to reason about."
    })
    await expect(
      jev.service.ask("jev", { state: null, questions: { noul } })
    ).resolves.toMatchObject({
      status: "success"
    })
  })
})

describe("engine coverage", () => {
  test("every engine has a label used in messages", async () => {
    const engines: DecisionEngine[] = ["jev", "laya"]
    for (const engine of engines) {
      const backend = engine === "jev" ? jevBackend : layaBackend
      const { service, systemOne } = setup({ status: "ready", backend })
      systemOne.mockRejectedValue(new APITimeoutError(10))
      const result = await service.ask(engine, request)
      if (result.status === "success") throw new Error("Expected the request to fail")
      expect(result.message).toMatch(engine === "jev" ? /^Jev/ : /^Laya/)
    }
  })
})
