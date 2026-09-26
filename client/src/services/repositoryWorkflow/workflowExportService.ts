import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import * as vscode from "vscode"
import * as ExcelJS from "exceljs"

import {
  buildXlsx,
  EXCEL_MAX_DATA_ROWS,
  ExportColumn,
  streamCsv
} from "../structuredDataExportService"
import {
  ExistenceComparisonRecord,
  RepositoryWorkflow,
  SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES
} from "./types"
import { WorkflowStore } from "./workflowStore"

interface OutputDefinition {
  path: string[]
  columns: ExportColumn[]
  sheetName: string
}

const LAST_EXPORT_DIRECTORY_KEY = "abapfs.repositoryWorkflows.lastExportDirectory"

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
      { name: "selected", header: "Selected" },
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

const OUTPUT_FILE_LABELS: Record<string, string> = {
  sourceDiscovery: "src-inv",
  targetDiscovery: "tgt-inv",
  existenceComparison: "inv-compare",
  sourceComparison: "src-compare",
  assistedApplyPlan: "apply-plan",
  downloadErrors: "errors"
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
  constructor(
    private readonly store: WorkflowStore,
    private readonly globalState?: vscode.Memento
  ) {}

  async export(
    workflow: RepositoryWorkflow,
    output: string,
    type: "xlsx" | "csv",
    selectedKeys?: string[]
  ): Promise<string | undefined> {
    const definition = OUTPUTS[output]
    if (!definition) throw new Error(`Unknown workflow output: ${output}`)
    const rowCount = await this.countRows(workflow, output)
    if (type === "xlsx" && rowCount > EXCEL_MAX_DATA_ROWS)
      throw new Error(`XLSX is unavailable for ${rowCount.toLocaleString()} rows; export CSV`)

    const fileName = workflowExportFileName(workflow, output, type)
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(this.globalState?.get<string>(LAST_EXPORT_DIRECTORY_KEY) || homedir(), fileName)
      ),
      filters: type === "xlsx" ? { Excel: ["xlsx"] } : { CSV: ["csv"] }
    })
    if (!target) return
    await this.globalState?.update(LAST_EXPORT_DIRECTORY_KEY, path.dirname(target.fsPath))
    const selected = selectedKeys ? new Set(selectedKeys) : undefined
    if (type === "csv") {
      await streamCsv(target.fsPath, definition.columns, this.rows(workflow, output, selected))
    } else {
      const rows: Array<Record<string, unknown>> = []
      for await (const row of this.rows(workflow, output, selected)) rows.push(row)
      await vscode.workspace.fs.writeFile(
        target,
        await buildXlsx(definition.columns, rows, definition.sheetName)
      )
    }
    return target.fsPath
  }

  async importSourceSelection(workflow: RepositoryWorkflow) {
    const selected = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(homedir()),
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      title: "Import source-comparison selection",
      filters: { "Excel or CSV": ["xlsx", "csv"] }
    })
    const file = selected?.[0]
    if (!file) return undefined
    const workbook = new ExcelJS.Workbook()
    if (path.extname(file.fsPath).toLowerCase() === ".csv") await workbook.csv.readFile(file.fsPath)
    else await workbook.xlsx.readFile(file.fsPath)
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error("The selected workbook does not contain a worksheet")
    const columns = new Map<string, number>()
    sheet.getRow(1).eachCell((cell, column) => {
      columns.set(
        cell.text
          .trim()
          .replace(/^\uFEFF/, "")
          .toLowerCase(),
        column
      )
    })
    const selectedColumn = columns.get("selected")
    const keyColumn = columns.get("repository key")
    if (!selectedColumn || !keyColumn)
      throw new Error("The selection file must contain Selected and Repository Key columns")

    const requested = new Set<string>()
    let duplicates = 0
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || !selectedMarker(row.getCell(selectedColumn).text)) return
      const key = row.getCell(keyColumn).text.trim().toUpperCase()
      if (!key) return
      if (requested.has(key)) duplicates++
      requested.add(key)
    })

    const keys: string[] = []
    const found = new Set<string>()
    let unselectable = 0
    const excludedTypes = new Set<string>(SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES)
    for await (const row of this.store.readJsonLines<ExistenceComparisonRecord>(
      this.store.artifactPath(workflow, "comparison", "existence.jsonl")
    )) {
      if (!requested.has(row.key)) continue
      found.add(row.key)
      if (
        row.status === "both" &&
        row.source &&
        !excludedTypes.has(row.source.objectType.toUpperCase())
      )
        keys.push(row.key)
      else unselectable++
    }
    return {
      fileName: path.basename(file.fsPath),
      keys: keys.sort(),
      requested: requested.size,
      duplicates,
      unselectable,
      unknown: requested.size - found.size
    }
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
    output: string,
    selectedKeys?: ReadonlySet<string>
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
      yield workflowExportRow(output, row, selectedKeys)
  }
}

export function workflowExportFileName(
  workflow: RepositoryWorkflow,
  output: string,
  type: "xlsx" | "csv",
  now = new Date()
): string {
  const source = safeFileNamePart(workflow.source.connectionId.toUpperCase(), 40)
  const target = safeFileNamePart(workflow.target.connectionId.toUpperCase(), 40)
  const workflowName = safeFileNamePart(workflow.name, 48)
  const normalizedName = workflowName.toUpperCase()
  const relevantSystems =
    output === "sourceDiscovery"
      ? source
      : output === "targetDiscovery"
        ? target
        : normalizedName.includes(source) && normalizedName.includes(target)
          ? ""
          : `${source}-${target}`
  return (
    [
      workflowName,
      OUTPUT_FILE_LABELS[output] || safeFileNamePart(output, 40),
      relevantSystems,
      localTimestamp(now)
    ]
      .filter(Boolean)
      .join("_") + `.${type}`
  )
}

function safeFileNamePart(value: string, maxLength: number): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, maxLength) || "workflow"
  )
}

function localTimestamp(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}`
}

export function workflowExportRow(
  output: string,
  row: Record<string, any>,
  selectedKeys?: ReadonlySet<string>
): Record<string, unknown> {
  if (output === "existenceComparison") return existenceRow(row, selectedKeys)
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

function existenceRow(
  row: Record<string, any>,
  selectedKeys?: ReadonlySet<string>
): Record<string, unknown> {
  const source = row.source ?? {}
  const target = row.target ?? {}
  const selectable =
    row.status === "both" &&
    source.objectType &&
    !SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES.includes(source.objectType.toUpperCase())
  return {
    selected: selectable && selectedKeys?.has(row.key) ? "X" : "",
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

function selectedMarker(value: string): boolean {
  return ["x", "true", "1", "yes"].includes(value.trim().toLowerCase())
}
