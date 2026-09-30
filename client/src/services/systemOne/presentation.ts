/**
 * Webview copy and UI-only settings for each engine. Nothing here constrains a request:
 * the limits the engines actually enforce live in `engines.ts` and are applied by the
 * service, so a feature that never opens a panel is held to the same rules.
 */

import type { DecisionEngine } from "./backend"

export interface EnginePresentation {
  readonly engine: DecisionEngine
  readonly commandId: string
  /** Distinct per engine so both panels can be open at the same time. */
  readonly viewType: string
  readonly defaultTimeoutMs: number
  readonly maxTimeoutMs: number
  /** Expanded state size at which the panel warns, short of any enforced limit. */
  readonly stateWarningChars: number
  readonly modelPlaceholder: string
  /** Shown under the model field when the accepted values are worth spelling out. */
  readonly modelHint?: string
  /** Where the state, question and attachments go when the request is sent. */
  readonly dataNotice: string
  /** Shown under the token budget field, for engines that read one. */
  readonly tokenBudgetHint?: string
}

const JEV_PRESENTATION: EnginePresentation = {
  engine: "jev",
  commandId: "abapfs.askJev",
  viewType: "abapfs.askJev",
  defaultTimeoutMs: 10_000,
  maxTimeoutMs: 120_000,
  stateWarningChars: 80_000,
  modelPlaceholder: "jev-latest",
  dataNotice:
    "Your state, question, options or criteria, selected model, and attachment contents are sent to TypeSafe when you click Ask Jev."
}

/** CPU inference on a long state can take over a minute, hence the higher timeouts. */
const LAYA_PRESENTATION: EnginePresentation = {
  engine: "laya",
  commandId: "abapfs.askLaya",
  viewType: "abapfs.askLaya",
  defaultTimeoutMs: 60_000,
  maxTimeoutMs: 300_000,
  stateWarningChars: 40_000,
  modelPlaceholder: "english",
  modelHint:
    "Leave empty to let Laya route by language, or name english, multilingual or typed-decisions.",
  dataNotice:
    "Your state, question, options or criteria, selected model, and attachment contents are sent to the Laya server you configured.",
  tokenBudgetHint:
    "Tokens of state the model reads. Leave empty for the checkpoint default. Raising it reads more of a long state and takes longer."
}

const PRESENTATION: Readonly<Record<DecisionEngine, EnginePresentation>> = {
  jev: JEV_PRESENTATION,
  laya: LAYA_PRESENTATION
}

export const enginePresentation = (engine: DecisionEngine): EnginePresentation =>
  PRESENTATION[engine]
