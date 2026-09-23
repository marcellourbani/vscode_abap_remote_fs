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
  runState: "idle" | "running" | "paused" | "complete" | "failed" | "interrupted"
  steps: Record<WorkflowStepId, WorkflowStepState>
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
  "assistedApplyPlan"
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

export interface ObjectSnapshotManifest {
  schemaVersion: number
  key: string
  side: "source" | "target"
  connectionId: string
  record: RepositoryObjectRecord
  sourceUri?: string
  status: "complete" | "partial" | "failed"
  startedAt: string
  completedAt: string
  files: SnapshotFile[]
  aggregateHash: string
  normalizedAggregateHash: string
  failures: string[]
}

export interface SourceComparisonRecord {
  key: string
  status: "identical" | "different" | "source-missing" | "target-missing" | "partial" | "error"
  sourceHash?: string
  targetHash?: string
  sourceNormalizedHash?: string
  targetNormalizedHash?: string
  normalizedIdentical?: boolean
  added: string[]
  removed: string[]
  changed: string[]
  linesAdded?: number
  linesRemoved?: number
  linesChanged?: number
  error?: string
}

export interface AssistedApplyPlanItem {
  key: string
  sourceRecord: RepositoryObjectRecord
  targetRecord: RepositoryObjectRecord
  sourceHash: string
  targetHash: string
  eligible: boolean
  blockingReasons: string[]
}

export interface AssistedApplyPlan {
  schemaVersion: number
  createdAt: string
  sourceConnectionId: string
  targetConnectionId: string
  items: AssistedApplyPlanItem[]
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
    verificationConcurrency: DEFAULT_VERIFICATION_CONCURRENCY
  }
}
