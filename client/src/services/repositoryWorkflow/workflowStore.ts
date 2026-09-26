import * as vscode from "vscode"
import * as fs from "fs/promises"
import { createReadStream } from "fs"
import { createInterface } from "readline"
import * as os from "os"
import * as path from "path"
import { randomUUID, createHash } from "crypto"
import {
  DEFAULT_VERIFICATION_CONCURRENCY,
  initialSteps,
  MAX_VERIFICATION_CONCURRENCY,
  RepositoryCriteria,
  RepositoryWorkflow,
  defaultRepositoryCriteria,
  WORKFLOW_SCHEMA_VERSION
} from "./types"

const WORKFLOW_FILE = "workflow.json"
const CRITERIA_FILE = "criteria.json"
const SNAPSHOT_DELETE_BATCH_SIZE = 32

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
      )
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
        assistedApplyPlan: { status: "not-started" }
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
        assistedApplyPlan: { status: "not-started" }
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
