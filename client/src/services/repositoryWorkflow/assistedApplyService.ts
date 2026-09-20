import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { resolveAbapResource } from "../abapResourceDownloadService"
import {
  AssistedApplyPlan,
  AssistedApplyPlanItem,
  ObjectSnapshotManifest,
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

  async prepare(workflowId: string, selectedKeys?: string[]): Promise<AssistedApplyPlan> {
    const workflow = await this.store.get(workflowId)
    const selected = selectedKeys ? new Set(selectedKeys) : undefined
    const comparisons: SourceComparisonRecord[] = []
    for await (const comparison of this.store.readJsonLines<SourceComparisonRecord>(
      this.store.artifactPath(workflow, "comparison", "source.jsonl")
    ))
      if (!selected || selected.has(comparison.key)) comparisons.push(comparison)

    const items: AssistedApplyPlanItem[] = []
    for (const comparison of comparisons) {
      const id = objectFolderId(comparison.key)
      const source = await readManifest(
        this.store.artifactPath(workflow, "sources", "source", "objects", id, "manifest.json")
      )
      const target = await readManifest(
        this.store.artifactPath(workflow, "sources", "target", "objects", id, "manifest.json")
      )
      if (!source || !target) continue
      const reasons: string[] = []
      if (comparison.status !== "different") reasons.push(`Source status is ${comparison.status}`)
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
        eligible: reasons.length === 0,
        blockingReasons: reasons
      })
    }
    const plan: AssistedApplyPlan = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourceConnectionId: workflow.source.connectionId,
      targetConnectionId: workflow.target.connectionId,
      items
    }
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

  async openDiff(workflowId: string, key: string): Promise<void> {
    const file = await this.selectChangedFile(workflowId, key)
    if (!file) return
    const targetUri = await this.targetUri(workflowId, file.item, file.relativePath)
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(file.sourcePath),
      targetUri,
      `${key}: source ↔ target`
    )
  }

  async stageInTargetEditor(workflowId: string, key: string): Promise<void> {
    const file = await this.selectChangedFile(workflowId, key, true)
    if (!file) return
    const workflow = await this.store.get(workflowId)
    const sourceRoot = this.store.artifactPath(
      workflow,
      "sources",
      "source",
      "objects",
      objectFolderId(key),
      "content"
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
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error("VS Code could not stage the source in the target editor")
    await vscode.window.showTextDocument(document, { preview: false })
    await vscode.window.showInformationMessage(
      "Source staged in the target editor only. Review it, then save manually and activate related objects together."
    )
  }

  private async selectChangedFile(workflowId: string, key: string, requireEligible = false) {
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
    const candidates = (comparison?.changed ?? []).filter(file => textFiles.has(file))
    if (!candidates.length) throw new Error("No changed text source is available for this object")
    const relativePath =
      candidates.length === 1
        ? candidates[0]
        : await vscode.window.showQuickPick(candidates, {
            title: `Select changed source for ${key}`,
            placeHolder: "Choose one source file to review or stage",
            ignoreFocusOut: true
          })
    if (!relativePath) return undefined
    return {
      item,
      relativePath,
      sourcePath: this.store.artifactPath(
        workflow,
        "sources",
        "source",
        "objects",
        objectFolderId(key),
        "content",
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
