import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeError
} from "@typesafe-ai/sdk"
import { JevService, JevServiceDependencies } from "./jevService"

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

function setup(apiKey: string | undefined = "test-key") {
  const systemOne = jest.fn()
  const createClient = jest.fn(() => ({ systemOne }))
  const readApiKey = jest.fn(() => apiKey)
  const service = new JevService({ readApiKey, createClient })
  return { service, systemOne, createClient, readApiKey }
}

describe("JevService", () => {
  test("stays dormant when the API key is missing", async () => {
    const { service, createClient } = setup(" ")

    await expect(service.ask(request)).resolves.toEqual({
      status: "unavailable",
      reason: "missing-api-key",
      message: "Jev is unavailable because TYPESAFE_API_KEY is not set."
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  test("returns typed mixed answers and translates usage", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue(response)

    const result = await service.ask(request, { timeoutMs: 2500, maxRetries: 1 })

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

  test("lazily reuses a client for the same key", async () => {
    const { service, systemOne, createClient } = setup()
    systemOne.mockResolvedValue(response)

    await service.ask(request)
    await service.ask(request)

    expect(createClient).toHaveBeenCalledTimes(1)
    expect(systemOne).toHaveBeenCalledTimes(2)
  })

  test("creates a new client when the API key changes", async () => {
    let apiKey = "first"
    const systemOne = jest.fn().mockResolvedValue(response)
    const dependencies: JevServiceDependencies = {
      readApiKey: () => apiKey,
      createClient: jest.fn(() => ({ systemOne }))
    }
    const service = new JevService(dependencies)

    await service.ask(request)
    apiKey = "second"
    await service.ask(request)

    expect(dependencies.createClient).toHaveBeenNthCalledWith(1, "first")
    expect(dependencies.createClient).toHaveBeenNthCalledWith(2, "second")
  })

  test("does not create a client for an already cancelled request", async () => {
    const { service, createClient } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(service.ask(request, { signal: controller.signal })).resolves.toEqual({
      status: "cancelled",
      message: "The Jev request was cancelled."
    })
    expect(createClient).not.toHaveBeenCalled()
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

    const result = await service.ask(invalid as any)

    expect(result).toMatchObject({ status: "failed", reason: "invalid-request" })
    expect(systemOne).not.toHaveBeenCalled()
  })

  test("rejects a malformed SDK response", async () => {
    const { service, systemOne } = setup()
    systemOne.mockResolvedValue({
      ...response,
      answers: { ...response.answers, relevant: { type: "noul", noul: 2 } }
    })

    await expect(service.ask(request)).resolves.toMatchObject({
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

    const result = await service.ask(request)

    expect(result).toMatchObject(expected)
    if (result.status === "success") throw new Error("Expected Jev to fail")
    expect(result.message).not.toContain("secret details")
  })

  test("can recover after a transient failure", async () => {
    const { service, systemOne, createClient } = setup()
    systemOne.mockRejectedValueOnce(new APIConnectionError()).mockResolvedValueOnce(response)

    await expect(service.ask(request)).resolves.toMatchObject({
      status: "failed",
      reason: "connection"
    })
    await expect(service.ask(request)).resolves.toMatchObject({ status: "success" })
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})
