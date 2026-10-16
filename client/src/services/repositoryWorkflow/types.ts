import type { ClassMethodElement } from "./classMethodOrder"

export const WORKFLOW_SCHEMA_VERSION = 1
export const SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES = ["DEVC"] as const
export const DEFAULT_VERIFICATION_CONCURRENCY = 32
export const MAX_VERIFICATION_CONCURRENCY = 128

export type WorkflowStepId =
  | "criteria"
  | "discovery"
  | "existenceComparison"
  | "sourceSelection"
  | "sourceDownload"
  | "sourceComparison"
  | "assistedApplyPlan"
  | "transportCheck"

export type WorkflowStepStatus =
  | "not-started"
  | "running"
  | "paused"
  | "partial"
  | "complete"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "skipped"

export type WorkflowPauseReason = "explicit-pause" | "panel-closed" | "extension-shutdown"

export type AssistedApplyMode = "manual" | "copilot"

export interface WorkflowSystem {
  connectionId: string
  role: "source" | "target"
}

export interface WorkflowStepState {
  status: WorkflowStepStatus
  completed?: number
  total?: number
  startedAt?: string
  completedAt?: string
  elapsedMs?: number
  checkpoint?: string
  lastError?: string
  pauseReason?: WorkflowPauseReason
}

export interface RepositoryWorkflow {
  schemaVersion: number
  workflowId: string
  folderName: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  source: WorkflowSystem
  target: WorkflowSystem
  currentStep: WorkflowStepId
  runState: "idle" | "running" | "paused" | "partial" | "complete" | "failed" | "interrupted"
  steps: Record<WorkflowStepId, WorkflowStepState>
  assistedApplyMode?: AssistedApplyMode
  copilotAssistedApplyEnabledAt?: string
  lastError?: string
  revision: number
}

export interface RepositoryCriteria {
  schemaVersion: number
  updatedAt: string
  criteriaHash: string
  includeNames: string[]
  excludeNames: string[]
  packages: string[]
  includeSubpackages: boolean
  objectTypes: string[]
  namespaces: string[]
  authors: string[]
  createdFrom?: string
  createdTo?: string
  includeDeleted: boolean
  includeGenerated: boolean
  includeTemporary: boolean
  sourceConcurrency: number
  targetConcurrency: number
  verificationConcurrency?: number
  transportConcurrency?: number
}

export interface RepositoryObjectRecord {
  pgmid: string
  objectType: string
  objectName: string
  packageName: string
  originalSystem: string
  author: string
  component: string
  namespace?: string
  generated: boolean
  deleted: boolean
  classification: "custom" | "standard" | "partner" | "generated" | "uncertain"
  classificationReason: string
  adtType?: string
  adtUri?: string
}

export interface ExistenceComparisonRecord {
  key: string
  source?: RepositoryObjectRecord
  target?: RepositoryObjectRecord
  status: "both" | "source-only" | "target-only" | "error"
  error?: string
}

export const WORKFLOW_STEPS: WorkflowStepId[] = [
  "criteria",
  "discovery",
  "existenceComparison",
  "sourceSelection",
  "sourceDownload",
  "sourceComparison",
  "assistedApplyPlan",
  "transportCheck"
]

export function initialSteps(): Record<WorkflowStepId, WorkflowStepState> {
  return Object.fromEntries(
    WORKFLOW_STEPS.map(step => [step, { status: "not-started" }])
  ) as Record<WorkflowStepId, WorkflowStepState>
}

export function repositoryObjectKey(
  record: Pick<RepositoryObjectRecord, "pgmid" | "objectType" | "objectName">
): string {
  return `${record.pgmid}:${record.objectType}:${record.objectName}`.toUpperCase()
}

export interface SourceSelection {
  schemaVersion: number
  updatedAt: string
  keys: string[]
}

export interface SnapshotFile {
  path: string
  bytes: number
  sha256: string
  normalizedSha256: string
  text: boolean
}

export interface ClassMethodSnapshotMap {
  schemaVersion: 1
  className: string
  connectionId: string
  sourceUri: string
  rawHash: string
  filePath: string
  sourceUrl: string
  elements: ClassMethodElement[]
}

export interface ObjectSnapshotManifest {
  schemaVersion: number
  key: string
  side: "source" | "target"
  connectionId: string
  record: RepositoryObjectRecord
  sourceUri?: string
  adtUrl?: string
  status: "complete" | "partial" | "failed"
  startedAt: string
  completedAt: string
  files: SnapshotFile[]
  aggregateHash: string
  normalizedAggregateHash: string
  formattedFiles: SnapshotFile[]
  formattedAggregateHash?: string
  formattingState?: "pending" | "complete"
  formatterVersion: string
  classMethodMap?: ClassMethodSnapshotMap
  formattingFailures: string[]
  failures: string[]
}

