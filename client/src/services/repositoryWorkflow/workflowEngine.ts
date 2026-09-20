import { EventEmitter } from "events"
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { connectedRoots } from "../../config"
import { RepositoryDiscoveryService } from "./discoveryService"
import {
  DEFAULT_VERIFICATION_CONCURRENCY,
  ExistenceComparisonRecord,
  RepositoryObjectRecord,
  RepositoryWorkflow,
  repositoryObjectKey,
  SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES,
  SourceSelection,
  WorkflowStepId,
  WorkflowStepState
} from "./types"
import { WorkflowStore } from "./workflowStore"
import { WorkflowSnapshotService } from "./snapshotService"
import { WorkflowAssistedApplyService } from "./assistedApplyService"
import { assertWorkflowStepReady } from "./workflowUiModel"

const PROGRESS_PERSIST_INTERVAL_MS = 500

export class RepositoryWorkflowEngine extends EventEmitter {
  private readonly discovery = new RepositoryDiscoveryService()
  private readonly snapshots: WorkflowSnapshotService
  private readonly assistedApply: WorkflowAssistedApplyService
  private readonly running = new Map<string, vscode.CancellationTokenSource>()

  constructor(readonly store: WorkflowStore) {
    super()
    this.snapshots = new WorkflowSnapshotService(store)
    this.assistedApply = new WorkflowAssistedApplyService(store)
  }

  async runDiscovery(workflowId: string): Promise<RepositoryWorkflow> {
    const workflow = await this.requireRunnable(workflowId, "discovery")
    const criteria = await this.store.getCriteria(workflowId)
    if (!criteria) throw new Error("Save discovery criteria before running discovery")
    const controller = new vscode.CancellationTokenSource()
    if (workflow.steps.discovery.status === "complete") {
      await this.store.invalidateAfterDiscovery(workflowId)
      const sides = ["source", "target"] as const
      for (let sideIndex = 0; sideIndex < sides.length; sideIndex++) {
        const side = sides[sideIndex]
        await fs.rm(this.store.artifactPath(workflow, "discovery", side), {
          recursive: true,
          force: true
        })
        await fs.mkdir(this.store.artifactPath(workflow, "discovery", side), { recursive: true })
      }
    }
    this.running.set(workflowId, controller)
    await this.setRunning(workflowId, "discovery")
    try {
      const discoverySides = ["source", "target"] as const
      for (let sideIndex = 0; sideIndex < discoverySides.length; sideIndex++) {
        const side = discoverySides[sideIndex]
        if (controller.token.isCancellationRequested) return await this.pause(workflowId)
        const connectionId = workflow[side].connectionId
        const filePath = this.store.artifactPath(workflow, "discovery", side, "tadir.jsonl")
        const pagesPath = this.store.artifactPath(workflow, "discovery", side, "packages")
        const checkpointPath = this.store.artifactPath(
          workflow,
          "discovery",
          side,
          "checkpoint.json"
        )
        await fs.mkdir(pagesPath, { recursive: true })
        let completedPackages = new Set<string>()
        try {
          const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"))
          completedPackages = new Set(checkpoint.completedPackages ?? [])
        } catch {}
        const summary = {
          total: 0,
          byType: {} as Record<string, number>,
          byClassification: {} as Record<string, number>
        }
        for await (const packageResult of this.discovery.discoverPackages(
          connectionId,
          criteria,
          completedPackages
        )) {
          if (controller.token.isCancellationRequested) return await this.pause(workflowId)
          const pageName = `${Buffer.from(packageResult.packageName).toString("base64url")}.jsonl`
          await this.store.replaceJsonLines(path.join(pagesPath, pageName), packageResult.rows)
          for (const packageName of packageResult.packageNames) completedPackages.add(packageName)
          await this.store.writeJson(checkpointPath, {
            completedPackages: [...completedPackages].sort()
          })
          await this.updateProgress(
            workflowId,
            "discovery",
            sideIndex + 1,
            discoverySides.length,
            `${side}:${packageResult.totalPackages}`
          )
        }
        const pageFiles = (await fs.readdir(pagesPath)).sort()
        const persisted = (async function* (store: WorkflowStore) {
          for (const pageFile of pageFiles)
            for await (const row of store.readJsonLines<RepositoryObjectRecord>(
              path.join(pagesPath, pageFile)
            )) {
              summary.total++
              summary.byType[row.objectType] = (summary.byType[row.objectType] ?? 0) + 1
              summary.byClassification[row.classification] =
                (summary.byClassification[row.classification] ?? 0) + 1
              yield row
            }
        })(this.store)
        await this.store.replaceJsonLines(filePath, persisted)
        await this.store.writeJson(
          this.store.artifactPath(workflow, "discovery", side, "summary.json"),
          summary
        )
      }
      return await this.completeStep(workflowId, "discovery", "existenceComparison")
    } catch (error) {
      return await this.failStep(workflowId, "discovery", error)
    } finally {
      this.running.delete(workflowId)
    }
  }

