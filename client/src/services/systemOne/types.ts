export type SystemOneJsonValue =
  string | number | boolean | null | SystemOneJsonValue[] | { [key: string]: SystemOneJsonValue }

export type SystemOneEntry =
  string | SystemOneJsonValue[] | { [key: string]: SystemOneJsonValue } | null
export type SystemOneInstruction = Exclude<SystemOneEntry, null>
export type SystemOneDescription = SystemOneEntry

export interface SystemOneNoulQuestion {
  readonly type: "noul"
  readonly instructions: SystemOneInstruction
  readonly criteria?: {
    readonly true?: SystemOneDescription
    readonly false?: SystemOneDescription
  }
}

export type SystemOneChoiceCriteria = Readonly<Record<string, SystemOneDescription>>

export interface SystemOneChoiceQuestion<
  Criteria extends SystemOneChoiceCriteria = SystemOneChoiceCriteria
> {
  readonly type: "choice"
  readonly instructions: SystemOneInstruction
  readonly criteria: Criteria
}

export type SystemOneScoreCriteria = readonly [
  SystemOneDescription,
  SystemOneDescription,
  ...SystemOneDescription[]
]

export interface SystemOneScoreQuestion<
  Criteria extends SystemOneScoreCriteria = SystemOneScoreCriteria
> {
  readonly type: "score"
  readonly instructions: SystemOneInstruction
  readonly criteria: Criteria
}

export type SystemOneQuestion =
  SystemOneNoulQuestion | SystemOneChoiceQuestion | SystemOneScoreQuestion

export type SystemOneQuestions = Readonly<Record<string, SystemOneQuestion>>

export interface SystemOneRequest<Questions extends SystemOneQuestions = SystemOneQuestions> {
  readonly state: SystemOneEntry
  readonly questions: Questions
  readonly model?: string
}

export interface SystemOneNoulAnswer {
  readonly type: "noul"
  readonly noul: number
}

export interface SystemOneChoiceAnswer<
  Criteria extends SystemOneChoiceCriteria = SystemOneChoiceCriteria
> {
  readonly type: "choice"
  readonly choice: keyof Criteria & string
  readonly confidence: number
  readonly probabilities: { readonly [Key in keyof Criteria]: number }
}

export interface SystemOneScoreAnswer {
  readonly type: "score"
  readonly score: number
  readonly confidence: number
  readonly legend: Readonly<Record<string, SystemOneDescription>>
  readonly probabilities: Readonly<Record<string, number>>
}

export type SystemOneAnswerFor<Question extends SystemOneQuestion> =
  Question extends SystemOneNoulQuestion
    ? SystemOneNoulAnswer
    : Question extends SystemOneChoiceQuestion<infer Criteria>
      ? SystemOneChoiceAnswer<Criteria>
      : Question extends SystemOneScoreQuestion
        ? SystemOneScoreAnswer
        : never

export interface SystemOneUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  /** Tokens the state occupied, when the service reports it. */
  readonly stateTokens?: number
  /** Tokens of state the model never read because the budget was exhausted. */
  readonly stateTokensDropped?: number
  /** True when part of the state was cut before inference. */
  readonly truncated?: boolean
}

export interface SystemOneResponse<Questions extends SystemOneQuestions = SystemOneQuestions> {
  readonly model: string
  readonly answers: {
    readonly [Key in keyof Questions]: SystemOneAnswerFor<Questions[Key]>
  }
  readonly usage: SystemOneUsage
}

export interface SystemOneAskOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxRetries?: number
  /**
   * How many tokens of state the engine should read. Left unset, the engine applies its own
   * budget; an engine that sizes its own context ignores this entirely.
   */
  readonly maxLen?: number
}

export type SystemOneFailureReason =
  | "invalid-request"
  | "context-limit"
  | "authentication"
  | "permission"
  | "rate-limit"
  | "timeout"
  | "connection"
  | "service"
  | "invalid-response"
  | "unknown"

export type SystemOneOutcome<Questions extends SystemOneQuestions = SystemOneQuestions> =
  | {
      readonly status: "success"
      readonly response: SystemOneResponse<Questions>
    }
  | {
      readonly status: "unavailable"
      readonly reason: "not-configured" | "invalid-configuration"
      readonly message: string
    }
  | {
      readonly status: "cancelled"
      readonly message: string
    }
  | {
      readonly status: "failed"
      readonly reason: SystemOneFailureReason
      readonly message: string
      readonly retryable: boolean
      readonly statusCode?: number
      readonly requestId?: string
      readonly retryAfterMs?: number
    }