export type SnapshotRepresentation = "raw" | "formatted"

export type ObjectTransportCheckStatus =
  "not-checked" | "locked" | "not-locked" | "no-transport" | "local" | "error"

export interface SourceComparisonRecord {
  key: string
  status: "identical" | "different" | "source-missing" | "target-missing" | "partial" | "error"
  sourceHash?: string
  targetHash?: string
  sourceRawHash?: string
  targetRawHash?: string
  rawIdentical?: boolean
  sourceNormalizedHash?: string
  targetNormalizedHash?: string
  normalizedIdentical?: boolean
  sourceFormattedHash?: string
  targetFormattedHash?: string
  formattedIdentical?: boolean
  added: string[]
  removed: string[]
  changed: string[]
  rawAdded?: string[]
  rawRemoved?: string[]
  rawChanged?: string[]
  formattedAdded?: string[]
  formattedRemoved?: string[]
  formattedChanged?: string[]
  sourceLines?: number
  targetLines?: number
  linesAdded?: number
  linesRemoved?: number
  linesChanged?: number
  rawSourceLines?: number
  rawTargetLines?: number
  rawLinesAdded?: number
  rawLinesRemoved?: number
  rawLinesChanged?: number
  formattedSourceLines?: number
  formattedTargetLines?: number
  formattedLinesAdded?: number
  formattedLinesRemoved?: number
  formattedLinesChanged?: number
  formattedError?: string
  error?: string
}

export interface AssistedApplyPlanItem {
  key: string
  sourceRecord: RepositoryObjectRecord
  targetRecord: RepositoryObjectRecord
  sourceHash: string
  targetHash: string
  relevant: boolean
  eligible: boolean
  blockingReasons: string[]
  transportRequest?: string
  transportCheckStatus?: ObjectTransportCheckStatus
  transportDescription?: string
  transportCheckedAt?: string
  transportCheckError?: string
}

export interface AssistedApplyPlan {
  schemaVersion: number
  createdAt: string
  sourceConnectionId: string
  targetConnectionId: string
  comparisonBasis: SnapshotRepresentation
  items: AssistedApplyPlanItem[]
}

export interface CopilotAssistedApplySelection {
  schemaVersion: number
  updatedAt: string
  keys: string[]
  completedKeys?: string[]
  decisions?: Record<string, CopilotAssistedApplyDecision>
  decisionReasons?: Record<string, string>
}

export type CopilotAssistedApplyDecision = "as-is" | "skip" | "needs-human"

export type AssistedApplyExecutionStage =
  "apply" | "transport" | "save" | "verification" | "activation" | "completion"

export type AssistedApplyExecutionStatus =
  "started" | "succeeded" | "failed" | "partial" | "timed-out" | "cancelled"

export interface AssistedApplyExecutionEvent {
  schemaVersion: number
  eventId: string
  attemptId: string
  workflowId: string
  objectKey: string
  timestamp: string
  stage: AssistedApplyExecutionStage
  status: AssistedApplyExecutionStatus
  resourcePath?: string
  intentId?: string
  transportChoiceType?: "existing" | "new" | "local"
  transportRequest?: string
  sourceHash?: string
  targetHash?: string
  inactiveSourceVerified?: boolean
  activationObjectUrls?: string[]
  error?: string
}

export interface AssistedApplyExecutionSummary {
  objectKey: string
  attemptCount: number
  eventCount: number
  lastAttemptId: string
  lastStage: AssistedApplyExecutionStage
  lastStatus: AssistedApplyExecutionStatus
  lastUpdatedAt: string
  transportRequest?: string
  lastError?: string
}

export function defaultRepositoryCriteria(
  concurrency = 5
): Omit<RepositoryCriteria, "criteriaHash"> {
  const bounded = Math.min(10, Math.max(1, concurrency))
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    includeNames: [],
    excludeNames: [],
    packages: ["Z*", "Y*"],
    includeSubpackages: false,
    objectTypes: [],
    namespaces: [],
    authors: [],
    includeDeleted: false,
    includeGenerated: false,
    includeTemporary: false,
    sourceConcurrency: bounded,
    targetConcurrency: bounded,
    verificationConcurrency: DEFAULT_VERIFICATION_CONCURRENCY,
    transportConcurrency: bounded
  }
}
