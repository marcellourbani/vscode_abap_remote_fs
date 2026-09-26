import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { createHash } from "crypto"
import { diffLines } from "diff"
import { AbapResourceDownloadService, runPool } from "../abapResourceDownloadService"
import {
  DEFAULT_VERIFICATION_CONCURRENCY,
  ExistenceComparisonRecord,
  MAX_VERIFICATION_CONCURRENCY,
  ObjectSnapshotManifest,
  RepositoryObjectRecord,
  SnapshotFile,
  SourceComparisonRecord
} from "./types"
import { WorkflowStore } from "./workflowStore"

function objectFolderId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 20)
}

async function listFiles(root: string, current = root): Promise<SnapshotFile[]> {
  const result: SnapshotFile[] = []
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name)
    if (entry.isDirectory()) result.push(...(await listFiles(root, fullPath)))
    else if (entry.isFile()) {
      const content = await fs.readFile(fullPath)
      const text = !content.includes(0)
      const normalized = text
        ? Buffer.from(
            content
              .toString("utf8")
              .replace(/\r\n/g, "\n")
              .replace(/[ \t]+$/gm, ""),
            "utf8"
          )
        : content
      result.push({
        path: path.relative(root, fullPath).replace(/\\/g, "/"),
        bytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        normalizedSha256: createHash("sha256").update(normalized).digest("hex"),
        text
      })
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

function aggregateHash(files: SnapshotFile[]): string {
  const hash = createHash("sha256")
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\n`)
  return hash.digest("hex")
}

function normalizedAggregateHash(files: SnapshotFile[]): string {
  const hash = createHash("sha256")
  for (const file of files) hash.update(`${file.path}\0${file.normalizedSha256}\n`)
  return hash.digest("hex")
}

export interface SnapshotDownloadSummary {
  total: number
  complete: number
  partial: number
  failed: number
  cancelled: boolean
}

export class WorkflowSnapshotService {
  private readonly downloader = new AbapResourceDownloadService()

  constructor(private readonly store: WorkflowStore) {}

  async downloadSide(
    workflowId: string,
    side: "source" | "target",
    records: RepositoryObjectRecord[],
    concurrency: number,
    token: vscode.CancellationToken,
    onProgress: (
      completed: number,
      total: number,
      activity: "verified" | "downloading" | "downloaded"
    ) => Promise<void>,
    forceRefresh = false,
    verificationConcurrency = DEFAULT_VERIFICATION_CONCURRENCY
  ): Promise<SnapshotDownloadSummary> {
    const verification = await this.verifySide(
      workflowId,
      side,
      records,
      verificationConcurrency,
      token,
      onProgress,
      forceRefresh
    )
    if (token.isCancellationRequested)
      return {
        total: records.length,
        complete: verification.completed,
        partial: 0,
        failed: 0,
        cancelled: true
      }
    return await this.downloadPending(
      workflowId,
      side,
      verification.pending,
      records.length,
      verification.completed,
      concurrency,
      token,
      onProgress
    )
  }

  async verifySide(
    workflowId: string,
    side: "source" | "target",
    records: RepositoryObjectRecord[],
    concurrency: number,
    token: vscode.CancellationToken,
    onProgress: (
      completed: number,
      total: number,
      activity: "verified" | "downloading" | "downloaded"
    ) => Promise<void>,
    forceRefresh = false
  ): Promise<{ completed: number; pending: RepositoryObjectRecord[] }> {
    const workflow = await this.store.get(workflowId)
    let completed = 0
    const pending: RepositoryObjectRecord[] = []
    const boundedConcurrency = Math.min(MAX_VERIFICATION_CONCURRENCY, Math.max(1, concurrency))
    await runPool(records, boundedConcurrency, async record => {
      if (token.isCancellationRequested) return
      const key = `${record.pgmid}:${record.objectType}:${record.objectName}`.toUpperCase()
      const root = this.store.artifactPath(
        workflow,
        "sources",
        side,
        "objects",
        objectFolderId(key)
      )
      const manifestPath = path.join(root, "manifest.json")
      let verified = false
      if (!forceRefresh)
        try {
          const existing = JSON.parse(
            await fs.readFile(manifestPath, "utf8")
          ) as ObjectSnapshotManifest
          if (existing.status === "complete") {
            const files = await listFiles(path.join(root, "content"))
            if (aggregateHash(files) === existing.aggregateHash) verified = true
          }
        } catch {}
      if (verified) completed++
      else pending.push(record)
      if (verified) await onProgress(completed, records.length, "verified")
    })
    return { completed, pending }
  }

  async downloadPending(
    workflowId: string,
    side: "source" | "target",
    records: RepositoryObjectRecord[],
    total: number,
    initialCompleted: number,
    concurrency: number,
    token: vscode.CancellationToken,
    onProgress: (
      completed: number,
      total: number,
      activity: "verified" | "downloading" | "downloaded"
    ) => Promise<void>
  ): Promise<SnapshotDownloadSummary> {
    const workflow = await this.store.get(workflowId)
    let completed = initialCompleted
    let complete = initialCompleted
    let partial = 0
    let failed = 0
    await runPool(records, Math.min(10, Math.max(1, concurrency)), async record => {
      if (token.isCancellationRequested) return
      const key = `${record.pgmid}:${record.objectType}:${record.objectName}`.toUpperCase()
      const root = this.store.artifactPath(
        workflow,
        "sources",
        side,
        "objects",
        objectFolderId(key)
      )
      const manifestPath = path.join(root, "manifest.json")
      const startedAt = new Date().toISOString()
      await fs.rm(path.join(root, "content"), { recursive: true, force: true })
      let result
      await onProgress(completed, total, "downloading")
      try {
        result = await this.downloader.download({
          source: record.adtUri || record.objectName,
          connectionId: workflow[side].connectionId,
          objectType: record.adtType || record.objectType,
          target: vscode.Uri.file(path.join(root, "content", "resource")),
          overwrite: true,
          concurrency: 1,
          token
        })
      } catch (error) {
        result = {
          sourceUri: record.adtUri || record.objectName,
          targetPath: path.join(root, "content"),
          files: 0,
          folders: 0,
          skipped: 0,
          failures: [error instanceof Error ? error.message : String(error)],
          cancelled: token.isCancellationRequested
        }
      }
      const files = await listFiles(path.join(root, "content")).catch(() => [])
      const manifest: ObjectSnapshotManifest = {
        schemaVersion: 1,
        key,
        side,
        connectionId: workflow[side].connectionId,
        record,
        sourceUri: result.sourceUri,
        status:
          result.cancelled || result.failures.length
            ? files.length
              ? "partial"
              : "failed"
            : "complete",
        startedAt,
        completedAt: new Date().toISOString(),
        files,
        aggregateHash: aggregateHash(files),
        normalizedAggregateHash: normalizedAggregateHash(files),
        failures: result.failures
      }
      await this.store.writeJson(manifestPath, manifest)
      if (manifest.status === "complete") complete++
      else if (manifest.status === "partial") partial++
      else failed++
      completed++
      await onProgress(completed, total, "downloaded")
    })
    return {
      total,
      complete,
      partial,
      failed,
      cancelled: token.isCancellationRequested
    }
  }

  async compare(
    workflowId: string,
    keys: string[],
    onProgress?: (completed: number, total: number) => Promise<void>,
    token?: vscode.CancellationToken
  ): Promise<SourceComparisonRecord[]> {
    const workflow = await this.store.get(workflowId)
    const results: SourceComparisonRecord[] = []
    for (const key of keys) {
      if (token?.isCancellationRequested) break
      const id = objectFolderId(key)
      const source = await this.readManifest(
        this.store.artifactPath(workflow, "sources", "source", "objects", id, "manifest.json")
      )
      const target = await this.readManifest(
        this.store.artifactPath(workflow, "sources", "target", "objects", id, "manifest.json")
      )
      if (!source || !target) {
        results.push({
          key,
          status: source ? "target-missing" : target ? "source-missing" : "error",
          added: [],
          removed: [],
          changed: [],
          error: "Snapshot manifest missing"
        })
        await onProgress?.(results.length, keys.length)
        continue
      }
      const sourceFiles = new Map(source.files.map(file => [file.path, file]))
      const targetFiles = new Map(target.files.map(file => [file.path, file]))
      const sourcePaths = [...sourceFiles.keys()]
      const targetPaths = [...targetFiles.keys()]
      const added = sourcePaths.filter(file => !targetFiles.has(file))
      const removed = targetPaths.filter(file => !sourceFiles.has(file))
      const changed = sourcePaths.filter(
        file =>
          targetFiles.has(file) && targetFiles.get(file)?.sha256 !== sourceFiles.get(file)?.sha256
      )
      const lineCounts = await sourceLineCounts(
        this.store.artifactPath(workflow, "sources", "source", "objects", id, "content"),
        this.store.artifactPath(workflow, "sources", "target", "objects", id, "content"),
        sourceFiles,
        targetFiles
      )
      results.push({
        key,
        status:
          source.status !== "complete" || target.status !== "complete"
            ? "partial"
            : source.aggregateHash === target.aggregateHash
              ? "identical"
              : "different",
        sourceHash: source.aggregateHash,
        targetHash: target.aggregateHash,
        sourceNormalizedHash: source.normalizedAggregateHash,
        targetNormalizedHash: target.normalizedAggregateHash,
        normalizedIdentical: source.normalizedAggregateHash === target.normalizedAggregateHash,
        added,
        removed,
        changed,
        ...lineCounts,
        error:
          source.status !== "complete" || target.status !== "complete"
            ? [...source.failures, ...target.failures].join("; ") || "Snapshot is incomplete"
            : undefined
      })
      await onProgress?.(results.length, keys.length)
    }
    return results
  }

  async selectedRecords(workflowId: string, keys: string[]) {
    const workflow = await this.store.get(workflowId)
    const selected = new Set(keys)
    const records = {
      source: [] as RepositoryObjectRecord[],
      target: [] as RepositoryObjectRecord[]
    }
    for await (const row of this.store.readJsonLines<ExistenceComparisonRecord>(
      this.store.artifactPath(workflow, "comparison", "existence.jsonl")
    )) {
      if (!selected.has(row.key) || row.status !== "both") continue
      if (row.source) records.source.push(row.source)
      if (row.target) records.target.push(row.target)
    }
    return records
  }

  private async readManifest(filePath: string): Promise<ObjectSnapshotManifest | undefined> {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8")) as ObjectSnapshotManifest
    } catch {
      return undefined
    }
  }
}

async function sourceLineCounts(
  sourceRoot: string,
  targetRoot: string,
  sourceFiles: Map<string, SnapshotFile>,
  targetFiles: Map<string, SnapshotFile>
) {
  let linesAdded = 0
  let linesRemoved = 0
  let linesChanged = 0
  for (const filePath of new Set([...sourceFiles.keys(), ...targetFiles.keys()])) {
    const sourceFile = sourceFiles.get(filePath)
    const targetFile = targetFiles.get(filePath)
    if (!sourceFile?.text) {
      if (targetFile?.text) linesRemoved += await lineCount(path.join(targetRoot, filePath))
      continue
    }
    if (!targetFile?.text) {
      linesAdded += await lineCount(path.join(sourceRoot, filePath))
      continue
    }
    if (sourceFile.sha256 === targetFile.sha256) continue
    const source = await fs.readFile(path.join(sourceRoot, filePath), "utf8")
    const target = await fs.readFile(path.join(targetRoot, filePath), "utf8")
    const parts = diffLines(target, source)
    let hunkAdded = 0
    let hunkRemoved = 0
    const flushHunk = () => {
      linesChanged += Math.min(hunkAdded, hunkRemoved)
      linesAdded += Math.max(0, hunkAdded - hunkRemoved)
      linesRemoved += Math.max(0, hunkRemoved - hunkAdded)
      hunkAdded = 0
      hunkRemoved = 0
    }
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (part.added) hunkAdded += part.count || 0
      else if (part.removed) hunkRemoved += part.count || 0
      else flushHunk()
    }
    flushHunk()
  }
  return { linesAdded, linesRemoved, linesChanged }
}

async function lineCount(filePath: string): Promise<number> {
  const text = await fs.readFile(filePath, "utf8")
  return text ? text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) : 0
}

export { objectFolderId, listFiles, aggregateHash, normalizedAggregateHash }
