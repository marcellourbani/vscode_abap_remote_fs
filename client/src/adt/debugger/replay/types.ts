import { DebugMetaType } from "abap-adt-api"

/** A single captured variable value */
export interface CapturedVariable {
  id: string
  name: string
  value: string
  type: string
  metaType: DebugMetaType
  tableLines?: number
  children?: CapturedVariable[]
  /** true when table was too large and user chose to skip */
  skipped?: boolean
  /** message explaining why capture was incomplete */
  skipReason?: string
}

/** A named scope with its captured variables */
export interface CapturedScope {
  name: string
  variables: CapturedVariable[]
}

/** A single stack frame in a snapshot */
export interface CapturedStackFrame {
  name: string
  sourcePath: string
  /** Original ADT URI for source caching */
  adtUri: string
  line: number
  stackPosition: number
}

/** One recorded debug stop point */
export interface DebugSnapshot {
  stepNumber: number
  timestamp: number
  threadId: number
  stack: CapturedStackFrame[]
  scopes: CapturedScope[]
  changedVars: string[]
}

/** The full recording file */
export interface DebugRecording {
  version: 1
  recordedAt: string
  connectionId: string
  objectName?: string
  debugUser?: string
  totalSteps: number
  duration: number
  snapshots: DebugSnapshot[]
  /** uri -> full source text for offline replay */
  sources?: Record<string, string>
}

/** Options controlling how variables are captured */
export interface CaptureOptions {
  /** Max table rows to auto-capture without prompting (default 10000) */
  tableRowThreshold: number
  /** Max steps before recording stops (default 5000) */
  maxSteps: number
  /** Max expansion depth for structures/tables (default 4) */
  maxDepth: number
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  tableRowThreshold: 10000,
  maxSteps: 5000,
  maxDepth: 4
}

export const REPLAY_DEBUG_TYPE = "abap-replay"
