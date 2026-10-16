import * as fs from "fs/promises"
import type * as vscode from "vscode"
import { runPool } from "../abapResourceDownloadService"
import { getAbapObjectTransportStatus } from "../objectTransportStatusService"
import type { AssistedApplyPlan, ObjectSnapshotManifest, ObjectTransportCheckStatus } from "./types"
import { objectFolderId } from "./snapshotService"
import { WorkflowStore } from "./workflowStore"

export interface TransportCheckResult {
  total: number
  completed: number
  failed: number
  cancelled: boolean
}

export class WorkflowTransportCheckService {
  constructor(private readonly store: WorkflowStore) {}

  async determine(
    workflowId: string,
    keys: string[],
    concurrency: number,
    token: vscode.CancellationToken,
    onProgress: (completed: number, total: number) => Promise<void>
  ): Promise<TransportCheckResult> {
    const workflow = await this.store.get(workflowId)
    const planPath = this.store.artifactPath(workflow, "assisted-apply", "plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as AssistedApplyPlan
    const items = new Map(plan.items.map(item => [item.key, item]))
    const selected = [...new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean))]
    if (!selected.length) throw new Error("Select at least one assisted-apply object")
    const invalid = selected.filter(key => !items.get(key)?.eligible)
    if (invalid.length)
      throw new Error(
        `${invalid.length.toLocaleString()} selected object${invalid.length === 1 ? " is" : "s are"} not eligible for assisted apply`
      )
    let completed = 0
    let failed = 0
    let persistQueue = Promise.resolve()
    await runPool(selected, Math.min(10, Math.max(1, concurrency)), async key => {
      if (token.isCancellationRequested) return
      const item = items.get(key)!
      try {
        const manifest = await this.targetManifest(workflow, key)
        const result = await getAbapObjectTransportStatus({
          connectionId: workflow.target.connectionId,
          source: manifest?.sourceUri ?? item.targetRecord.adtUri ?? item.targetRecord.objectName,
          objectType: item.targetRecord.adtType ?? item.targetRecord.objectType,
          packageName: item.targetRecord.packageName
        })
        item.transportCheckStatus = result.status
        item.transportRequest = result.transportRequest
        item.transportDescription = result.transportDescription
        item.transportCheckedAt = result.checkedAt
        item.transportCheckError = result.transportCheckError
      } catch (error) {
        failed++
        item.transportCheckStatus = "error"
        item.transportRequest = ""
        item.transportDescription = ""
        item.transportCheckedAt = new Date().toISOString()
        item.transportCheckError = error instanceof Error ? error.message : String(error)
      }
      completed++
      persistQueue = persistQueue.then(() => this.store.writeJson(planPath, plan))
      await persistQueue
      await onProgress(completed, selected.length)
    })
    await persistQueue
    return {
      total: selected.length,
      completed,
      failed,
      cancelled: token.isCancellationRequested
    }
  }

  private async targetManifest(
    workflow: Awaited<ReturnType<WorkflowStore["get"]>>,
    key: string
  ): Promise<ObjectSnapshotManifest | undefined> {
    try {
      return JSON.parse(
        await fs.readFile(
          this.store.artifactPath(
            workflow,
            "sources",
            "target",
            "objects",
            objectFolderId(key),
            "manifest.json"
          ),
          "utf8"
        )
      ) as ObjectSnapshotManifest
    } catch {
      return undefined
    }
  }
}

export function transportCheckLabel(
  status: ObjectTransportCheckStatus | undefined,
  request: string
): string {
  if (status === "locked") return request
  if (status === "not-locked") return "No transport lock"
  if (status === "local") return "Local object"
  if (status === "error") return "Check failed"
  return "Not checked"
}