  async compareExistence(workflowId: string): Promise<RepositoryWorkflow> {
    const workflow = await this.requireRunnable(workflowId, "existenceComparison")
    if (workflow.steps.existenceComparison.status === "complete")
      await this.store.invalidateAfterExistenceComparison(workflowId)
    await this.setRunning(workflowId, "existenceComparison")
    try {
      const source = await collect<RepositoryObjectRecord>(
        this.store.readJsonLines(
          this.store.artifactPath(workflow, "discovery", "source", "tadir.jsonl")
        )
      )
      const target = await collect<RepositoryObjectRecord>(
        this.store.readJsonLines(
          this.store.artifactPath(workflow, "discovery", "target", "tadir.jsonl")
        )
      )
      const sourceMap = new Map(source.map(row => [repositoryObjectKey(row), row]))
      const targetMap = new Map(target.map(row => [repositoryObjectKey(row), row]))
      const keys = [...new Set([...sourceMap.keys(), ...targetMap.keys()])].sort()
      const results: ExistenceComparisonRecord[] = keys.map(key => ({
        key,
        source: sourceMap.get(key),
        target: targetMap.get(key),
        status: sourceMap.has(key) ? (targetMap.has(key) ? "both" : "source-only") : "target-only"
      }))
      await this.store.replaceJsonLines(
        this.store.artifactPath(workflow, "comparison", "existence.jsonl"),
        results
      )
      await this.store.writeJson(
        this.store.artifactPath(workflow, "comparison", "existence-summary.json"),
        summarizeBy(results, row => row.status)
      )
      return await this.completeStep(workflowId, "existenceComparison", "sourceSelection")
    } catch (error) {
      return await this.failStep(workflowId, "existenceComparison", error)
    }
  }

  async pause(workflowId: string): Promise<RepositoryWorkflow> {
    const active = this.running.get(workflowId)
    if (!active) return await this.store.get(workflowId)
    active.cancel()
    const pausedAt = new Date()
    const updated = await this.store.update(workflowId, workflow => ({
      ...workflow,
      runState: "paused",
      steps: {
        ...workflow.steps,
        [workflow.currentStep]: {
          ...workflow.steps[workflow.currentStep],
          status: "paused",
          elapsedMs:
            workflow.steps[workflow.currentStep].status === "paused"
              ? workflow.steps[workflow.currentStep].elapsedMs
              : elapsedAt(workflow.steps[workflow.currentStep], pausedAt)
        }
      }
    }))
    await this.store.releaseRunLock(workflowId)
    return updated
  }

