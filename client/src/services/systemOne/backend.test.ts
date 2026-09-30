import { availableEngines, readEnvironment, resolveBackend } from "./backend"

describe("readEnvironment", () => {
  it("reads the four supported variables and ignores blank values", () => {
    expect(
      readEnvironment({
        TYPESAFE_API_KEY: " key ",
        TYPESAFE_BASE_URL: "   ",
        LAYA_BASE_URL: "http://127.0.0.1:8000",
        LAYA_API_KEY: "secret"
      })
    ).toEqual({
      typesafeApiKey: "key",
      typesafeBaseUrl: undefined,
      layaBaseUrl: "http://127.0.0.1:8000",
      layaApiKey: "secret"
    })
  })
})

describe("availableEngines", () => {
  it("reports nothing when neither engine is configured", () => {
    expect(availableEngines(readEnvironment({}))).toEqual([])
  })

  it("keys jev off the API key and laya off its own base URL", () => {
    expect(availableEngines(readEnvironment({ TYPESAFE_API_KEY: "key" }))).toEqual(["jev"])
    expect(availableEngines(readEnvironment({ LAYA_BASE_URL: "http://127.0.0.1:8000" }))).toEqual([
      "laya"
    ])
  })

  it("does not enable laya just because TYPESAFE_BASE_URL is set", () => {
    expect(
      availableEngines(readEnvironment({ TYPESAFE_BASE_URL: "https://example.test" }))
    ).toEqual([])
  })

  it("reports both when both are configured, so both commands stay available", () => {
    const environment = readEnvironment({
      TYPESAFE_API_KEY: "key",
      LAYA_BASE_URL: "http://127.0.0.1:8000"
    })
    expect(availableEngines(environment)).toEqual(["jev", "laya"])
  })
})

describe("resolveBackend for jev", () => {
  it("defaults to the hosted API", () => {
    expect(resolveBackend("jev", readEnvironment({ TYPESAFE_API_KEY: "key" }))).toEqual({
      status: "ready",
      backend: {
        engine: "jev",
        baseUrl: "https://api.typesafe.ai",
        apiKey: "key",
        defaultModel: "jev-latest"
      }
    })
  })

  it("honours TYPESAFE_BASE_URL as the SDK does", () => {
    const environment = readEnvironment({
      TYPESAFE_API_KEY: "key",
      TYPESAFE_BASE_URL: "https://typesafe.internal.test/"
    })
    const resolution = resolveBackend("jev", environment)
    expect(resolution.status === "ready" && resolution.backend.baseUrl).toBe(
      "https://typesafe.internal.test"
    )
  })

  it("is unaffected by a Laya base URL", () => {
    const environment = readEnvironment({
      TYPESAFE_API_KEY: "key",
      LAYA_BASE_URL: "http://127.0.0.1:8000"
    })
    const resolution = resolveBackend("jev", environment)
    expect(resolution.status === "ready" && resolution.backend.baseUrl).toBe(
      "https://api.typesafe.ai"
    )
  })

  it("is unconfigured without an API key", () => {
    expect(resolveBackend("jev", readEnvironment({}))).toEqual({
      status: "unconfigured",
      engine: "jev",
      message: "Jev is unavailable because TYPESAFE_API_KEY is not set."
    })
  })

  it("reports an unusable TYPESAFE_BASE_URL", () => {
    const environment = readEnvironment({
      TYPESAFE_API_KEY: "key",
      TYPESAFE_BASE_URL: "api.typesafe.ai"
    })
    expect(resolveBackend("jev", environment)).toEqual({
      status: "invalid",
      engine: "jev",
      message: "TYPESAFE_BASE_URL is not a valid URL: api.typesafe.ai"
    })
  })
})

describe("resolveBackend for laya", () => {
  it("asks the router to choose a checkpoint rather than pinning one", () => {
    expect(
      resolveBackend("laya", readEnvironment({ LAYA_BASE_URL: "http://127.0.0.1:8000" }))
    ).toEqual({
      status: "ready",
      backend: {
        engine: "laya",
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "laya-local-no-auth",
        defaultModel: "convaiinnovations/laya"
      }
    })
  })

  it("forwards LAYA_API_KEY when the server requires a bearer token", () => {
    const resolution = resolveBackend(
      "laya",
      readEnvironment({ LAYA_BASE_URL: "http://127.0.0.1:8000", LAYA_API_KEY: "bearer" })
    )
    expect(resolution.status === "ready" && resolution.backend.apiKey).toBe("bearer")
  })

  it("never borrows the TypeSafe API key", () => {
    const resolution = resolveBackend(
      "laya",
      readEnvironment({ LAYA_BASE_URL: "http://127.0.0.1:8000", TYPESAFE_API_KEY: "key" })
    )
    expect(resolution.status === "ready" && resolution.backend.apiKey).toBe("laya-local-no-auth")
  })

  it("strips trailing slashes from the base URL", () => {
    const resolution = resolveBackend(
      "laya",
      readEnvironment({ LAYA_BASE_URL: "http://127.0.0.1:8000///" })
    )
    expect(resolution.status === "ready" && resolution.backend.baseUrl).toBe(
      "http://127.0.0.1:8000"
    )
  })

  it("is unconfigured without a base URL", () => {
    expect(resolveBackend("laya", readEnvironment({}))).toEqual({
      status: "unconfigured",
      engine: "laya",
      message: "Laya is unavailable because LAYA_BASE_URL is not set."
    })
  })

  it("reports an unparsable base URL instead of failing later in the SDK", () => {
    expect(resolveBackend("laya", readEnvironment({ LAYA_BASE_URL: "127.0.0.1:8000" }))).toEqual({
      status: "invalid",
      engine: "laya",
      message: "LAYA_BASE_URL is not a valid URL: 127.0.0.1:8000"
    })
  })

  it("rejects a non-http scheme", () => {
    expect(
      resolveBackend("laya", readEnvironment({ LAYA_BASE_URL: "ftp://127.0.0.1:8000" }))
    ).toEqual({
      status: "invalid",
      engine: "laya",
      message: "LAYA_BASE_URL must use http or https, not ftp."
    })
  })
})
