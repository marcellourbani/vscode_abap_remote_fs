import { EventEmitter } from "events"
import { randomUUID } from "crypto"
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
  WorkflowPauseReason,
  WorkflowStepId,
  WorkflowStepState
} from "./types"
import { WorkflowStore } from "./workflowStore"
import { WorkflowSnapshotService } from "./snapshotService"
import { WorkflowAssistedApplyService } from "./assistedApplyService"
import { assertWorkflowStepReady } from "./workflowUiModel"

const PROGRESS_PERSIST_INTERVAL_MS = 500

interface ActiveRun {
  id: string
  step: WorkflowStepId
  controller: vscode.CancellationTokenSource
  settled: Promise<void>
  settle: () => void
  lockAcquired: boolean
  pauseReason?: WorkflowPauseReason
}

export class RepositoryWorkflowEngine extends EventEmitter {
  private readonly discovery = new RepositoryDiscoveryService()
  private readonly snapshots: WorkflowSnapshotService
  private readonly assistedApply: WorkflowAssistedApplyService
  private readonly running = new Map<string, ActiveRun>()

  constructor(readonly store: WorkflowStore) {
    super()
    this.snapshots = new WorkflowSnapshotService(store)
    this.assistedApply = new WorkflowAssistedApplyService(store)
  }

  async runDiscovery(workflowId: string): Promise<RepositoryWorkflow> {
    const active = this.beginRun(workflowId, "discovery")
    try {
      const workflow = await this.requireRunnable(workflowId, "discovery", active)
      const criteria = await this.store.getCriteria(workflowId)
      if (!criteria) throw new Error("Save discovery criteria before running discovery")
      await this.setRunning(workflowId, "discovery", active)
      if (workflow.steps.discovery.status === "complete") {
        await this.store.invalidateAfterDiscovery(workflowId)
        const sides = ["source", "target"] as const
        for (const side of sides) {
          await fs.rm(this.store.artifactPath(workflow, "discovery", side), {
            recursive: true,
            force: true
          })
          await fs.mkdir(this.store.artifactPath(workflow, "discovery", side), { recursive: true })
        }
      }
      const discoverySides = ["source", "target"] as const
      for (let sideIndex = 0; sideIndex < discoverySides.length; sideIndex++) {
        const side = discoverySides[sideIndex]
        if (active.controller.token.isCancellationRequested)
          return await this.pauseStep(workflowId, "discovery", active)
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
          if (active.controller.token.isCancellationRequested)
            return await this.pauseStep(workflowId, "discovery", active)
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
        const persisted = (async function* (store: WorkflowStore, token: vscode.CancellationToken) {
          for (const pageFile of pageFiles)
            for await (const row of store.readJsonLines<RepositoryObjectRecord>(
              path.join(pagesPath, pageFile)
            )) {
              if (token.isCancellationRequested) return
              summary.total++
              summary.byType[row.objectType] = (summary.byType[row.objectType] ?? 0) + 1
              summary.byClassification[row.classification] =
                (summary.byClassification[row.classification] ?? 0) + 1
              yield row
            }
        })(this.store, active.controller.token)
        await this.store.replaceJsonLines(filePath, persisted)
        if (active.controller.token.isCancellationRequested)
          return await this.pauseStep(workflowId, "discovery", active)
        await this.store.writeJson(
          this.store.artifactPath(workflow, "discovery", side, "summary.json"),
          summary
        )
        if (active.controller.token.isCancellationRequested)
          return await this.pauseStep(workflowId, "discovery", active)
      }
      return await this.completeStep(workflowId, "discovery", "existenceComparison", active)
    } catch (error) {
      if (active.controller.token.isCancellationRequested && active.lockAcquired)
        return await this.pauseStep(workflowId, "discovery", active)
      if (active.lockAcquired) return await this.failStep(workflowId, "discovery", error, active)
      throw error
    } finally {
      try {
        await this.releaseActiveLock(workflowId, active)
      } finally {
        this.endRun(workflowId, active)
      }
    }
  }

