export type JevJsonValue =
  | string
  | number
  | boolean
  | null
  | JevJsonValue[]
  | { [key: string]: JevJsonValue }

export type JevEntry = string | JevJsonValue[] | { [key: string]: JevJsonValue } | null
export type JevInstruction = Exclude<JevEntry, null>
export type JevDescription = JevEntry

export interface JevNoulQuestion {
  readonly type: "noul"
  readonly instructions: JevInstruction
  readonly criteria?: {
    readonly true?: JevDescription
    readonly false?: JevDescription
  }
}

export type JevChoiceCriteria = Readonly<Record<string, JevDescription>>

export interface JevChoiceQuestion<Criteria extends JevChoiceCriteria = JevChoiceCriteria> {
  readonly type: "choice"
  readonly instructions: JevInstruction
  readonly criteria: Criteria
}

export type JevScoreCriteria = readonly [JevDescription, JevDescription, ...JevDescription[]]

export interface JevScoreQuestion<Criteria extends JevScoreCriteria = JevScoreCriteria> {
  readonly type: "score"
  readonly instructions: JevInstruction
  readonly criteria: Criteria
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion

export type JevQuestions = Readonly<Record<string, JevQuestion>>

export interface JevRequest<Questions extends JevQuestions = JevQuestions> {
  readonly state: JevEntry
  readonly questions: Questions
  readonly model?: string
}

export interface JevNoulAnswer {
  readonly type: "noul"
  readonly noul: number
}

export interface JevChoiceAnswer<Criteria extends JevChoiceCriteria = JevChoiceCriteria> {
  readonly type: "choice"
  readonly choice: keyof Criteria & string
  readonly confidence: number
  readonly probabilities: { readonly [Key in keyof Criteria]: number }
}

export interface JevScoreAnswer {
  readonly type: "score"
  readonly score: number
  readonly confidence: number
  readonly legend: Readonly<Record<string, JevDescription>>
  readonly probabilities: Readonly<Record<string, number>>
}

export type JevAnswerFor<Question extends JevQuestion> = Question extends JevNoulQuestion
  ? JevNoulAnswer
  : Question extends JevChoiceQuestion<infer Criteria>
    ? JevChoiceAnswer<Criteria>
    : Question extends JevScoreQuestion
      ? JevScoreAnswer
      : never

export interface JevResponse<Questions extends JevQuestions = JevQuestions> {
  readonly model: string
  readonly answers: {
    readonly [Key in keyof Questions]: JevAnswerFor<Questions[Key]>
  }
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export interface JevAskOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxRetries?: number
}

export type JevFailureReason =
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

export type JevOutcome<Questions extends JevQuestions = JevQuestions> =
  | {
      readonly status: "success"
      readonly response: JevResponse<Questions>
    }
  | {
      readonly status: "unavailable"
      readonly reason: "missing-api-key"
      readonly message: string
    }
  | {
      readonly status: "cancelled"
      readonly message: string
    }
  | {
      readonly status: "failed"
      readonly reason: JevFailureReason
      readonly message: string
      readonly retryable: boolean
      readonly statusCode?: number
      readonly requestId?: string
      readonly retryAfterMs?: number
    }
