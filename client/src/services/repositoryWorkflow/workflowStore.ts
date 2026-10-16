import * as vscode from "vscode"
import * as fs from "fs/promises"
import { createReadStream } from "fs"
import { createInterface } from "readline"
import * as os from "os"
import * as path from "path"
import { randomUUID, createHash } from "crypto"
import {
  type AssistedApplyMode,
  type AssistedApplyExecutionEvent,
  type AssistedApplyExecutionStage,
  type AssistedApplyExecutionStatus,
  type AssistedApplyExecutionSummary,
  type AssistedApplyPlan,
  type AssistedApplyPlanItem,
  type CopilotAssistedApplySelection,
  type CopilotAssistedApplyDecision,
  DEFAULT_VERIFICATION_CONCURRENCY,
  initialSteps,
  MAX_VERIFICATION_CONCURRENCY,
  type RepositoryCriteria,
  type RepositoryWorkflow,
  defaultRepositoryCriteria,
  WORKFLOW_SCHEMA_VERSION
} from "./types"

const WORKFLOW_FILE = "workflow.json"
const CRITERIA_FILE = "criteria.json"
const SNAPSHOT_DELETE_BATCH_SIZE = 32
const EXECUTION_HISTORY_PATH = ["history", "assisted-apply-execution.jsonl"]

function sanitizeName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
  return sanitized || "repository_workflow"
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8")
  await replaceFile(temporaryPath, filePath)
}

async function replaceFile(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, target)
      return
    } catch (error: any) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt === 4) throw error
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt))
    }
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T
}

export function defaultWorkflowName(source: string, target: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "_").replace(/\..+$/, "")
  return `${source.toUpperCase()}_${target.toUpperCase()}_${timestamp}`
}

export class WorkflowStore {
  private readonly updateQueues = new Map<string, Promise<RepositoryWorkflow>>()
  private readonly executionQueues = new Map<string, Promise<void>>()
  private readonly selectionQueues = new Map<string, Promise<unknown>>()
  private readonly sessionId = randomUUID()

  constructor(private readonly context: vscode.ExtensionContext) {}

