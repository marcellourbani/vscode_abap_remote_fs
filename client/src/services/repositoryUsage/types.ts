export interface InventoryObject {
  pgmid: string
  objectType: string
  objectName: string
  packageName: string
  functionGroup?: string
}

export type InputKind =
  "tadir" | "enlfdir" | "transaction" | "rfc-server" | "rfc-transaction" | "tbtco" | "tbtcp"
export type EvidenceSource = "transaction" | "rfc-server" | "rfc-transaction" | "jobs" | "untyped"
export type Stage = "discovery" | "st03n" | "jobs" | "dependencies"

export interface Observation {
  id: string
  source: EvidenceSource
  keys: string[]
  seeds: string[]
  reason: string
  date?: string
  period?: string
  ambiguous?: string[]
  inputId?: string
}

export interface TransactionMapping {
  transaction: string
  program: string
}
export interface FunctionMapping {
  name: string
  group: string
}
export interface JobProgram {
  program: string
  date?: string
  status?: "S" | "P"
}
export interface JobOptions {
  includeReleasedJobs?: boolean
  includeScheduledJobs?: boolean
}
export interface DependencyEdge {
  caller: string
  dependency: string
  source: string
}
export interface DependencyResult {
  edges: DependencyEdge[]
  errors: string[]
}
export interface UsageRow extends InventoryObject {
  key: string
  status: "used" | "unclear"
  reasons: string[]
  lastObserved?: string
  periods: string[]
}

export interface InputFile {
  id: string
  name: string
  kind: InputKind
  rows: Record<string, string>[]
  period: string
  importedAt: string
  processed?: boolean
  issues: string[]
}

export interface UsageIssue {
  id: string
  stage: string
  source: string
  objectName: string
  objectType: string
  packageName: string
  file: string
  message: string
}

export interface DependencyCheck {
  status: "complete" | "error"
  error?: string
  edgeCount?: number
}

export interface UsageRun {
  stage: Stage
  resuming?: boolean
  status: "idle" | "running" | "paused" | "complete" | "partial" | "failed" | "interrupted"
  completed: number
  total?: number
  activity?: string
  unit?: string
  dependencyProgress?: {
    pass: number
    used: number
    unclear: number
    newlyUsed: number
    cached: number
    failed: number
    history: { pass: number; newlyUsed: number; used: number; unclear: number }[]
  }
  elapsedMs: number
  startedAt?: string
  error?: string
}

export interface UsageAnalysis extends JobOptions {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  revision: number
  connectionId: string
  packages: string[]
  includeSubpackages: boolean
  discoveryMode: "connected" | "upload"
  jobMode: "connected" | "upload"
  jobConnection: string
  periodLabel: string
  inventory: InventoryObject[]
  inputs: InputFile[]
  observations: Observation[]
  transactions: TransactionMapping[]
  functions: FunctionMapping[]
  jobPrograms: JobProgram[]
  jobsCheckpoint?: {
    source: string
    collected: boolean
    mappingsReady: boolean
    completedTransactionPrefixes: string[]
  }
  dependencyCheckpoint?: {
    used: string[]
    frontier: string[]
    pass: number
    attempted?: string[]
    retryKeys?: string[]
    history: NonNullable<UsageRun["dependencyProgress"]>["history"]
  }
  edges: DependencyEdge[]
  checks: Record<string, DependencyCheck>
  completedPackages: string[]
  discoveryPackages?: string[]
  completedFunctionGroups: string[]
  completedFunctionMappings?: string[]
  completedTransactionPrefixes?: string[]
  st03nMappingsReady?: boolean
  dependencyConnectionId: string
  concurrency: number
  jobsFrom: string
  jobsTo: string
  relations?: "available" | "unavailable"
  stages?: Partial<Record<Stage, { status: UsageRun["status"]; elapsedMs: number }>>
  stageIssues?: Partial<Record<Stage, string[]>>
  issues: string[]
  run: UsageRun
}
