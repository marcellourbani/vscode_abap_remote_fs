import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { randomUUID } from "crypto"
import { isAbapFile } from "abapfs"
import { getClient, getOrCreateRoot } from "../../adt/conections"
import { resolveAbapResource } from "../abapResourceDownloadService"
import { verifyInactiveSource } from "../inactiveSourceVerification"
import {
  TransportIntentService,
  type ObjectSaveTransportChoice,
  type TransportIntentResult
} from "../transportIntentService"
import type {
  AssistedApplyPlan,
  AssistedApplyPlanItem,
  ObjectSnapshotManifest,
  SnapshotRepresentation,
  SourceComparisonRecord
} from "./types"
import {
  aggregateHash,
  listFiles,
  objectFolderId,
  WorkflowSnapshotService
} from "./snapshotService"
import { WorkflowStore } from "./workflowStore"

export interface AssistedApplySafety {
  safe: boolean
  autoSave: string
  chatSaveBeforeSend: boolean
}

export interface RepositoryObjectApplyResourceResult extends TransportIntentResult {
  resourcePath: string
  inactiveSourceVerified?: boolean
  sapSourceUri?: string
  sapObjectUri?: string
  sapActivationUri?: string
}

export interface RepositoryObjectApplyResult {
  attemptId: string
  objectKey: string
  status: "succeeded" | "partial" | "failed" | "timed-out" | "cancelled"
  transportRequest?: string
  inactiveSourceVerified: boolean
  resourceResults: RepositoryObjectApplyResourceResult[]
}

export function assistedApplySafety(scope?: vscode.ConfigurationScope): AssistedApplySafety {
  const autoSave = vscode.workspace.getConfiguration("files", scope).get<string>("autoSave", "off")
  const chatSaveBeforeSend = vscode.workspace
    .getConfiguration("chat")
    .get<boolean>("saveBeforeSend", false)
  return {
    safe: autoSave === "off" && !chatSaveBeforeSend,
    autoSave,
    chatSaveBeforeSend
  }
}

export class WorkflowAssistedApplyService {
  private readonly snapshots: WorkflowSnapshotService

  constructor(private readonly store: WorkflowStore) {
    this.snapshots = new WorkflowSnapshotService(store)
  }

