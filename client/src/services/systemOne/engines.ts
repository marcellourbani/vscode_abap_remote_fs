/**
 * What the service knows about each engine's restrictions, so every caller is held to the
 * same rules rather than only the ones the playground happens to check.
 *
 * Jev's are the ones the original integration enforced; Laya's are read off the checks its
 * HTTP server runs before inference (`laya/serve.py`), which answer 413 or 400 rather than
 * degrading quietly. An absent field means the engine publishes no limit worth enforcing
 * locally, and the service lets the server have the final word.
 */

import type { DecisionEngine } from "./backend"

/** Laya's ceiling on a per-request budget, from `LAYA_MAX_TOKEN_BUDGET`. */
export const LAYA_MAX_LEN = 8192
const LAYA_MIN_MAX_LEN = 256

export interface EngineLimits {
  readonly engine: DecisionEngine
  /** Name used in every message the service produces. */
  readonly label: string
  /** Variable holding the credential, named when the engine rejects it. */
  readonly apiKeyVariable: string
  /** True when the engine refuses a request with no state at all. */
  readonly requiresState: boolean
  /** Characters of serialized state the engine refuses outright. */
  readonly maxStateChars?: number
  readonly maxQuestions?: number
  readonly maxChoiceOptions?: number
  readonly maxScoreLevels: number
  /** Choice options plus score levels summed across every question in one request. */
  readonly maxTotalOptions?: number
  /**
   * Range the engine accepts for a per-request token budget. Absent when the engine sizes
   * its own context and ignores the field.
   */
  readonly tokenBudget?: { readonly min: number; readonly max: number }
}

const JEV_LIMITS: EngineLimits = {
  engine: "jev",
  label: "Jev",
  apiKeyVariable: "TYPESAFE_API_KEY",
  requiresState: false,
  maxScoreLevels: 10
}

const LAYA_LIMITS: EngineLimits = {
  engine: "laya",
  label: "Laya",
  apiKeyVariable: "LAYA_API_KEY",
  requiresState: true,
  maxStateChars: 50_000,
  maxQuestions: 64,
  maxChoiceOptions: 100,
  maxScoreLevels: 32,
  maxTotalOptions: 512,
  tokenBudget: { min: LAYA_MIN_MAX_LEN, max: LAYA_MAX_LEN }
}

const LIMITS: Readonly<Record<DecisionEngine, EngineLimits>> = {
  jev: JEV_LIMITS,
  laya: LAYA_LIMITS
}

export const engineLimits = (engine: DecisionEngine): EngineLimits => LIMITS[engine]

/**
 * Characters the engine will count, which is the serialized state rather than the object:
 * a string goes through untouched, anything else is measured as JSON.
 *
 * Python's `json.dumps` puts a space after `:` and `,` where `JSON.stringify` does not, so
 * this reads slightly short for an object-heavy state. Short is the safe direction — the
 * server refuses what we let through and its message is surfaced verbatim, whereas
 * over-counting would block a request the engine would have accepted.
 */
export function stateLength(state: unknown): number {
  if (typeof state === "string") return state.length
  return JSON.stringify(state).length
}