  async compareExistence(workflowId: string): Promise<RepositoryWorkflow> {
    const active = this.beginRun(workflowId, "existenceComparison")
    try {
      const workflow = await this.requireRunnable(workflowId, "existenceComparison", active)
      if (workflow.steps.existenceComparison.status === "complete") {
        await this.acquireActiveLock(workflowId, active)
        await this.store.invalidateAfterExistenceComparison(workflowId)
      }
      await this.setRunning(workflowId, "existenceComparison", active)
      const source = await collect<RepositoryObjectRecord>(
        this.store.readJsonLines(
          this.store.artifactPath(workflow, "discovery", "source", "tadir.jsonl")
        ),
        active.controller.token
      )
      const target = await collect<RepositoryObjectRecord>(
        this.store.readJsonLines(
          this.store.artifactPath(workflow, "discovery", "target", "tadir.jsonl")
        ),
        active.controller.token
      )
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "existenceComparison", active)
      const sourceMap = new Map<string, RepositoryObjectRecord>()
      for (let index = 0; index < source.length; index++) {
        sourceMap.set(repositoryObjectKey(source[index]), source[index])
        await cancellationCheckpoint(active.controller.token, index)
      }
      const targetMap = new Map<string, RepositoryObjectRecord>()
      for (let index = 0; index < target.length; index++) {
        targetMap.set(repositoryObjectKey(target[index]), target[index])
        await cancellationCheckpoint(active.controller.token, index)
      }
      const keys = [...new Set([...sourceMap.keys(), ...targetMap.keys()])].sort()
      const results: ExistenceComparisonRecord[] = []
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]
        results.push({
          key,
          source: sourceMap.get(key),
          target: targetMap.get(key),
          status: sourceMap.has(key) ? (targetMap.has(key) ? "both" : "source-only") : "target-only"
        })
        await cancellationCheckpoint(active.controller.token, index)
      }
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "existenceComparison", active)
      await this.store.replaceJsonLines(
        this.store.artifactPath(workflow, "comparison", "existence.jsonl"),
        results
      )
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "existenceComparison", active)
      await this.store.writeJson(
        this.store.artifactPath(workflow, "comparison", "existence-summary.json"),
        summarizeBy(results, row => row.status)
      )
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "existenceComparison", active)
      return await this.completeStep(workflowId, "existenceComparison", "sourceSelection", active)
    } catch (error) {
      if (active.controller.token.isCancellationRequested && active.lockAcquired)
        return await this.pauseStep(workflowId, "existenceComparison", active)
      if (active.lockAcquired)
        return await this.failStep(workflowId, "existenceComparison", error, active)
      throw error
    } finally {
      try {
        await this.releaseActiveLock(workflowId, active)
      } finally {
        this.endRun(workflowId, active)
      }
    }
  }

  async pause(
    workflowId: string,
    reason: WorkflowPauseReason = "explicit-pause"
  ): Promise<RepositoryWorkflow> {
    const active = this.running.get(workflowId)
    if (!active) return await this.store.get(workflowId)
    active.pauseReason ??= reason
    active.controller.cancel()
    await active.settled
    return await this.store.get(workflowId)
  }

  async saveSourceSelection(workflowId: string, keys?: string[]) {
    const active = this.beginRun(workflowId, "sourceSelection")
    try {
      const workflow = await this.requireRunnable(workflowId, "sourceSelection", active)
      await this.acquireActiveLock(workflowId, active)
      let previousKeys = new Set<string>()
      try {
        const previous = JSON.parse(
          await fs.readFile(
            this.store.artifactPath(workflow, "comparison", "source-selection.json"),
            "utf8"
          )
        ) as SourceSelection
        previousKeys = new Set(previous.keys)
      } catch {}
      const selected = keys ? [...keys] : []
      const comparable = new Set<string>()
      const excludedTypes = new Set<string>(SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES)
      for await (const row of this.store.readJsonLines<ExistenceComparisonRecord>(
        this.store.artifactPath(workflow, "comparison", "existence.jsonl")
      )) {
        if (active.controller.token.isCancellationRequested)
          return await this.pauseStep(workflowId, "sourceSelection", active)
        if (
          row.status === "both" &&
          row.source &&
          !excludedTypes.has(row.source.objectType.toUpperCase())
        )
          comparable.add(row.key)
      }
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
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "sourceSelection", active)
      const retained = new Set(selection.keys)
      const deselected = [...previousKeys].filter(key => !retained.has(key))
      await this.store.invalidateAfterSourceSelection(workflowId, deselected)
      await this.setRunning(workflowId, "sourceSelection", active)
      await this.store.writeJson(
        this.store.artifactPath(workflow, "comparison", "source-selection.json"),
        selection
      )
      return await this.completeStep(workflowId, "sourceSelection", "sourceDownload", active)
    } catch (error) {
      if (active.controller.token.isCancellationRequested && active.lockAcquired)
        return await this.pauseStep(workflowId, "sourceSelection", active)
      if (active.lockAcquired)
        return await this.failStep(workflowId, "sourceSelection", error, active)
      throw error
    } finally {
      try {
        await this.releaseActiveLock(workflowId, active)
      } finally {
        this.endRun(workflowId, active)
      }
    }
  }

  async downloadSources(workflowId: string): Promise<RepositoryWorkflow> {
    const active = this.beginRun(workflowId, "sourceDownload")
    try {
      const workflow = await this.requireRunnable(workflowId, "sourceDownload", active)
      const criteria = await this.store.getCriteria(workflowId)
      if (!criteria) throw new Error("Workflow criteria are missing")
      const selection = JSON.parse(
        await fs.readFile(
          this.store.artifactPath(workflow, "comparison", "source-selection.json"),
          "utf8"
        )
      ) as SourceSelection
      const records = await this.snapshots.selectedRecords(workflowId, selection.keys)
      const resuming = ["paused", "interrupted", "failed", "partial"].includes(
        workflow.steps.sourceDownload.status
      )
      await this.setRunning(workflowId, "sourceDownload", active)
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
          active.controller.token,
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
          active.controller.token,
          async completed => {
            targetDone = completed
            await persistProgress()
          }
        )
      ])
      sourceDone = sourceVerification.completed
      targetDone = targetVerification.completed
      if (active.controller.token.isCancellationRequested) {
        await persistProgress(true)
        return await this.pauseStep(workflowId, "sourceDownload", active)
      }
      verificationComplete = true
      downloading = sourceVerification.pending.length > 0 || targetVerification.pending.length > 0
      if (downloading) await persistProgress(true)
      const [sourceResult, targetResult] = await Promise.all([
        this.snapshots.downloadPending(
          workflowId,
          "source",
          sourceVerification.pending,
          records.source.length,
          sourceDone,
          criteria.sourceConcurrency,
          active.controller.token,
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
          active.controller.token,
          async completed => {
            targetDone = completed
            await persistProgress()
          }
        )
      ])
      await persistProgress(true)
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "sourceDownload", active)
      const incomplete =
        sourceResult.partial + sourceResult.failed + targetResult.partial + targetResult.failed
      if (incomplete)
        return await this.partialStep(
          workflowId,
          "sourceDownload",
          "sourceComparison",
          `${incomplete} snapshot${incomplete === 1 ? "" : "s"} could not be downloaded completely`,
          active
        )
      return await this.completeStep(workflowId, "sourceDownload", "sourceComparison", active)
    } catch (error) {
      if (active.controller.token.isCancellationRequested && active.lockAcquired)
        return await this.pauseStep(workflowId, "sourceDownload", active)
      if (active.lockAcquired)
        return await this.failStep(workflowId, "sourceDownload", error, active)
      throw error
    } finally {
      try {
        await this.releaseActiveLock(workflowId, active)
      } finally {
        this.endRun(workflowId, active)
      }
    }
  }

  async compareSources(workflowId: string): Promise<RepositoryWorkflow> {
    const active = this.beginRun(workflowId, "sourceComparison")
    try {
      const workflow = await this.requireRunnable(workflowId, "sourceComparison", active)
      await this.acquireActiveLock(workflowId, active)
      await this.store.invalidateAssistedApplyPlan(workflowId)
      await this.setRunning(workflowId, "sourceComparison", active)
      const selection = JSON.parse(
        await fs.readFile(
          this.store.artifactPath(workflow, "comparison", "source-selection.json"),
          "utf8"
        )
      ) as SourceSelection
      await this.updateProgress(workflowId, "sourceComparison", 0, selection.keys.length)
      const results = await this.snapshots.compare(
        workflowId,
        selection.keys,
        (completed, total) => this.updateProgress(workflowId, "sourceComparison", completed, total),
        active.controller.token
      )
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "sourceComparison", active)
      await this.store.replaceJsonLines(
        this.store.artifactPath(workflow, "comparison", "source.jsonl"),
        results
      )
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "sourceComparison", active)
      await this.store.writeJson(
        this.store.artifactPath(workflow, "comparison", "source-summary.json"),
        summarizeBy(results, row => row.status)
      )
      if (active.controller.token.isCancellationRequested)
        return await this.pauseStep(workflowId, "sourceComparison", active)
      const incomplete = results.filter(row =>
        ["source-missing", "target-missing", "partial", "error"].includes(row.status)
      ).length
      if (incomplete)
        return await this.partialStep(
          workflowId,
          "sourceComparison",
          "assistedApplyPlan",
          `${incomplete} object${incomplete === 1 ? "" : "s"} could not be compared completely`,
          active
        )
      return await this.completeStep(workflowId, "sourceComparison", "assistedApplyPlan", active)
    } catch (error) {
      if (active.controller.token.isCancellationRequested && active.lockAcquired)
        return await this.pauseStep(workflowId, "sourceComparison", active)
      if (active.lockAcquired)
        return await this.failStep(workflowId, "sourceComparison", error, active)
      throw error
    } finally {
      try {
        await this.releaseActiveLock(workflowId, active)
      } finally {
        this.endRun(workflowId, active)
      }
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
      if (!["complete", "partial"].includes(downloaded.steps.sourceDownload.status))
        this.assertStepComplete(downloaded, "sourceDownload")
    }
    const compared = await this.compareSources(workflowId)
    if (!["complete", "partial"].includes(compared.steps.sourceComparison.status))
      this.assertStepComplete(compared, "sourceComparison")
    return compared
  }

  private assertStepComplete(workflow: RepositoryWorkflow, step: WorkflowStepId): void {
    if (workflow.steps[step].status !== "complete")
      throw new Error(workflow.steps[step].lastError || workflow.lastError || `${step} failed`)
  }

  async prepareAssistedApply(workflowId: string, keys?: string[]) {
    const active = this.beginRun(workflowId, "assistedApplyPlan")
    try {
      await this.requireRunnable(workflowId, "assistedApplyPlan", active)
      await this.setRunning(workflowId, "assistedApplyPlan", active)
      const plan = await this.assistedApply.prepare(workflowId, keys, active.controller.token)
      const completedAt = new Date()
      const updated = await this.store.update(workflowId, current => ({
        ...current,
        runState: current.steps.sourceComparison.status === "partial" ? "partial" : "complete",
        steps: {
          ...current.steps,
          assistedApplyPlan: {
            ...current.steps.assistedApplyPlan,
            status: "complete",
            completedAt: completedAt.toISOString(),
            elapsedMs: elapsedAt(current.steps.assistedApplyPlan, completedAt),
            pauseReason: undefined
          }
        }
      }))
      await this.releaseActiveLock(workflowId, active)
      this.emit("changed", updated)
      return plan
    } catch (error) {
      if (active.controller.token.isCancellationRequested && active.lockAcquired) {
        await this.pauseStep(workflowId, "assistedApplyPlan", active)
        return undefined
      }
      if (active.lockAcquired) await this.failStep(workflowId, "assistedApplyPlan", error, active)
      throw error
    } finally {
      try {
        await this.releaseActiveLock(workflowId, active)
      } finally {
        this.endRun(workflowId, active)
      }
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

  private async requireRunnable(workflowId: string, step: WorkflowStepId, active: ActiveRun) {
    const workflow = await this.store.get(workflowId)
    const roots = connectedRoots()
    if (!roots.has(workflow.source.connectionId) || !roots.has(workflow.target.connectionId))
      throw new Error("Both source and target connections must be connected in the workspace")
    if (workflow.source.connectionId === workflow.target.connectionId)
      throw new Error("Source and target connections must be different")
    if (this.running.get(workflowId) !== active) throw new Error("This workflow is already running")
    assertWorkflowStepReady(workflow, step)
    return workflow
  }

  private async setRunning(workflowId: string, step: WorkflowStepId, active: ActiveRun) {
    try {
      await this.acquireActiveLock(workflowId, active)
      const startedAt = new Date().toISOString()
      const updated = await this.store.update(workflowId, workflow => {
        const previous = workflow.steps[step]
        const resuming = ["paused", "partial", "failed", "interrupted"].includes(previous.status)
        return {
          ...workflow,
          currentStep: step,
          runState: "running",
          lastError: undefined,
          steps: {
            ...workflow.steps,
            [step]: {
              ...(resuming ? previous : {}),
              status: "running",
              startedAt,
              completedAt: undefined,
              elapsedMs: resuming ? (previous.elapsedMs ?? 0) : 0,
              lastError: undefined,
              pauseReason: undefined
            }
          }
        }
      })
      this.emit("changed", updated)
      return updated
    } catch (error) {
      await this.releaseActiveLock(workflowId, active)
      throw error
    }
  }

  private async completeStep(
    workflowId: string,
    step: WorkflowStepId,
    next: WorkflowStepId,
    active: ActiveRun
  ) {
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
          elapsedMs: elapsedAt(workflow.steps[step], completedAt),
          lastError: undefined,
          pauseReason: undefined
        }
      }
    }))
    await this.releaseActiveLock(workflowId, active)
    this.emit("changed", updated)
    return updated
  }

  private async partialStep(
    workflowId: string,
    step: WorkflowStepId,
    next: WorkflowStepId,
    message: string,
    active: ActiveRun
  ) {
    const completedAt = new Date()
    const updated = await this.store.update(workflowId, workflow => {
      const retryDownload =
        step === "sourceComparison"
          ? {
              sourceDownload: {
                ...workflow.steps.sourceDownload,
                status: "partial" as const,
                lastError: message
              }
            }
          : {}
      return {
        ...workflow,
        currentStep: next,
        runState: "partial" as const,
        lastError: message,
        steps: {
          ...workflow.steps,
          ...retryDownload,
          [step]: {
            ...workflow.steps[step],
            status: "partial" as const,
            completedAt: completedAt.toISOString(),
            elapsedMs: elapsedAt(workflow.steps[step], completedAt),
            lastError: message,
            pauseReason: undefined
          }
        }
      }
    })
    await this.releaseActiveLock(workflowId, active)
    this.emit("changed", updated)
    return updated
  }

  private async pauseStep(workflowId: string, step: WorkflowStepId, active: ActiveRun) {
    const pausedAt = new Date()
    const updated = await this.store.update(workflowId, workflow => ({
      ...workflow,
      currentStep: step,
      runState: "paused",
      steps: {
        ...workflow.steps,
        [step]: {
          ...workflow.steps[step],
          status: "paused",
          elapsedMs: elapsedAt(workflow.steps[step], pausedAt),
          pauseReason: active.pauseReason ?? "explicit-pause"
        }
      }
    }))
    await this.releaseActiveLock(workflowId, active)
    this.emit("changed", updated)
    return updated
  }

  private async failStep(
    workflowId: string,
    step: WorkflowStepId,
    error: unknown,
    active: ActiveRun
  ) {
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
          elapsedMs: elapsedAt(workflow.steps[step], failedAt),
          pauseReason: undefined
        }
      }
    }))
    await this.releaseActiveLock(workflowId, active)
    this.emit("changed", updated)
    return updated
  }

  private beginRun(workflowId: string, step: WorkflowStepId): ActiveRun {
    if (this.running.has(workflowId)) throw new Error("This workflow is already running")
    let settle = () => {}
    const settled = new Promise<void>(resolve => {
      settle = resolve
    })
    const active: ActiveRun = {
      id: randomUUID(),
      step,
      controller: new vscode.CancellationTokenSource(),
      settled,
      settle,
      lockAcquired: false
    }
    this.running.set(workflowId, active)
    return active
  }

  private endRun(workflowId: string, active: ActiveRun): void {
    if (this.running.get(workflowId) === active) this.running.delete(workflowId)
    active.controller.dispose()
    active.settle()
  }

  private async releaseActiveLock(workflowId: string, active: ActiveRun): Promise<void> {
    if (!active.lockAcquired) return
    await this.store.releaseRunLock(workflowId, active.id)
    active.lockAcquired = false
  }

  private async acquireActiveLock(workflowId: string, active: ActiveRun): Promise<void> {
    if (active.lockAcquired) return
    await this.store.acquireRunLock(workflowId, active.id)
    active.lockAcquired = true
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

async function collect<T>(
  values: AsyncIterable<T>,
  token?: vscode.CancellationToken
): Promise<T[]> {
  const result: T[] = []
  for await (const value of values) {
    if (token?.isCancellationRequested) break
    result.push(value)
  }
  return result
}

async function cancellationCheckpoint(
  token: vscode.CancellationToken,
  index: number
): Promise<void> {
  if (token.isCancellationRequested || index % 1000 !== 0) return
  await new Promise<void>(resolve => setImmediate(resolve))
}

function summarizeBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const value = key(row)
    summary[value] = (summary[value] ?? 0) + 1
    return summary
  }, {})
}
