import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import {
  buildXlsx,
  EXCEL_MAX_DATA_ROWS,
  ExportColumn,
  streamCsv
} from "../structuredDataExportService"
import { RepositoryWorkflow } from "./types"
import { WorkflowStore } from "./workflowStore"

interface OutputDefinition {
  path: string[]
  columns: ExportColumn[]
  sheetName: string
}

const OUTPUTS: Record<string, OutputDefinition> = {
  sourceDiscovery: {
    path: ["discovery", "source", "tadir.jsonl"],
    columns: objectColumns(),
    sheetName: "Source inventory"
  },
  targetDiscovery: {
    path: ["discovery", "target", "tadir.jsonl"],
    columns: objectColumns(),
    sheetName: "Target inventory"
  },
  existenceComparison: {
    path: ["comparison", "existence.jsonl"],
    columns: [
      { name: "repositoryKey", header: "Repository Key" },
      { name: "result", header: "Comparison Result" },
      { name: "objectName", header: "Object Name" },
      { name: "sourceObjectType", header: "Source Type" },
      { name: "targetObjectType", header: "Target Type" },
      { name: "sourcePackage", header: "Source Package" },
      { name: "targetPackage", header: "Target Package" },
      { name: "sourceOriginalSystem", header: "Source Original System" },
      { name: "targetOriginalSystem", header: "Target Original System" },
      { name: "sourceAuthor", header: "Source Author" },
      { name: "targetAuthor", header: "Target Author" },
      { name: "sourceClassification", header: "Source Classification" },
      { name: "targetClassification", header: "Target Classification" },
      { name: "error", header: "Error" }
    ],
    sheetName: "Inventory comparison"
  },
  sourceComparison: {
    path: ["comparison", "source.jsonl"],
    columns: [
      { name: "repositoryKey", header: "Repository Key" },
      { name: "objectName", header: "Object Name" },
      { name: "objectType", header: "Object Type" },
      { name: "status", header: "Comparison Status" },
      { name: "normalizedIdentical", header: "Equal Ignoring Formatting" },
      { name: "filesAddedCount", header: "Files Added" },
      { name: "filesRemovedCount", header: "Files Removed" },
      { name: "filesChangedCount", header: "Files Changed" },
      { name: "addedFiles", header: "Added File Paths" },
      { name: "removedFiles", header: "Removed File Paths" },
      { name: "changedFiles", header: "Changed File Paths" },
      { name: "linesAdded", header: "Lines Added" },
      { name: "linesRemoved", header: "Lines Removed" },
      { name: "linesChanged", header: "Lines Changed" },
      { name: "sourceHash", header: "Source Snapshot Hash" },
      { name: "targetHash", header: "Target Snapshot Hash" },
      { name: "error", header: "Error" }
    ],
    sheetName: "Source comparison"
  },
  assistedApplyPlan: {
    path: ["assisted-apply", "plan.json"],
    columns: [
      { name: "repositoryKey", header: "Repository Key" },
      { name: "objectName", header: "Object Name" },
      { name: "sourceObjectType", header: "Source Type" },
      { name: "targetObjectType", header: "Target Type" },
      { name: "sourcePackage", header: "Source Package" },
      { name: "targetPackage", header: "Target Package" },
      { name: "decision", header: "Assisted-Apply Decision" },
      { name: "blockingReasons", header: "Blocking Reasons" },
      { name: "sourceHash", header: "Source Snapshot Hash" },
      { name: "targetHash", header: "Target Snapshot Hash" }
    ],
    sheetName: "Assisted apply"
  },
  downloadErrors: {
    path: ["sources"],
    columns: [
      { name: "side", header: "System Side" },
      { name: "repositoryKey", header: "Repository Key" },
      { name: "status", header: "Download Status" },
      { name: "failures", header: "Failures" }
    ],
    sheetName: "Download errors"
  }
}

function objectColumns(): ExportColumn[] {
  return [
    { name: "pgmid", header: "Program ID" },
    { name: "objectType", header: "Object Type" },
    { name: "objectName", header: "Object Name" },
    { name: "packageName", header: "Package" },
    { name: "originalSystem", header: "Original System" },
    { name: "author", header: "Author" },
    { name: "component", header: "Software Component" },
    { name: "namespace", header: "Namespace" },
    { name: "generated", header: "Generated" },
    { name: "deleted", header: "Deleted" },
    { name: "classification", header: "Classification" },
    { name: "classificationReason", header: "Classification Details" },
    { name: "adtType", header: "ADT Type" },
    { name: "adtUri", header: "ADT URI" }
  ]
}

export class WorkflowExportService {
  constructor(private readonly store: WorkflowStore) {}