  async saveSourceSelection(workflowId: string, keys?: string[]) {
    const workflow = await this.requireRunnable(workflowId, "sourceSelection")
    await this.setRunning(workflowId, "sourceSelection")
    try {
      const selected = keys ?? []
      const comparable = new Set<string>()
      const excludedTypes = new Set<string>(SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES)
      for await (const row of this.store.readJsonLines<ExistenceComparisonRecord>(
        this.store.artifactPath(workflow, "comparison", "existence.jsonl")
      ))
        if (
          row.status === "both" &&
          row.source &&
          !excludedTypes.has(row.source.objectType.toUpperCase())
        )
          comparable.add(row.key)
      if (!keys) {
        selected.push(...comparable)
      }
      const invalid = selected.filter(key => !comparable.has(key))
      if (invalid.length)
        throw new Error(
          "DEVC package objects and objects missing from either system cannot be source-compared"
        )
      if (!selected.length) throw new Error("Select at least one object to compare")
      const selection: SourceSelection = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        keys: [...new Set(selected)].sort()
      }
      await this.store.invalidateAfterSourceSelection(workflowId)
      await this.store.writeJson(
        this.store.artifactPath(workflow, "comparison", "source-selection.json"),
        selection
      )
      return await this.completeStep(workflowId, "sourceSelection", "sourceDownload")
    } catch (error) {
      return await this.failStep(workflowId, "sourceSelection", error)
    }
  }

  async downloadSources(workflowId: string): Promise<RepositoryWorkflow> {
    const workflow = await this.requireRunnable(workflowId, "sourceDownload")
    const criteria = await this.store.getCriteria(workflowId)
    if (!criteria) throw new Error("Workflow criteria are missing")
    const selection = JSON.parse(
      await import("fs/promises").then(module =>
        module.readFile(
          this.store.artifactPath(workflow, "comparison", "source-selection.json"),
          "utf8"
        )
      )
    ) as SourceSelection
    const records = await this.snapshots.selectedRecords(workflowId, selection.keys)
    const resuming = workflow.steps.sourceDownload.status === "paused"
    const cancellation = new vscode.CancellationTokenSource()
    this.running.set(workflowId, cancellation)
    await this.setRunning(workflowId, "sourceDownload")
    try {
      let sourceDone = 0
      let targetDone = 0
      let downloading = false
      let verificationComplete = false
      let lastProgressPersistedAt = 0
      const activity = () =>
        resuming && !verificationComplete ? "verifying" : downloading ? "downloading" : "preparing"
      const persistProgress = async (force = false) => {
        const now = Date.now()
        if (!force && now - lastProgressPersistedAt < PROGRESS_PERSIST_INTERVAL_MS) return
        lastProgressPersistedAt = now
        await this.updateProgress(
          workflowId,
          "sourceDownload",
          sourceDone + targetDone,
          selection.keys.length * 2,
          activity()
        )
      }
      await persistProgress(true)
      const [sourceVerification, targetVerification] = await Promise.all([
        this.snapshots.verifySide(
          workflowId,
          "source",
          records.source,
          criteria.verificationConcurrency ?? DEFAULT_VERIFICATION_CONCURRENCY,
          cancellation.token,
          async completed => {
            sourceDone = completed
            await persistProgress()
          }
        ),
        this.snapshots.verifySide(
          workflowId,
          "target",
          records.target,
          criteria.verificationConcurrency ?? DEFAULT_VERIFICATION_CONCURRENCY,
          cancellation.token,
          async completed => {
            targetDone = completed
            await persistProgress()
          }
        )
      ])
      sourceDone = sourceVerification.completed
      targetDone = targetVerification.completed
      if (cancellation.token.isCancellationRequested) {
        await persistProgress(true)
        return await this.pause(workflowId)
      }
      verificationComplete = true
      downloading = sourceVerification.pending.length > 0 || targetVerification.pending.length > 0
      if (downloading) await persistProgress(true)
      await Promise.all([
        this.snapshots.downloadPending(
          workflowId,
          "source",
          sourceVerification.pending,
          records.source.length,
          sourceDone,
          criteria.sourceConcurrency,
          cancellation.token,
          async completed => {
            sourceDone = completed
            await persistProgress()
          }
        ),
        this.snapshots.downloadPending(
          workflowId,
          "target",
          targetVerification.pending,
          records.target.length,
          targetDone,
          criteria.targetConcurrency,
          cancellation.token,
          async completed => {
            targetDone = completed
            await persistProgress()
          }
        )
      ])
      await persistProgress(true)
      if (cancellation.token.isCancellationRequested) return await this.pause(workflowId)
      return await this.completeStep(workflowId, "sourceDownload", "sourceComparison")
    } catch (error) {
      return await this.failStep(workflowId, "sourceDownload", error)
    } finally {
      this.running.delete(workflowId)
      cancellation.dispose()
    }
  }

  async compareSources(workflowId: string): Promise<RepositoryWorkflow> {
    const workflow = await this.requireRunnable(workflowId, "sourceComparison")
    await this.setRunning(workflowId, "sourceComparison")
    try {
      const selection = JSON.parse(
        await import("fs/promises").then(module =>
          module.readFile(
            this.store.artifactPath(workflow, "comparison", "source-selection.json"),
            "utf8"
          )
        )
      ) as SourceSelection
      await this.updateProgress(workflowId, "sourceComparison", 0, selection.keys.length)
      const results = await this.snapshots.compare(workflowId, selection.keys, (completed, total) =>
        this.updateProgress(workflowId, "sourceComparison", completed, total)
      )
      await this.store.replaceJsonLines(
        this.store.artifactPath(workflow, "comparison", "source.jsonl"),
        results
      )
      await this.store.writeJson(
        this.store.artifactPath(workflow, "comparison", "source-summary.json"),
        summarizeBy(results, row => row.status)
      )
      return await this.completeStep(workflowId, "sourceComparison", "assistedApplyPlan")
    } catch (error) {
      return await this.failStep(workflowId, "sourceComparison", error)
    }
  }

  async compareSourceCode(workflowId: string, keys?: string[]): Promise<RepositoryWorkflow> {
    const workflow = await this.store.get(workflowId)
    if (workflow.steps.existenceComparison.status !== "complete")
      throw new Error("Complete inventory comparison before comparing source code.")
    if (keys || workflow.steps.sourceSelection.status !== "complete") {
      const selected = await this.saveSourceSelection(workflowId, keys)
      this.assertStepComplete(selected, "sourceSelection")
    }
    const afterSelection = await this.store.get(workflowId)
    if (afterSelection.steps.sourceDownload.status !== "complete") {
      const downloaded = await this.downloadSources(workflowId)
      if (downloaded.steps.sourceDownload.status === "paused") return downloaded
      this.assertStepComplete(downloaded, "sourceDownload")
    }
    const compared = await this.compareSources(workflowId)
    this.assertStepComplete(compared, "sourceComparison")
    return compared
  }

  private assertStepComplete(workflow: RepositoryWorkflow, step: WorkflowStepId): void {
    if (workflow.steps[step].status !== "complete")
      throw new Error(workflow.steps[step].lastError || workflow.lastError || `${step} failed`)
  }

  async prepareAssistedApply(workflowId: string, keys?: string[]) {
    await this.requireRunnable(workflowId, "assistedApplyPlan")
    await this.setRunning(workflowId, "assistedApplyPlan")
    try {
      const plan = await this.assistedApply.prepare(workflowId, keys)
      const completedAt = new Date()
      const updated = await this.store.update(workflowId, current => ({
        ...current,
        runState: "complete",
        steps: {
          ...current.steps,
          assistedApplyPlan: {
            ...current.steps.assistedApplyPlan,
            status: "complete",
            completedAt: completedAt.toISOString(),
            elapsedMs: elapsedAt(current.steps.assistedApplyPlan, completedAt)
          }
        }
      }))
      await this.store.releaseRunLock(workflowId)
      this.emit("changed", updated)
      return plan
    } catch (error) {
      await this.failStep(workflowId, "assistedApplyPlan", error)
      throw error
    }
  }

  async openAssistedApplySource(workflowId: string, key: string): Promise<void> {
    await this.assistedApply.openSource(workflowId, key)
  }

  async openAssistedApplyTarget(workflowId: string, key: string): Promise<void> {
    await this.assistedApply.openTarget(workflowId, key)
  }

  async openAssistedApplyDiff(workflowId: string, key: string): Promise<void> {
    await this.assistedApply.openDiff(workflowId, key)
  }

  async stageAssistedApplySource(workflowId: string, key: string): Promise<void> {
    await this.assistedApply.stageInTargetEditor(workflowId, key)
  }

  private async requireRunnable(workflowId: string, step: WorkflowStepId) {
    const workflow = await this.store.get(workflowId)
    const roots = connectedRoots()
    if (!roots.has(workflow.source.connectionId) || !roots.has(workflow.target.connectionId))
      throw new Error("Both source and target connections must be connected in the workspace")
    if (workflow.source.connectionId === workflow.target.connectionId)
      throw new Error("Source and target connections must be different")
    if (this.running.has(workflowId)) throw new Error("This workflow is already running")
    assertWorkflowStepReady(workflow, step)
    return workflow
  }

  private async setRunning(workflowId: string, step: WorkflowStepId) {
    let lockAcquired = false
    try {
      await this.store.acquireRunLock(workflowId)
      lockAcquired = true
      const startedAt = new Date().toISOString()
      const updated = await this.store.update(workflowId, workflow => {
        const previous = workflow.steps[step]
        return {
          ...workflow,
          currentStep: step,
          runState: "running",
          lastError: undefined,
          steps: {
            ...workflow.steps,
            [step]: {
              ...(previous.status === "paused" ? previous : {}),
              status: "running",
              startedAt,
              completedAt: undefined,
              elapsedMs: previous.status === "paused" ? (previous.elapsedMs ?? 0) : 0
            }
          }
        }
      })
      this.emit("changed", updated)
      return updated
    } catch (error) {
      this.running.delete(workflowId)
      if (lockAcquired) await this.store.releaseRunLock(workflowId).catch(() => undefined)
      throw error
    }
  }

  private async completeStep(workflowId: string, step: WorkflowStepId, next: WorkflowStepId) {
    const completedAt = new Date()
    const updated = await this.store.update(workflowId, workflow => ({
      ...workflow,
      currentStep: next,
      runState: "idle",
      steps: {
        ...workflow.steps,
        [step]: {
          ...workflow.steps[step],
          status: "complete",
          completedAt: completedAt.toISOString(),
          elapsedMs: elapsedAt(workflow.steps[step], completedAt)
        }
      }
    }))
    await this.store.releaseRunLock(workflowId)
    this.emit("changed", updated)
    return updated
  }

  private async failStep(workflowId: string, step: WorkflowStepId, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const failedAt = new Date()
    const updated = await this.store.update(workflowId, workflow => ({
      ...workflow,
      runState: "failed",
      lastError: message,
      steps: {
        ...workflow.steps,
        [step]: {
          ...workflow.steps[step],
          status: "failed",
          lastError: message,
          elapsedMs: elapsedAt(workflow.steps[step], failedAt)
        }
      }
    }))
    await this.store.releaseRunLock(workflowId)
    this.emit("changed", updated)
    return updated
  }

  private async updateProgress(
    workflowId: string,
    step: WorkflowStepId,
    completed: number,
    total: number,
    checkpoint?: string
  ) {
    const updated = await this.store.update(workflowId, workflow => ({
      ...workflow,
      steps: {
        ...workflow.steps,
        [step]: { ...workflow.steps[step], completed, total, checkpoint }
      }
    }))
    this.emit("progress", updated)
  }
}

function elapsedAt(step: WorkflowStepState, at: Date): number {
  const startedAt = step.startedAt ? Date.parse(step.startedAt) : Number.NaN
  return (
    (step.elapsedMs ?? 0) + (Number.isFinite(startedAt) ? Math.max(0, at.getTime() - startedAt) : 0)
  )
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}

function summarizeBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const value = key(row)
    summary[value] = (summary[value] ?? 0) + 1
    return summary
  }, {})
}