  async prepare(
    workflowId: string,
    selectedKeys?: string[],
    comparisonBasis: SnapshotRepresentation = "formatted",
    token?: vscode.CancellationToken,
    onProgress?: (completed: number, total: number) => Promise<void>
  ): Promise<AssistedApplyPlan> {
    const workflow = await this.store.get(workflowId)
    const selected = selectedKeys ? new Set(selectedKeys) : undefined
    const comparisons: SourceComparisonRecord[] = []
    for await (const comparison of this.store.readJsonLines<SourceComparisonRecord>(
      this.store.artifactPath(workflow, "comparison", "source.jsonl")
    )) {
      if (token?.isCancellationRequested) throw new Error("Operation cancelled")
      if (!selected || selected.has(comparison.key)) comparisons.push(comparison)
    }

    await onProgress?.(0, comparisons.length)
    const manifests: [ObjectSnapshotManifest | undefined, ObjectSnapshotManifest | undefined][] =
      new Array(comparisons.length)
    let next = 0
    let read = 0
    await Promise.all(
      Array.from({ length: Math.min(32, comparisons.length) }, async () => {
        while (next < comparisons.length && !token?.isCancellationRequested) {
          const index = next++
          const id = objectFolderId(comparisons[index].key)
          manifests[index] = await Promise.all([
            readManifest(
              this.store.artifactPath(workflow, "sources", "source", "objects", id, "manifest.json")
            ),
            readManifest(
              this.store.artifactPath(workflow, "sources", "target", "objects", id, "manifest.json")
            )
          ])
          await onProgress?.(++read, comparisons.length)
        }
      })
    )

    const items: AssistedApplyPlanItem[] = []
    for (const [index, comparison] of comparisons.entries()) {
      if (token?.isCancellationRequested) throw new Error("Operation cancelled")
      const [source, target] = manifests[index]
      if (!source || !target) continue
      const reasons: string[] = []
      let relevant = true
      if (comparisonBasis === "raw") {
        if (comparison.status === "identical") {
          relevant = false
          reasons.push("No raw differences")
        }
      } else if (
        ["different", "identical"].includes(comparison.status) &&
        comparison.formattedIdentical === true
      ) {
        relevant = false
        reasons.push("No formatted differences")
      } else if (comparison.formattedIdentical !== false) {
        reasons.push(comparison.formattedError || "Formatted comparison is unavailable")
      }
      if (!["different", "identical"].includes(comparison.status))
        reasons.push(`Source status is ${comparison.status}`)
      if (source.status !== "complete" || target.status !== "complete")
        reasons.push("Both snapshots must be complete")
      if (comparison.added.length || comparison.removed.length)
        reasons.push("Resource topology differs; creation/deletion is not supported")
      if (source.record.generated || target.record.generated) reasons.push("Generated object")
      if (
        source.record.classification === "standard" ||
        target.record.classification === "standard"
      )
        reasons.push("Standard object")
      if (source.record.objectType !== target.record.objectType)
        reasons.push("Object type mismatch")
      items.push({
        key: comparison.key,
        sourceRecord: source.record,
        targetRecord: target.record,
        sourceHash: source.aggregateHash,
        targetHash: target.aggregateHash,
        relevant,
        eligible: relevant && reasons.length === 0,
        blockingReasons: reasons,
        transportRequest: "",
        transportCheckStatus: "not-checked",
        transportDescription: "",
        transportCheckedAt: undefined,
        transportCheckError: undefined
      })
    }
    if (token?.isCancellationRequested) throw new Error("Operation cancelled")
    const plan: AssistedApplyPlan = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      sourceConnectionId: workflow.source.connectionId,
      targetConnectionId: workflow.target.connectionId,
      comparisonBasis,
      items
    }
    await this.store.removeCopilotAssistedApplySelection(workflow)
    await this.store.writeJson(
      this.store.artifactPath(workflow, "assisted-apply", "plan.json"),
      plan
    )
    return plan
  }

  async openSource(workflowId: string, key: string): Promise<void> {
    const file = await this.selectChangedFile(workflowId, key)
    if (!file) return
    const sourceUri = await this.sourceUri(workflowId, file.item, file.relativePath)
    const document = await vscode.workspace.openTextDocument(sourceUri)
    await vscode.window.showTextDocument(document, { preview: true })
  }

  async openTarget(workflowId: string, key: string): Promise<void> {
    const file = await this.selectChangedFile(workflowId, key)
    if (!file) return
    const targetUri = await this.targetUri(workflowId, file.item, file.relativePath)
    const document = await vscode.workspace.openTextDocument(targetUri)
    await vscode.window.showTextDocument(document, { preview: true })
  }

  async openDiff(
    workflowId: string,
    key: string,
    representation: SnapshotRepresentation
  ): Promise<void> {
    const file = await this.selectSnapshotDiffFile(workflowId, key, representation)
    if (!file) return
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(file.sourcePath),
      vscode.Uri.file(file.targetPath),
      `${key}: source ↔ target (${representation})`,
      { preview: false }
    )
  }

  async stageInTargetEditor(workflowId: string, key: string): Promise<void> {
    await this.stage(workflowId, key)
  }

  async stageAndSaveForCopilot(
    workflowId: string,
    key: string,
    transportChoice: ObjectSaveTransportChoice,
    token: vscode.CancellationToken
  ): Promise<RepositoryObjectApplyResult> {
    const normalizedKey = key.trim().toUpperCase()
    await this.assertCopilotApplyAuthorized(workflowId, normalizedKey)
    const attemptId = randomUUID()
    const files = await this.changedFiles(workflowId, normalizedKey, true)
    const workflow = await this.store.get(workflowId)
    const item = files[0].item
    await this.store.appendAssistedApplyExecutionEvent(workflowId, {
      attemptId,
      objectKey: normalizedKey,
      stage: "apply",
      status: "started",
      transportChoiceType: transportChoice.type,
      sourceHash: item.sourceHash,
      targetHash: item.targetHash
    })
    try {
      await this.validateReviewedSnapshots(workflowId, normalizedKey, item)
      const prepared = await Promise.all(
        files.map(async file => {
          const targetUri = await this.targetUri(workflowId, file.item, file.relativePath)
          const document = await vscode.workspace.openTextDocument(targetUri)
          const safety = assistedApplySafety(document)
          if (!safety.safe)
            throw new Error(
              "Assisted apply is blocked until ABAP auto-save is off and chat.saveBeforeSend is false."
            )
          if (document.isDirty)
            throw new Error(
              `The target editor for ${file.relativePath} already has unsaved changes. Review or discard them first.`
            )
          return {
            ...file,
            targetUri,
            document,
            source: await fs.readFile(file.sourcePath, "utf8")
          }
        })
      )
      await this.assertCopilotApplyAuthorized(workflowId, normalizedKey)
      const resourceResults: RepositoryObjectApplyResourceResult[] = []
      let currentChoice = transportChoice
      for (const resource of prepared) {
        if (token.isCancellationRequested) {
          const cancelled = this.syntheticResourceResult(
            attemptId,
            resource.targetUri,
            resource.relativePath,
            "cancelled",
            "Operation cancelled before this resource was saved"
          )
          resourceResults.push(cancelled)
          await this.recordResourceResult(workflowId, normalizedKey, attemptId, cancelled)
          break
        }
        const result = await this.stageSaveAndVerifyResource(
          workflowId,
          normalizedKey,
          attemptId,
          workflow.target.connectionId,
          resource,
          currentChoice,
          token
        )
        resourceResults.push(result)
        if (result.status !== "succeeded") break
        if (currentChoice.type === "new" && result.transportRequest)
          currentChoice = { type: "existing", number: result.transportRequest }
      }
      const status = objectApplyStatus(resourceResults, prepared.length)
      const transportRequest = [...resourceResults]
        .reverse()
        .find(result => result.transportRequest)?.transportRequest
      const inactiveSourceVerified =
        resourceResults.length === prepared.length &&
        resourceResults.every(result => result.inactiveSourceVerified)
      await this.store.appendAssistedApplyExecutionEvent(workflowId, {
        attemptId,
        objectKey: normalizedKey,
        stage: "apply",
        status,
        transportRequest,
        sourceHash: item.sourceHash,
        targetHash: item.targetHash,
        inactiveSourceVerified,
        error: resourceResults.find(result => result.error)?.error
      })
      return {
        attemptId,
        objectKey: normalizedKey,
        status,
        transportRequest,
        inactiveSourceVerified,
        resourceResults
      }
    } catch (error) {
      await this.store.appendAssistedApplyExecutionEvent(workflowId, {
        attemptId,
        objectKey: normalizedKey,
        stage: "apply",
        status: "failed",
        sourceHash: item.sourceHash,
        targetHash: item.targetHash,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  private async stageSaveAndVerifyResource(
    workflowId: string,
    key: string,
    attemptId: string,
    targetConnectionId: string,
    resource: {
      relativePath: string
      targetUri: vscode.Uri
      document: vscode.TextDocument
      source: string
    },
    transportChoice: ObjectSaveTransportChoice,
    token: vscode.CancellationToken
  ): Promise<RepositoryObjectApplyResourceResult> {
    await this.store.appendAssistedApplyExecutionEvent(workflowId, {
      attemptId,
      objectKey: key,
      stage: "transport",
      status: "started",
      resourcePath: resource.relativePath,
      transportChoiceType: transportChoice.type
    })
    let intent
    try {
      intent = TransportIntentService.get().register({
        objectUri: resource.targetUri,
        process: "repository-assisted-apply",
        transportChoice,
        workflowId,
        objectKey: key
      })
    } catch (error) {
      const result = this.syntheticResourceResult(
        attemptId,
        resource.targetUri,
        resource.relativePath,
        "failed",
        error instanceof Error ? error.message : String(error)
      )
      await this.recordResourceResult(workflowId, key, attemptId, result)
      return result
    }

    const previousSource = resource.document.getText()
    const completion = TransportIntentService.get().waitForResult(intent.intentId, token, 60_000)
    let writeError: string | undefined
    try {
      if (resource.document.isDirty)
        throw new Error("The target editor has unsaved changes. Review or discard them first.")
      await vscode.workspace.fs.writeFile(resource.targetUri, Buffer.from(resource.source, "utf8"))
    } catch (error) {
      writeError = error instanceof Error ? error.message : String(error)
      TransportIntentService.get().fail(intent.intentId, error)
    }
    const intentResult = await completion
    const result: RepositoryObjectApplyResourceResult = {
      ...intentResult,
      ...(writeError ? { status: "failed" as const, error: writeError } : {}),
      resourcePath: resource.relativePath
    }
    await this.recordResourceResult(workflowId, key, attemptId, result)
    if (result.status !== "succeeded") return result

    await this.store.appendAssistedApplyExecutionEvent(workflowId, {
      attemptId,
      objectKey: key,
      stage: "verification",
      status: "started",
      resourcePath: resource.relativePath,
      intentId: result.intentId,
      transportRequest: result.transportRequest
    })
    try {
      const connectionId = targetConnectionId.toLowerCase()
      const root = await getOrCreateRoot(connectionId)
      const node = await root.getNodeAsync(resource.targetUri.path)
      if (!isAbapFile(node))
        throw new Error("Saved target resource could not be resolved for inactive verification")
      if (!node.object.structure) await node.object.loadStructure()
      const sourcePath = node.object.contentsPath()
      await verifyInactiveSource(
        () =>
          getClient(connectionId).statelessClone.getObjectSource(sourcePath, {
            version: "inactive"
          }),
        resource.source,
        previousSource
      )
      result.sapSourceUri = sourcePath
      result.sapObjectUri = node.object.path
      result.sapActivationUri = node.object.lockObject.path
      result.inactiveSourceVerified = true
      await this.store.appendAssistedApplyExecutionEvent(workflowId, {
        attemptId,
        objectKey: key,
        stage: "verification",
        status: "succeeded",
        resourcePath: resource.relativePath,
        intentId: result.intentId,
        transportRequest: result.transportRequest,
        inactiveSourceVerified: true
      })
      return result
    } catch (error) {
      const failed: RepositoryObjectApplyResourceResult = {
        ...result,
        status: "failed",
        inactiveSourceVerified: false,
        error: error instanceof Error ? error.message : String(error)
      }
      await this.store.appendAssistedApplyExecutionEvent(workflowId, {
        attemptId,
        objectKey: key,
        stage: "verification",
        status: "failed",
        resourcePath: resource.relativePath,
        intentId: result.intentId,
        transportRequest: result.transportRequest,
        inactiveSourceVerified: false,
        error: failed.error
      })
      return failed
    }
  }

  private syntheticResourceResult(
    attemptId: string,
    targetUri: vscode.Uri,
    resourcePath: string,
    status: "failed" | "cancelled",
    error: string
  ): RepositoryObjectApplyResourceResult {
    return {
      intentId: `not-armed:${attemptId}:${resourcePath}`,
      status,
      process: "repository-assisted-apply",
      objectUri: targetUri.toString(),
      resourcePath,
      error
    }
  }

  private async recordResourceResult(
    workflowId: string,
    key: string,
    attemptId: string,
    result: RepositoryObjectApplyResourceResult
  ): Promise<void> {
    const status = executionStatus(result.status)
    await this.store.appendAssistedApplyExecutionEvent(workflowId, {
      attemptId,
      objectKey: key,
      stage: "transport",
      status,
      resourcePath: result.resourcePath,
      intentId: result.intentId,
      transportRequest: result.transportRequest,
      error: result.error
    })
    await this.store.appendAssistedApplyExecutionEvent(workflowId, {
      attemptId,
      objectKey: key,
      stage: "save",
      status,
      resourcePath: result.resourcePath,
      intentId: result.intentId,
      transportRequest: result.transportRequest,
      error: result.error
    })
  }

  private async validateReviewedSnapshots(
    workflowId: string,
    key: string,
    item: AssistedApplyPlanItem
  ): Promise<void> {
    const workflow = await this.store.get(workflowId)
    const sourceRoot = this.store.artifactPath(
      workflow,
      "sources",
      "source",
      "objects",
      objectFolderId(key),
      "raw"
    )
    if (aggregateHash(await listFiles(sourceRoot)) !== item.sourceHash)
      throw new Error(
        "The local source snapshot changed since the assisted-apply plan was reviewed. Refresh the comparison."
      )
    const cancellation = new vscode.CancellationTokenSource()
    try {
      const records = await this.snapshots.selectedRecords(workflowId, [key])
      await this.snapshots.downloadSide(
        workflowId,
        "target",
        records.target,
        1,
        cancellation.token,
        async () => {},
        true
      )
    } finally {
      cancellation.dispose()
    }
    const currentTarget = await readManifest(
      this.store.artifactPath(
        workflow,
        "sources",
        "target",
        "objects",
        objectFolderId(key),
        "manifest.json"
      )
    )
    if (!currentTarget || currentTarget.aggregateHash !== item.targetHash)
      throw new Error(
        "Target changed since the assisted-apply plan was reviewed. Refresh the comparison."
      )
  }

  private async stage(workflowId: string, key: string): Promise<void> {
    const file = await this.selectChangedFile(workflowId, key, true)
    if (!file) return
    const workflow = await this.store.get(workflowId)
    const sourceRoot = this.store.artifactPath(
      workflow,
      "sources",
      "source",
      "objects",
      objectFolderId(key),
      "raw"
    )
    if (aggregateHash(await listFiles(sourceRoot)) !== file.item.sourceHash)
      throw new Error(
        "The local source snapshot changed since the assisted-apply plan was reviewed. Refresh the comparison."
      )
    const cancellation = new vscode.CancellationTokenSource()
    try {
      const records = await this.snapshots.selectedRecords(workflowId, [key])
      await this.snapshots.downloadSide(
        workflowId,
        "target",
        records.target,
        1,
        cancellation.token,
        async () => {},
        true
      )
    } finally {
      cancellation.dispose()
    }
    const currentTarget = await readManifest(
      this.store.artifactPath(
        workflow,
        "sources",
        "target",
        "objects",
        objectFolderId(key),
        "manifest.json"
      )
    )
    if (!currentTarget || currentTarget.aggregateHash !== file.item.targetHash)
      throw new Error(
        "Target changed since the assisted-apply plan was reviewed. Refresh the comparison."
      )

    const targetUri = await this.targetUri(workflowId, file.item, file.relativePath)
    const document = await vscode.workspace.openTextDocument(targetUri)
    const safety = assistedApplySafety(document)
    if (!safety.safe)
      throw new Error(
        "Assisted apply is blocked until ABAP auto-save is off and chat.saveBeforeSend is false."
      )
    if (document.isDirty)
      throw new Error(
        "The target editor already has unsaved changes. Review or discard them first."
      )

    const source = await fs.readFile(file.sourcePath, "utf8")
    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      targetUri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      source
    )
    let applied = false
    try {
      applied = await vscode.workspace.applyEdit(edit)
    } catch (error) {
      throw error
    }
    if (!applied) {
      throw new Error("VS Code could not stage the source in the target editor")
    }
    await vscode.window.showTextDocument(document, { preview: false })
    await vscode.window.showInformationMessage(
      "Source staged in the target editor only. Review it, then save manually and activate related objects together."
    )
  }

  private async assertCopilotApplyAuthorized(workflowId: string, key: string): Promise<void> {
    const workflow = await this.store.get(workflowId)
    if (workflow.assistedApplyMode !== "copilot" || !workflow.copilotAssistedApplyEnabledAt)
      throw new Error("Copilot-assisted apply is not enabled for this workflow")
    const selection = await this.store.getCopilotAssistedApplySelection(workflowId, workflow)
    if (!selection?.keys.includes(key))
      throw new Error(`${key} is not in the user-saved Copilot-assisted apply selection`)
    if (selection.completedKeys?.includes(key)) throw new Error(`${key} is already marked done`)
    if (selection.decisions?.[key] !== "as-is")
      throw new Error(`${key} must have an as-is Copilot decision before it can be saved`)
    if (!selection.decisionReasons?.[key]?.trim())
      throw new Error(`${key} must have a Copilot decision reason before it can be saved`)
  }

  private async selectChangedFile(workflowId: string, key: string, requireEligible = false) {
    const candidates = await this.changedFiles(workflowId, key, requireEligible)
    const relativePath =
      candidates.length === 1
        ? candidates[0].relativePath
        : await vscode.window.showQuickPick(
            candidates.map(candidate => candidate.relativePath),
            {
              title: `Select changed source for ${key}`,
              placeHolder: "Choose one source file to review or stage",
              ignoreFocusOut: true
            }
          )
    if (!relativePath) return undefined
    return candidates.find(candidate => candidate.relativePath === relativePath)
  }

  private async changedFiles(workflowId: string, key: string, requireEligible = false) {
    const workflow = await this.store.get(workflowId)
    const plan = (await readJson(
      this.store.artifactPath(workflow, "assisted-apply", "plan.json")
    )) as AssistedApplyPlan | undefined
    if (
      plan &&
      (plan.sourceConnectionId !== workflow.source.connectionId ||
        plan.targetConnectionId !== workflow.target.connectionId)
    )
      throw new Error("Assisted-apply plan systems do not match the workflow")
    const item = plan?.items.find(candidate => candidate.key === key)
    if (!item) throw new Error("Object is not present in the assisted-apply plan")
    if (requireEligible && !item.eligible)
      throw new Error(`Object cannot be staged: ${item.blockingReasons.join("; ")}`)

    let comparison: SourceComparisonRecord | undefined
    for await (const row of this.store.readJsonLines<SourceComparisonRecord>(
      this.store.artifactPath(workflow, "comparison", "source.jsonl")
    ))
      if (row.key === key) {
        comparison = row
        break
      }
    const manifest = await readManifest(
      this.store.artifactPath(
        workflow,
        "sources",
        "source",
        "objects",
        objectFolderId(key),
        "manifest.json"
      )
    )
    const textFiles = new Set(
      manifest?.files.filter(file => file.text).map(file => file.path) ?? []
    )
    const changedFiles =
      plan?.comparisonBasis === "formatted"
        ? (comparison?.formattedChanged ?? [])
        : (comparison?.rawChanged ?? comparison?.changed ?? [])
    const candidates = changedFiles.filter(file => textFiles.has(file))
    if (!candidates.length) throw new Error("No changed text source is available for this object")
    return candidates.map(relativePath => ({
      item,
      relativePath,
      sourcePath: this.store.artifactPath(
        workflow,
        "sources",
        "source",
        "objects",
        objectFolderId(key),
        "raw",
        relativePath
      )
    }))
  }

  private async selectSnapshotDiffFile(
    workflowId: string,
    key: string,
    representation: SnapshotRepresentation
  ) {
    const workflow = await this.store.get(workflowId)
    let comparison: SourceComparisonRecord | undefined
    for await (const row of this.store.readJsonLines<SourceComparisonRecord>(
      this.store.artifactPath(workflow, "comparison", "source.jsonl")
    ))
      if (row.key === key) {
        comparison = row
        break
      }
    if (!comparison) throw new Error("Object is not present in the source comparison")
    if (representation === "formatted" && comparison.formattedError)
      throw new Error(`Formatted comparison is unavailable: ${comparison.formattedError}`)
    const candidates =
      representation === "raw" ? comparison.changed : (comparison.formattedChanged ?? [])
    if (!candidates.length)
      throw new Error(`No changed ${representation} source is available for this object`)
    const relativePath =
      candidates.length === 1
        ? candidates[0]
        : await vscode.window.showQuickPick(candidates, {
            title: `Select changed ${representation} source for ${key}`,
            placeHolder: "Choose one source file to compare",
            ignoreFocusOut: true
          })
    if (!relativePath) return undefined
    return {
      relativePath,
      sourcePath: this.store.artifactPath(
        workflow,
        "sources",
        "source",
        "objects",
        objectFolderId(key),
        representation,
        relativePath
      ),
      targetPath: this.store.artifactPath(
        workflow,
        "sources",
        "target",
        "objects",
        objectFolderId(key),
        representation,
        relativePath
      )
    }
  }

  private async targetUri(
    workflowId: string,
    item: AssistedApplyPlanItem,
    relativePath: string
  ): Promise<vscode.Uri> {
    const workflow = await this.store.get(workflowId)
    return this.liveUri(workflow.target.connectionId, item.targetRecord, relativePath)
  }

  private async sourceUri(
    workflowId: string,
    item: AssistedApplyPlanItem,
    relativePath: string
  ): Promise<vscode.Uri> {
    const workflow = await this.store.get(workflowId)
    return this.liveUri(workflow.source.connectionId, item.sourceRecord, relativePath)
  }

  private async liveUri(
    connectionId: string,
    record: AssistedApplyPlanItem["sourceRecord"],
    relativePath: string
  ): Promise<vscode.Uri> {
    const root = await resolveAbapResource({
      source: record.adtUri || record.objectName,
      connectionId,
      objectType: record.adtType || record.objectType
    })
    const relative = relativePath === "resource" ? "" : relativePath.replace(/^resource\//, "")
    return relative ? vscode.Uri.joinPath(root, ...relative.split("/")) : root
  }
}

async function readManifest(filePath: string): Promise<ObjectSnapshotManifest | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as ObjectSnapshotManifest
  } catch {
    return undefined
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return undefined
  }
}

function executionStatus(
  status: TransportIntentResult["status"]
): "succeeded" | "failed" | "timed-out" | "cancelled" {
  if (status === "succeeded") return "succeeded"
  if (status === "timed-out") return "timed-out"
  if (status === "cancelled") return "cancelled"
  return "failed"
}

function objectApplyStatus(
  results: RepositoryObjectApplyResourceResult[],
  expectedResources: number
): RepositoryObjectApplyResult["status"] {
  if (
    results.length === expectedResources &&
    results.every(result => result.status === "succeeded" && result.inactiveSourceVerified)
  )
    return "succeeded"
  if (results.some(result => result.status === "succeeded")) return "partial"
  const last = results[results.length - 1]
  if (last?.status === "timed-out") return "timed-out"
  if (last?.status === "cancelled") return "cancelled"
  return "failed"
}