  async export(
    workflow: RepositoryWorkflow,
    output: string,
    type: "xlsx" | "csv"
  ): Promise<string | undefined> {
    const definition = OUTPUTS[output]
    if (!definition) throw new Error(`Unknown workflow output: ${output}`)
    const rowCount = await this.countRows(workflow, output)
    if (type === "xlsx" && rowCount > EXCEL_MAX_DATA_ROWS)
      throw new Error(`XLSX is unavailable for ${rowCount.toLocaleString()} rows; export CSV`)

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        this.store.artifactPath(workflow, "exports", `${output}.${type}`)
      ),
      filters: type === "xlsx" ? { Excel: ["xlsx"] } : { CSV: ["csv"] }
    })
    if (!target) return
    if (type === "csv") {
      await streamCsv(target.fsPath, definition.columns, this.rows(workflow, output))
    } else {
      const rows: Array<Record<string, unknown>> = []
      for await (const row of this.rows(workflow, output)) rows.push(row)
      await vscode.workspace.fs.writeFile(
        target,
        await buildXlsx(definition.columns, rows, definition.sheetName)
      )
    }
    return target.fsPath
  }

  async availability(workflow: RepositoryWorkflow, outputs = Object.keys(OUTPUTS)) {
    const result: Record<string, { rows: number; xlsx: boolean; csv: boolean }> = {}
    for (const name of outputs) {
      if (!OUTPUTS[name]) continue
      try {
        const rows = await this.countRows(workflow, name)
        result[name] = { rows, xlsx: rows <= EXCEL_MAX_DATA_ROWS, csv: true }
      } catch {
        result[name] = { rows: 0, xlsx: true, csv: true }
      }
    }
    return result
  }

  private async countRows(workflow: RepositoryWorkflow, output: string): Promise<number> {
    let count = 0
    for await (const _row of this.rows(workflow, output)) count++
    return count
  }

  private async *rows(
    workflow: RepositoryWorkflow,
    output: string
  ): AsyncGenerator<Record<string, unknown>> {
    const definition = OUTPUTS[output]
    if (output === "assistedApplyPlan") {
      const plan = JSON.parse(
        await fs.readFile(this.store.artifactPath(workflow, ...definition.path), "utf8")
      )
      for (const row of plan.items ?? []) yield workflowExportRow(output, row)
      return
    }
    if (output === "downloadErrors") {
      for (const side of ["source", "target"]) {
        const objectsPath = this.store.artifactPath(workflow, "sources", side, "objects")
        for (const directory of await fs.readdir(objectsPath).catch(() => [])) {
          try {
            const manifest = JSON.parse(
              await fs.readFile(path.join(objectsPath, directory, "manifest.json"), "utf8")
            )
            if (manifest.status !== "complete")
              yield workflowExportRow(output, {
                side,
                key: manifest.key,
                status: manifest.status,
                failures: manifest.failures
              })
          } catch {}
        }
      }
      return
    }
    const filePath = this.store.artifactPath(workflow, ...definition.path)
    for await (const row of this.store.readJsonLines<Record<string, unknown>>(filePath))
      yield workflowExportRow(output, row)
  }
}

export function workflowExportRow(
  output: string,
  row: Record<string, any>
): Record<string, unknown> {
  if (output === "existenceComparison") return existenceRow(row)
  if (output === "sourceComparison") return sourceComparisonRow(row)
  if (output === "assistedApplyPlan") return assistedApplyRow(row)
  if (output === "downloadErrors")
    return {
      side: row.side,
      repositoryKey: row.key,
      status: row.status,
      failures: list(row.failures)
    }
  return row
}

function existenceRow(row: Record<string, any>): Record<string, unknown> {
  const source = row.source ?? {}
  const target = row.target ?? {}
  return {
    repositoryKey: row.key,
    result: comparisonResult(row.status),
    objectName: source.objectName ?? target.objectName,
    sourceObjectType: source.objectType,
    targetObjectType: target.objectType,
    sourcePackage: source.packageName,
    targetPackage: target.packageName,
    sourceOriginalSystem: source.originalSystem,
    targetOriginalSystem: target.originalSystem,
    sourceAuthor: source.author,
    targetAuthor: target.author,
    sourceClassification: source.classification,
    targetClassification: target.classification,
    error: row.error
  }
}

function sourceComparisonRow(row: Record<string, any>): Record<string, unknown> {
  const key = keyParts(row.key)
  return {
    repositoryKey: row.key,
    objectName: key.objectName,
    objectType: key.objectType,
    status: row.status,
    normalizedIdentical: row.normalizedIdentical,
    filesAddedCount: row.added?.length ?? 0,
    filesRemovedCount: row.removed?.length ?? 0,
    filesChangedCount: row.changed?.length ?? 0,
    addedFiles: list(row.added),
    removedFiles: list(row.removed),
    changedFiles: list(row.changed),
    linesAdded: row.linesAdded,
    linesRemoved: row.linesRemoved,
    linesChanged: row.linesChanged,
    sourceHash: row.sourceHash,
    targetHash: row.targetHash,
    error: row.error
  }
}

function assistedApplyRow(row: Record<string, any>): Record<string, unknown> {
  const source = row.sourceRecord ?? {}
  const target = row.targetRecord ?? {}
  return {
    repositoryKey: row.key,
    objectName: source.objectName ?? target.objectName,
    sourceObjectType: source.objectType,
    targetObjectType: target.objectType,
    sourcePackage: source.packageName,
    targetPackage: target.packageName,
    decision: row.eligible ? "Ready" : "Blocked",
    blockingReasons: list(row.blockingReasons),
    sourceHash: row.sourceHash,
    targetHash: row.targetHash
  }
}

function keyParts(key: unknown) {
  const [, objectType = "", ...name] = String(key ?? "").split(":")
  return { objectType, objectName: name.join(":") }
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "")
}

function comparisonResult(status: unknown): string {
  const labels: Record<string, string> = {
    both: "Present on both",
    "source-only": "Source only",
    "target-only": "Target only",
    error: "Error"
  }
  return labels[String(status)] ?? String(status ?? "")
}