  get rootPath(): string {
    const configured = vscode.workspace
      .getConfiguration("abapfs.repositoryWorkflows")
      .get<string>("root", "")
      .trim()
    return configured || path.join(os.homedir(), ".abapfs", "repository-workflows")
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true })
    const workflows = await this.list()
    for (const workflow of workflows) {
      const lockPath = this.artifactPath(workflow, "run.lock")
      if (await liveRunLock(lockPath, this.sessionId)) continue
      await fs.rm(lockPath, { force: true })
      if (workflow.runState !== "running") continue
      await this.update(workflow.workflowId, current => ({
        ...current,
        runState: "interrupted",
        steps: Object.fromEntries(
          Object.entries(current.steps).map(([key, step]) => [
            key,
            step.status === "running" ? { ...step, status: "interrupted" } : step
          ])
        ) as RepositoryWorkflow["steps"]
      }))
    }
  }

  async create(input: {
    name: string
    description?: string
    sourceConnectionId: string
    targetConnectionId: string
  }): Promise<RepositoryWorkflow> {
    const source = input.sourceConnectionId.toLowerCase()
    const target = input.targetConnectionId.toLowerCase()
    const name = input.name.trim() || defaultWorkflowName(source, target)
    if (!source || !target) throw new Error("Source and target connections are required")
    if (source === target) throw new Error("Source and target connections must be different")

    const workflowId = randomUUID()
    const folderName = `${sanitizeName(name)}--${workflowId.slice(0, 8)}`
    const now = new Date().toISOString()
    const workflow: RepositoryWorkflow = {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      workflowId,
      folderName,
      name,
      description: input.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      source: { connectionId: source, role: "source" },
      target: { connectionId: target, role: "target" },
      currentStep: "criteria",
      runState: "idle",
      steps: initialSteps(),
      revision: 1
    }
    const workflowPath = this.workflowPath(workflow)
    await fs.mkdir(workflowPath, { recursive: false })
    await Promise.all(
      [
        "logs",
        "discovery/source",
        "discovery/target",
        "comparison",
        "sources/source/objects",
        "sources/target/objects",
        "assisted-apply",
        "exports"
      ].map(directory => fs.mkdir(path.join(workflowPath, directory), { recursive: true }))
    )
    await atomicWriteJson(path.join(workflowPath, WORKFLOW_FILE), workflow)
    await this.saveCriteria(workflowId, defaultRepositoryCriteria(this.defaultConcurrency()))
    await this.appendJsonLine(path.join(workflowPath, "events.jsonl"), {
      timestamp: now,
      event: "workflow-created",
      revision: 1
    })
    return await this.get(workflowId)
  }

  async list(): Promise<RepositoryWorkflow[]> {
    await fs.mkdir(this.rootPath, { recursive: true })
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true })
    const workflows = await Promise.all(
      entries
        .filter(entry => entry.isDirectory())
        .map(async entry => {
          try {
            return await readJson<RepositoryWorkflow>(
              path.join(this.rootPath, entry.name, WORKFLOW_FILE)
            )
          } catch {
            return undefined
          }
        })
    )
    return workflows
      .filter((workflow): workflow is RepositoryWorkflow => !!workflow)
      .map(workflow => ({
        ...workflow,
        steps: { ...initialSteps(), ...workflow.steps }
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async get(workflowId: string): Promise<RepositoryWorkflow> {
    const workflow = (await this.list()).find(candidate => candidate.workflowId === workflowId)
    if (!workflow) throw new Error(`Repository workflow not found: ${workflowId}`)
    return workflow
  }

  async update(
    workflowId: string,
    updater: (workflow: RepositoryWorkflow) => RepositoryWorkflow
  ): Promise<RepositoryWorkflow> {
    const previous = this.updateQueues.get(workflowId) ?? this.get(workflowId)
    const pending = previous.then(async current => {
      const updated = updater(current)
      updated.schemaVersion = WORKFLOW_SCHEMA_VERSION
      updated.workflowId = current.workflowId
      updated.folderName = current.folderName
      updated.createdAt = current.createdAt
      updated.updatedAt = new Date().toISOString()
      updated.revision = current.revision + 1
      await atomicWriteJson(path.join(this.workflowPath(current), WORKFLOW_FILE), updated)
      await this.appendJsonLine(this.artifactPath(updated, "events.jsonl"), {
        timestamp: updated.updatedAt,
        event: "workflow-updated",
        revision: updated.revision,
        runState: updated.runState,
        currentStep: updated.currentStep
      })
      await fs.appendFile(
        this.artifactPath(updated, "logs", "workflow.log"),
        `${updated.updatedAt} revision=${updated.revision} state=${updated.runState} step=${updated.currentStep}\n`,
        "utf8"
      )
      return updated
    })
    this.updateQueues.set(workflowId, pending)
    try {
      return await pending
    } finally {
      if (this.updateQueues.get(workflowId) === pending) this.updateQueues.delete(workflowId)
    }
  }

  async delete(workflowId: string): Promise<void> {
    const workflow = await this.get(workflowId)
    const ownerId = `delete:${randomUUID()}`
    await this.acquireRunLock(workflowId, ownerId)
    try {
      await this.waitForUpdates(workflowId)
      await fs.rm(this.workflowPath(workflow), { recursive: true, force: true })
    } catch (error) {
      await this.releaseRunLock(workflowId, ownerId).catch(() => false)
      throw error
    }
  }

  async archive(workflowId: string): Promise<void> {
    const workflow = await this.get(workflowId)
    const ownerId = `archive:${randomUUID()}`
    await this.acquireRunLock(workflowId, ownerId)
    const archiveRoot = path.join(this.rootPath, "archive")
    const archivedPath = path.join(archiveRoot, workflow.folderName)
    try {
      await this.waitForUpdates(workflowId)
      await fs.mkdir(archiveRoot, { recursive: true })
      await fs.rename(this.workflowPath(workflow), archivedPath)
      await fs.rm(path.join(archivedPath, "run.lock"), { force: true }).catch(() => undefined)
    } catch (error) {
      await this.releaseRunLock(workflowId, ownerId).catch(() => false)
      throw error
    }
  }

  async duplicate(workflowId: string): Promise<RepositoryWorkflow> {
    const original = await this.get(workflowId)
    const duplicate = await this.create({
      name: `${original.name}_copy`,
      description: original.description,
      sourceConnectionId: original.source.connectionId,
      targetConnectionId: original.target.connectionId
    })
    const criteria = await this.getCriteria(workflowId)
    if (criteria) {
      const { criteriaHash: _criteriaHash, ...copy } = criteria
      await this.saveCriteria(duplicate.workflowId, {
        ...copy,
        updatedAt: new Date().toISOString()
      })
    }
    return duplicate
  }

  async isRunLocked(workflowId: string): Promise<boolean> {
    const workflow = await this.get(workflowId)
    try {
      await fs.stat(this.artifactPath(workflow, "run.lock"))
      return true
    } catch {
      return false
    }
  }

  async setAssistedApplyMode(
    workflowId: string,
    mode: AssistedApplyMode | undefined
  ): Promise<RepositoryWorkflow> {
    return await this.update(workflowId, current => ({
      ...current,
      assistedApplyMode: mode,
      copilotAssistedApplyEnabledAt:
        mode === "copilot"
          ? (current.copilotAssistedApplyEnabledAt ?? new Date().toISOString())
          : current.copilotAssistedApplyEnabledAt
    }))
  }

  async getCopilotAssistedApplySelection(
    workflowId: string,
    knownWorkflow?: RepositoryWorkflow
  ): Promise<CopilotAssistedApplySelection | undefined> {
    const workflow = knownWorkflow ?? (await this.get(workflowId))
    try {
      return await readJson<CopilotAssistedApplySelection>(
        this.artifactPath(workflow, "assisted-apply", "copilot-selection.json")
      )
    } catch {
      return undefined
    }
  }

  async saveCopilotAssistedApplySelection(
    workflowId: string,
    keys: string[]
  ): Promise<CopilotAssistedApplySelection> {
    return this.withSelectionQueue(workflowId, () => this.saveSelection(workflowId, keys))
  }

  async updateCopilotAssistedApplyStatus(
    workflowId: string,
    keys: string[],
    status: "done" | "pending"
  ): Promise<CopilotAssistedApplySelection> {
    return this.withSelectionQueue(workflowId, () =>
      this.updateSelectionStatus(workflowId, keys, status)
    )
  }

  async updateCopilotAssistedApplyDecision(
    workflowId: string,
    key: string,
    decision: CopilotAssistedApplyDecision,
    reason: string
  ): Promise<CopilotAssistedApplySelection> {
    return this.withSelectionQueue(workflowId, () =>
      this.updateSelectionDecision(workflowId, key, decision, reason)
    )
  }

  async removeCopilotAssistedApplySelection(workflow: RepositoryWorkflow): Promise<void> {
    await this.withSelectionQueue(workflow.workflowId, () =>
      fs.rm(this.artifactPath(workflow, "assisted-apply", "copilot-selection.json"), {
        force: true
      })
    )
  }

  private async withSelectionQueue<T>(workflowId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.selectionQueues.get(workflowId) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(action)
    this.selectionQueues.set(workflowId, pending)
    try {
      return await pending
    } finally {
      if (this.selectionQueues.get(workflowId) === pending) this.selectionQueues.delete(workflowId)
    }
  }

  private async saveSelection(
    workflowId: string,
    keys: string[]
  ): Promise<CopilotAssistedApplySelection> {
    const workflow = await this.get(workflowId)
    if (workflow.assistedApplyMode !== "copilot" || !workflow.copilotAssistedApplyEnabledAt)
      throw new Error("Enable Copilot-assisted apply for this workflow before saving a selection")
    const plan = await readJson<AssistedApplyPlan>(
      this.artifactPath(workflow, "assisted-apply", "plan.json")
    )
    const eligible = new Set(plan.items.filter(item => item.eligible).map(item => item.key))
    const normalized = [
      ...new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean))
    ].sort()
    const invalid = normalized.filter(key => !eligible.has(key))
    if (invalid.length)
      throw new Error(
        `${invalid.length.toLocaleString()} selected object${invalid.length === 1 ? " is" : "s are"} not eligible for assisted apply`
      )
    const previous = await this.getCopilotAssistedApplySelection(workflowId, workflow)
    const selected = new Set(normalized)
    const selection: CopilotAssistedApplySelection = {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      keys: normalized,
      completedKeys: (previous?.completedKeys ?? []).filter(key => selected.has(key)),
      decisions: Object.fromEntries(
        normalized.map(key => [key, previous?.decisions?.[key] ?? "needs-human"])
      ),
      decisionReasons: Object.fromEntries(
        normalized.flatMap(key => {
          const reason = previous?.decisionReasons?.[key]
          return reason ? [[key, reason]] : []
        })
      )
    }
    await atomicWriteJson(
      this.artifactPath(workflow, "assisted-apply", "copilot-selection.json"),
      selection
    )
    await this.update(workflowId, current => current)
    return selection
  }

  private async updateSelectionStatus(
    workflowId: string,
    keys: string[],
    status: "done" | "pending"
  ): Promise<CopilotAssistedApplySelection> {
    const workflow = await this.get(workflowId)
    if (workflow.assistedApplyMode !== "copilot" || !workflow.copilotAssistedApplyEnabledAt)
      throw new Error("Copilot-assisted apply is not enabled for this workflow")
    const selection = await this.getCopilotAssistedApplySelection(workflowId, workflow)
    if (!selection) throw new Error("No Copilot-assisted apply selection has been saved")
    const normalized = [...new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean))]
    if (!normalized.length) throw new Error("At least one selected object key is required")
    const selected = new Set(selection.keys)
    const invalid = normalized.filter(key => !selected.has(key))
    if (invalid.length)
      throw new Error(
        `${invalid.length.toLocaleString()} object${invalid.length === 1 ? " is" : "s are"} not in the user-saved Copilot-assisted apply selection`
      )
    const completed = new Set(selection.completedKeys ?? [])
    for (const key of normalized) {
      if (status === "done") completed.add(key)
      else completed.delete(key)
    }
    const updated: CopilotAssistedApplySelection = {
      ...selection,
      updatedAt: new Date().toISOString(),
      completedKeys: selection.keys.filter(key => completed.has(key))
    }
    await atomicWriteJson(
      this.artifactPath(workflow, "assisted-apply", "copilot-selection.json"),
      updated
    )
    await this.update(workflowId, current => current)
    return updated
  }

  private async updateSelectionDecision(
    workflowId: string,
    key: string,
    decision: CopilotAssistedApplyDecision,
    reason: string
  ): Promise<CopilotAssistedApplySelection> {
    if (!["as-is", "skip", "needs-human"].includes(decision))
      throw new Error(`Unsupported Copilot-assisted apply decision: ${decision}`)
    const workflow = await this.get(workflowId)
    if (workflow.assistedApplyMode !== "copilot" || !workflow.copilotAssistedApplyEnabledAt)
      throw new Error("Copilot-assisted apply is not enabled for this workflow")
    const selection = await this.getCopilotAssistedApplySelection(workflowId, workflow)
    if (!selection) throw new Error("No Copilot-assisted apply selection has been saved")
    const normalized = key.trim().toUpperCase()
    if (!normalized) throw new Error("One selected object key is required")
    const normalizedReason = reason.trim()
    if (!normalizedReason) throw new Error("A decision reason is required")
    if (normalizedReason.length > 2000)
      throw new Error("Decision reason cannot exceed 2,000 characters")
    if (!selection.keys.includes(normalized))
      throw new Error(`${normalized} is not in the user-saved Copilot-assisted apply selection`)
    const updated: CopilotAssistedApplySelection = {
      ...selection,
      updatedAt: new Date().toISOString(),
      decisions: {
        ...selection.decisions,
        [normalized]: decision
      },
      decisionReasons: {
        ...selection.decisionReasons,
        [normalized]: normalizedReason
      }
    }
    await atomicWriteJson(
      this.artifactPath(workflow, "assisted-apply", "copilot-selection.json"),
      updated
    )
    await this.update(workflowId, current => current)
    return updated
  }

  async appendAssistedApplyExecutionEvent(
    workflowId: string,
    event: {
      attemptId: string
      objectKey: string
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
  ): Promise<AssistedApplyExecutionEvent> {
    const workflow = await this.get(workflowId)
    const value: AssistedApplyExecutionEvent = {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      eventId: randomUUID(),
      attemptId: event.attemptId,
      workflowId,
      objectKey: event.objectKey.trim().toUpperCase(),
      timestamp: new Date().toISOString(),
      stage: event.stage,
      status: event.status,
      resourcePath: event.resourcePath,
      intentId: event.intentId,
      transportChoiceType: event.transportChoiceType,
      transportRequest: event.transportRequest,
      sourceHash: event.sourceHash,
      targetHash: event.targetHash,
      inactiveSourceVerified: event.inactiveSourceVerified,
      activationObjectUrls: event.activationObjectUrls,
      error: event.error
    }
    const previous = this.executionQueues.get(workflowId) ?? Promise.resolve()
    const pending = previous.then(() =>
      this.appendJsonLine(this.artifactPath(workflow, ...EXECUTION_HISTORY_PATH), value)
    )
    this.executionQueues.set(workflowId, pending)
    try {
      await pending
    } finally {
      if (this.executionQueues.get(workflowId) === pending) this.executionQueues.delete(workflowId)
    }
    return value
  }

  async getAssistedApplyExecutionEvents(
    workflowId: string,
    objectKey?: string
  ): Promise<AssistedApplyExecutionEvent[]> {
    const workflow = await this.get(workflowId)
    const normalizedKey = objectKey?.trim().toUpperCase()
    const events: AssistedApplyExecutionEvent[] = []
    try {
      for await (const event of this.readJsonLines<AssistedApplyExecutionEvent>(
        this.artifactPath(workflow, ...EXECUTION_HISTORY_PATH)
      ))
        if (!normalizedKey || event.objectKey === normalizedKey) events.push(event)
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error
    }
    return events
  }

  async getAssistedApplyExecutionSummaries(
    workflowId: string
  ): Promise<Record<string, AssistedApplyExecutionSummary>> {
    const events = await this.getAssistedApplyExecutionEvents(workflowId)
    const attempts = new Map<string, Set<string>>()
    const summaries: Record<string, AssistedApplyExecutionSummary> = {}
    for (const event of events) {
      const objectAttempts = attempts.get(event.objectKey) ?? new Set<string>()
      objectAttempts.add(event.attemptId)
      attempts.set(event.objectKey, objectAttempts)
      const previous = summaries[event.objectKey]
      const sameAttempt = previous?.lastAttemptId === event.attemptId
      summaries[event.objectKey] = {
        objectKey: event.objectKey,
        attemptCount: objectAttempts.size,
        eventCount: (previous?.eventCount ?? 0) + 1,
        lastAttemptId: event.attemptId,
        lastStage: event.stage,
        lastStatus: event.status,
        lastUpdatedAt: event.timestamp,
        transportRequest:
          event.transportRequest || (sameAttempt ? previous?.transportRequest : undefined),
        lastError: event.error
      }
    }
    return summaries
  }

  async getAssistedApplyPlanItem(
    workflow: RepositoryWorkflow,
    objectKey: string
  ): Promise<AssistedApplyPlanItem | undefined> {
    const normalizedKey = objectKey.trim().toUpperCase()
    try {
      const plan = await readJson<AssistedApplyPlan>(
        this.artifactPath(workflow, "assisted-apply", "plan.json")
      )
      return plan.items.find(item => item.key === normalizedKey)
    } catch {
      return undefined
    }
  }

  async saveCriteria(workflowId: string, criteria: Omit<RepositoryCriteria, "criteriaHash">) {
    const workflow = await this.get(workflowId)
    if (
      criteria.includeNames.length > 1 ||
      criteria.includeNames.some(value => value.includes(","))
    )
      throw new Error(
        "Include object names accepts one pattern only; comma-separated values are not allowed"
      )
    const includeNames = criteria.includeNames.map(value => value.trim()).filter(Boolean)
    if (includeNames.some(value => value.length > 255))
      throw new Error("Include object name pattern cannot exceed 255 characters")
    const packagePatterns = criteria.packages.map(value => value.trim()).filter(Boolean)
    if (!includeNames.length && !packagePatterns.length)
      throw new Error("Enter an object name pattern or at least one package pattern")
    if (packagePatterns.some(value => value === "*" || value === "/*"))
      throw new Error(
        "Package patterns '*' and '/*' are not allowed; use a scoped pattern such as Z* or /XYZ/*"
      )
    const normalized = {
      ...criteria,
      includeNames,
      packages: packagePatterns,
      sourceConcurrency: Math.min(10, Math.max(1, criteria.sourceConcurrency)),
      targetConcurrency: Math.min(10, Math.max(1, criteria.targetConcurrency)),
      verificationConcurrency: Math.min(
        MAX_VERIFICATION_CONCURRENCY,
        Math.max(1, criteria.verificationConcurrency ?? DEFAULT_VERIFICATION_CONCURRENCY)
      ),
      transportConcurrency: Math.min(10, Math.max(1, criteria.transportConcurrency ?? 5))
    }
    const saved: RepositoryCriteria = {
      ...normalized,
      criteriaHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    }
    await atomicWriteJson(path.join(this.workflowPath(workflow), CRITERIA_FILE), saved)
    await this.clearDerivedArtifacts(workflow)
    await this.update(workflowId, current => ({
      ...current,
      currentStep: "discovery",
      runState: "idle",
      steps: {
        ...initialSteps(),
        criteria: { status: "complete", completedAt: new Date().toISOString() }
      }
    }))
    return saved
  }

  async saveTransportConcurrency(
    workflowId: string,
    transportConcurrency: number
  ): Promise<RepositoryCriteria> {
    const workflow = await this.get(workflowId)
    const criteria = await this.getCriteria(workflowId)
    if (!criteria) throw new Error("Workflow criteria are missing")
    const { criteriaHash: _criteriaHash, ...base } = criteria
    const normalized = {
      ...base,
      updatedAt: new Date().toISOString(),
      transportConcurrency: Math.min(10, Math.max(1, transportConcurrency))
    }
    const saved: RepositoryCriteria = {
      ...normalized,
      criteriaHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    }
    await atomicWriteJson(path.join(this.workflowPath(workflow), CRITERIA_FILE), saved)
    return saved
  }

  async saveDownloadConcurrency(
    workflowId: string,
    sourceConcurrency: number,
    targetConcurrency: number,
    verificationConcurrency?: number
  ): Promise<RepositoryCriteria> {
    const workflow = await this.get(workflowId)
    const criteria = await this.getCriteria(workflowId)
    if (!criteria) throw new Error("Workflow criteria are missing")
    const { criteriaHash: _criteriaHash, ...base } = criteria
    const normalized = {
      ...base,
      updatedAt: new Date().toISOString(),
      sourceConcurrency: Math.min(10, Math.max(1, sourceConcurrency)),
      targetConcurrency: Math.min(10, Math.max(1, targetConcurrency)),
      verificationConcurrency: Math.min(
        MAX_VERIFICATION_CONCURRENCY,
        Math.max(
          1,
          verificationConcurrency ??
            base.verificationConcurrency ??
            DEFAULT_VERIFICATION_CONCURRENCY
        )
      )
    }
    const saved: RepositoryCriteria = {
      ...normalized,
      criteriaHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    }
    await atomicWriteJson(path.join(this.workflowPath(workflow), CRITERIA_FILE), saved)
    return saved
  }

  async invalidateAfterSourceSelection(
    workflowId: string,
    deselectedKeys?: string[]
  ): Promise<void> {
    const workflow = await this.get(workflowId)
    if (deselectedKeys) {
      const directories = deselectedKeys.flatMap(key =>
        ["source", "target"].map(side =>
          this.artifactPath(
            workflow,
            "sources",
            side,
            "objects",
            createHash("sha256").update(key).digest("hex").slice(0, 20)
          )
        )
      )
      for (let index = 0; index < directories.length; index += SNAPSHOT_DELETE_BATCH_SIZE)
        await Promise.all(
          directories
            .slice(index, index + SNAPSHOT_DELETE_BATCH_SIZE)
            .map(directory => fs.rm(directory, { recursive: true, force: true }))
        )
    } else {
      await fs.rm(this.artifactPath(workflow, "sources"), { recursive: true, force: true })
      await Promise.all(
        ["sources/source/objects", "sources/target/objects"].map(directory =>
          fs.mkdir(this.artifactPath(workflow, directory), { recursive: true })
        )
      )
    }
    await fs.rm(this.artifactPath(workflow, "assisted-apply"), {
      recursive: true,
      force: true
    })
    await fs.mkdir(this.artifactPath(workflow, "assisted-apply"), { recursive: true })
    await fs.rm(this.artifactPath(workflow, "comparison", "source.jsonl"), { force: true })
    await fs.rm(this.artifactPath(workflow, "comparison", "source-summary.json"), { force: true })
    await this.update(workflowId, current => ({
      ...current,
      currentStep: "sourceSelection",
      runState: "idle",
      steps: {
        ...current.steps,
        sourceSelection: { status: "not-started" },
        sourceDownload: { status: "not-started" },
        sourceComparison: { status: "not-started" },
        assistedApplyPlan: { status: "not-started" },
        transportCheck: { status: "not-started" }
      }
    }))
  }

  async invalidateAfterDiscovery(workflowId: string): Promise<void> {
    const workflow = await this.get(workflowId)
    await fs.rm(this.artifactPath(workflow, "comparison"), { recursive: true, force: true })
    await fs.rm(this.artifactPath(workflow, "sources"), { recursive: true, force: true })
    await fs.rm(this.artifactPath(workflow, "assisted-apply"), { recursive: true, force: true })
    await Promise.all(
      ["comparison", "sources/source/objects", "sources/target/objects", "assisted-apply"].map(
        directory => fs.mkdir(this.artifactPath(workflow, directory), { recursive: true })
      )
    )
  }

  async invalidateAfterExistenceComparison(workflowId: string): Promise<void> {
    await this.invalidateAfterSourceSelection(workflowId)
  }

  async invalidateAssistedApplyPlan(workflowId: string): Promise<void> {
    const workflow = await this.get(workflowId)
    await fs.rm(this.artifactPath(workflow, "assisted-apply"), {
      recursive: true,
      force: true
    })
    await fs.mkdir(this.artifactPath(workflow, "assisted-apply"), { recursive: true })
    await this.update(workflowId, current => ({
      ...current,
      steps: {
        ...current.steps,
        assistedApplyPlan: { status: "not-started" },
        transportCheck: { status: "not-started" }
      }
    }))
  }

  private async clearDerivedArtifacts(workflow: RepositoryWorkflow) {
    const root = this.workflowPath(workflow)
    for (const directory of ["discovery", "comparison", "sources", "assisted-apply"]) {
      await fs.rm(path.join(root, directory), { recursive: true, force: true })
    }
    await Promise.all(
      [
        "discovery/source",
        "discovery/target",
        "comparison",
        "sources/source/objects",
        "sources/target/objects",
        "assisted-apply"
      ].map(directory => fs.mkdir(path.join(root, directory), { recursive: true }))
    )
  }

  async getCriteria(
    workflowId: string,
    knownWorkflow?: RepositoryWorkflow
  ): Promise<RepositoryCriteria | undefined> {
    const workflow = knownWorkflow ?? (await this.get(workflowId))
    if (workflow.workflowId !== workflowId)
      throw new Error(`Repository workflow not found: ${workflowId}`)
    try {
      return await readJson<RepositoryCriteria>(
        path.join(this.workflowPath(workflow), CRITERIA_FILE)
      )
    } catch {
      return undefined
    }
  }

  artifactPath(workflow: RepositoryWorkflow, ...segments: string[]): string {
    return path.join(this.workflowPath(workflow), ...segments)
  }

  async appendJsonLine(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8")
  }

  async acquireRunLock(workflowId: string, ownerId: string = randomUUID()): Promise<string> {
    const workflow = await this.get(workflowId)
    const lockPath = this.artifactPath(workflow, "run.lock")
    try {
      const handle = await fs.open(lockPath, "wx")
      await handle.writeFile(
        JSON.stringify({
          workflowId,
          ownerId,
          sessionId: this.sessionId,
          processId: process.pid,
          startedAt: new Date().toISOString()
        })
      )
      await handle.close()
      return ownerId
    } catch (error: any) {
      if (error?.code === "EEXIST") throw new Error("This workflow is already running")
      throw error
    }
  }

  async releaseRunLock(workflowId: string, ownerId?: string): Promise<boolean> {
    const workflow = await this.get(workflowId)
    const lockPath = this.artifactPath(workflow, "run.lock")
    if (ownerId) {
      try {
        const lock = await readJson<{ ownerId?: string }>(lockPath)
        if (lock.ownerId !== ownerId) return false
      } catch {
        return false
      }
    }
    await fs.rm(lockPath, { force: true })
    return true
  }

  async replaceJsonLines(filePath: string, values: AsyncIterable<unknown> | Iterable<unknown>) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    const handle = await fs.open(temporaryPath, "w")
    try {
      for await (const value of values) await handle.write(`${JSON.stringify(value)}\n`)
    } finally {
      await handle.close()
    }
    await replaceFile(temporaryPath, filePath)
  }

  async *readJsonLines<T>(filePath: string): AsyncGenerator<T> {
    const lines = createInterface({
      input: createReadStream(filePath, "utf8"),
      crlfDelay: Infinity
    })
    for await (const line of lines) if (line.trim()) yield JSON.parse(line) as T
  }

  async writeJson(filePath: string, value: unknown): Promise<void> {
    await atomicWriteJson(filePath, value)
  }

  private workflowPath(workflow: Pick<RepositoryWorkflow, "folderName">): string {
    return path.join(this.rootPath, workflow.folderName)
  }

  private async waitForUpdates(workflowId: string): Promise<void> {
    const pending = this.updateQueues.get(workflowId)
    if (pending) await pending
  }

  private defaultConcurrency(): number {
    const value = vscode.workspace
      .getConfiguration("abapfs.repositoryWorkflows")
      .get<number>("defaultConcurrency", 5)
    return Math.min(10, Math.max(1, value))
  }
}

