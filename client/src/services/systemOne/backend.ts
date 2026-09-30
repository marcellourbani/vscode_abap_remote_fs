/**
 * Resolves which decision engine ABAP FS talks to, from environment variables only.
 *
 * `TYPESAFE_API_KEY` enables Jev, which honours `TYPESAFE_BASE_URL` the way the SDK does.
 * `LAYA_BASE_URL` enables a self-hosted Laya server, which speaks the same
 * `POST /v1/systemone` protocol. The two engines read separate variables, so configuring
 * one never redirects the other, and both can be configured at once: each gets its own
 * command and panel.
 */

export type DecisionEngine = "jev" | "laya"

/** Used when `TYPESAFE_BASE_URL` is unset, matching the SDK's own default. */
const JEV_BASE_URL = "https://api.typesafe.ai"
const JEV_DEFAULT_MODEL = "jev-latest"

/**
 * The published id that asks Laya's router to pick a checkpoint per request. A checkpoint
 * name such as `english` would pin one instead and defeat language routing.
 */
const LAYA_ROUTED_MODEL = "convaiinnovations/laya"

/** The SDK requires a key. Laya only checks one when the operator sets `LAYA_API_KEY`. */
const LAYA_UNUSED_KEY = "laya-local-no-auth"

export interface DecisionBackend {
  readonly engine: DecisionEngine
  readonly baseUrl: string
  readonly apiKey: string
  readonly defaultModel: string
}

export interface DecisionEnvironment {
  readonly typesafeApiKey?: string
  readonly typesafeBaseUrl?: string
  readonly layaBaseUrl?: string
  readonly layaApiKey?: string
}

export type BackendResolution =
  | { readonly status: "ready"; readonly backend: DecisionBackend }
  | { readonly status: "unconfigured"; readonly engine: DecisionEngine; readonly message: string }
  | { readonly status: "invalid"; readonly engine: DecisionEngine; readonly message: string }

const trimmed = (value: string | undefined): string | undefined => {
  const result = value?.trim()
  return result ? result : undefined
}

export function readEnvironment(
  env: Record<string, string | undefined> = process.env
): DecisionEnvironment {
  return {
    typesafeApiKey: trimmed(env.TYPESAFE_API_KEY),
    typesafeBaseUrl: trimmed(env.TYPESAFE_BASE_URL),
    layaBaseUrl: trimmed(env.LAYA_BASE_URL),
    layaApiKey: trimmed(env.LAYA_API_KEY)
  }
}

/** Engines the user has configured. Drives the `when` clause on each command. */
export function availableEngines(environment: DecisionEnvironment): DecisionEngine[] {
  const engines: DecisionEngine[] = []
  if (environment.typesafeApiKey) engines.push("jev")
  if (environment.layaBaseUrl) engines.push("laya")
  return engines
}

export function resolveBackend(
  engine: DecisionEngine,
  environment: DecisionEnvironment
): BackendResolution {
  if (engine === "jev") return resolveJev(environment)
  return resolveLaya(environment)
}

function resolveJev(environment: DecisionEnvironment): BackendResolution {
  if (!environment.typesafeApiKey)
    return {
      status: "unconfigured",
      engine: "jev",
      message: "Jev is unavailable because TYPESAFE_API_KEY is not set."
    }
  const override = environment.typesafeBaseUrl
  const invalid = override && baseUrlError("TYPESAFE_BASE_URL", override)
  if (invalid) return { status: "invalid", engine: "jev", message: invalid }
  return {
    status: "ready",
    backend: {
      engine: "jev",
      baseUrl: override ? stripTrailingSlashes(override) : JEV_BASE_URL,
      apiKey: environment.typesafeApiKey,
      defaultModel: JEV_DEFAULT_MODEL
    }
  }
}

function resolveLaya(environment: DecisionEnvironment): BackendResolution {
  const baseUrl = environment.layaBaseUrl
  if (!baseUrl)
    return {
      status: "unconfigured",
      engine: "laya",
      message: "Laya is unavailable because LAYA_BASE_URL is not set."
    }
  const invalid = baseUrlError("LAYA_BASE_URL", baseUrl)
  if (invalid) return { status: "invalid", engine: "laya", message: invalid }
  return {
    status: "ready",
    backend: {
      engine: "laya",
      baseUrl: stripTrailingSlashes(baseUrl),
      apiKey: environment.layaApiKey ?? LAYA_UNUSED_KEY,
      defaultModel: LAYA_ROUTED_MODEL
    }
  }
}

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, "")

function baseUrlError(variable: string, value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `${variable} is not a valid URL: ${value}`
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return `${variable} must use http or https, not ${url.protocol.replace(":", "")}.`
  return undefined
}