export function isAttemptForPlanItem(
  events: AssistedApplyExecutionEvent[],
  attemptId: string,
  item: Pick<AssistedApplyPlanItem, "sourceHash" | "targetHash">
): boolean {
  return events.some(
    event =>
      event.attemptId === attemptId &&
      event.stage === "apply" &&
      event.status === "succeeded" &&
      event.sourceHash === item.sourceHash &&
      event.targetHash === item.targetHash
  )
}

export function hasCompletionForPlanItem(
  events: AssistedApplyExecutionEvent[],
  item: Pick<AssistedApplyPlanItem, "sourceHash" | "targetHash">
): boolean {
  return events.some(
    event =>
      event.stage === "completion" &&
      event.status === "succeeded" &&
      isAttemptForPlanItem(events, event.attemptId, item)
  )
}

async function liveRunLock(lockPath: string, sessionId: string): Promise<boolean> {
  try {
    const lock = await readJson<{ processId?: number; sessionId?: string }>(lockPath)
    if (!Number.isInteger(lock.processId) || !lock.processId) return false
    if (lock.processId === process.pid) return lock.sessionId === sessionId
    try {
      process.kill(lock.processId, 0)
      return true
    } catch (error: any) {
      return error?.code === "EPERM"
    }
  } catch {
    return false
  }
}
