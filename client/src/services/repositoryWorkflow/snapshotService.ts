import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { createHash } from "crypto"
import { diffLines } from "diff"
import { getClient, getOrCreateRoot } from "../../adt/conections"
import { log } from "../../lib/logger"
import {
  AbapResourceDownloadService,
  type AbapResourceDownloadResult,
  runPool
} from "../abapResourceDownloadService"
import { getSearchService } from "../abapSearchService"
import {
  DEFAULT_VERIFICATION_CONCURRENCY,
  type ClassMethodSnapshotMap,
  type ExistenceComparisonRecord,
  MAX_VERIFICATION_CONCURRENCY,
  type ObjectSnapshotManifest,
  type RepositoryObjectRecord,
  type SnapshotFile,
  type SourceComparisonRecord
} from "./types"
import { WorkflowStore } from "./workflowStore"
import { REPOSITORY_ABAP_FORMAT_VERSION } from "./abapSourceFormatter"
import { RepositoryFormatWorkerPool } from "./formatWorker"
import {
  type PreparedRepositoryUri,
  RepositoryUriPreparationService,
  repositoryUriMapKey
} from "./repositoryUriPreparationService"

const SNAPSHOT_SCHEMA_VERSION = 2

interface FormattingSnapshot {
  root: string
  side: "source" | "target"
  manifest: ObjectSnapshotManifest
}

export interface SourceComparisonOptions {
  sourceConcurrency?: number
  targetConcurrency?: number
  onPhase?: (phase: string, completed: number, total: number) => Promise<void>
}

async function runSnapshotPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  const errors: unknown[] = []
  await runPool(items, concurrency, async item => {
    if (errors.length) return
    try {
      await work(item)
    } catch (error) {
      errors.push(error)
    }
  })
  if (errors.length) throw errors[0]
}

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
        ? Buffer.from(normalizeTextForComparison(content.toString("utf8")), "utf8")
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

function compatibleRepositoryType(expectedType: string, actualType: string | undefined): boolean {
  const expected = expectedType.trim().toUpperCase()
  const actual = actualType?.trim().toUpperCase() ?? ""
  return actual === expected || actual.startsWith(`${expected}/`)
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
  private readonly uriPreparation: RepositoryUriPreparationService

  constructor(private readonly store: WorkflowStore) {
    this.uriPreparation = new RepositoryUriPreparationService(store)
  }

  async preparePendingUris(
    workflowId: string,
    side: "source" | "target",
    records: RepositoryObjectRecord[],
    concurrency: number,
    token: vscode.CancellationToken,
    onProgress?: (completed: number, total: number) => Promise<void>
  ): Promise<Map<string, PreparedRepositoryUri>> {
    return await this.uriPreparation.prepare(
      workflowId,
      side,
      records,
      concurrency,
      token,
      onProgress
    )
  }

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
          if (
            existing.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
            existing.status === "complete"
          ) {
            const files = await listFiles(path.join(root, "raw"))
            if (aggregateHash(files) === existing.aggregateHash) {
              verified = true
            }
          }
        } catch (error) {
          if (verified) throw error
        }
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
    ) => Promise<void>,
    preparedUris: ReadonlyMap<string, PreparedRepositoryUri> = new Map()
  ): Promise<SnapshotDownloadSummary> {
    const workflow = await this.store.get(workflowId)
    let completed = initialCompleted
    let complete = initialCompleted
    let partial = 0
    let failed = 0
    let directSearchWorkers = 0
    await runPool(records, Math.min(10, Math.max(1, concurrency)), async record => {
      if (token.isCancellationRequested) return
      const connectionId = workflow[side].connectionId.toLowerCase()
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
      await Promise.all([
        fs.rm(path.join(root, "raw"), { recursive: true, force: true }),
        fs.rm(path.join(root, "formatted"), { recursive: true, force: true }),
        fs.rm(path.join(root, "content"), { recursive: true, force: true })
      ])
      let result
      let adtUrl: string | undefined
      await onProgress(completed, total, "downloading")
      const prepared = record.adtUri ? undefined : preparedUris.get(repositoryUriMapKey(record))
      const download = (source: string) =>
        this.downloader.download({
          source,
          connectionId: workflow[side].connectionId,
          objectType: record.adtType || record.objectType,
          target: vscode.Uri.file(path.join(root, "raw", "resource")),
          overwrite: true,
          concurrency: 1,
          token
        })
      const downloadFromSearch = async () => {
        directSearchWorkers++
        adtUrl = await this.searchRepositoryObjectUrl(connectionId, record)
        return await download(await this.resolveKnownRepositoryUri(connectionId, adtUrl))
      }
      try {
        if (record.adtUri) {
          if (!record.adtUri.startsWith("adt://")) adtUrl = record.adtUri
          result = await download(await this.resolveKnownRepositoryUri(connectionId, record.adtUri))
        } else if (prepared) {
          adtUrl = prepared.adtUri
          result = await download(
            await this.resolveKnownRepositoryUri(connectionId, prepared.adtUri)
          )
        } else result = await downloadFromSearch()
      } catch (error) {
        if (prepared && !token.isCancellationRequested)
          try {
            await fs.rm(path.join(root, "raw"), { recursive: true, force: true })
            result = await downloadFromSearch()
          } catch (fallbackError) {
            result = failedDownload(record.objectName, root, fallbackError, token)
          }
        else result = failedDownload(record.adtUri || record.objectName, root, error, token)
      }
      const rawRoot = path.join(root, "raw")
      const files = await listFiles(rawRoot).catch(() => [])
      const manifest: ObjectSnapshotManifest = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        key,
        side,
        connectionId: workflow[side].connectionId,
        record:
          result.sourceUri.startsWith("adt://") && !result.failures.length
            ? {
                ...record,
                adtUri: result.sourceUri,
                adtType: prepared?.adtType || record.adtType
              }
            : record,
        sourceUri: result.sourceUri,
        adtUrl: result.failures.length ? undefined : adtUrl,
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
        formattedFiles: [],
        formattingState: "pending",
        formatterVersion: REPOSITORY_ABAP_FORMAT_VERSION,
        formattingFailures: [],
        failures: result.failures
      }
      await this.store.writeJson(manifestPath, manifest)
      if (manifest.status === "complete") complete++
      else if (manifest.status === "partial") partial++
      else failed++
      completed++
      await onProgress(completed, total, "downloaded")
    })
    log.info(
      `[repository comparison] ${directSearchWorkers} of ${records.length} ${side} download worker${records.length === 1 ? "" : "s"} resorted to direct object search for workflow ${workflowId}.`
    )
    return {
      total,
      complete,
      partial,
      failed,
      cancelled: token.isCancellationRequested
    }
  }

  private async searchRepositoryObjectUrl(
    connectionId: string,
    record: RepositoryObjectRecord
  ): Promise<string> {
    const objectType = record.adtType || record.objectType
    const results = await getSearchService(connectionId).searchObjects(
      record.objectName,
      [objectType],
      5
    )
    const exactByUri = new Map(
      (results ?? [])
        .filter(
          result =>
            result.name?.toUpperCase() === record.objectName.toUpperCase() &&
            compatibleRepositoryType(objectType, result.type)
        )
        .filter(result => result.uri)
        .map(result => [result.uri!, result])
    )
    if (exactByUri.size > 1)
      throw new Error(
        `Object ${record.objectName} (${objectType}) resolved ambiguously on ${connectionId}`
      )
    const exact = [...exactByUri.values()][0]
    if (!exact?.uri)
      throw new Error(`Object ${record.objectName} (${objectType}) not found on ${connectionId}`)
    return exact.uri
  }

  private async resolveKnownRepositoryUri(connectionId: string, source: string): Promise<string> {
    if (source.startsWith("adt://")) {
      const uri = vscode.Uri.parse(source)
      if (uri.authority.toLowerCase() === connectionId) return source
      throw new Error(`Repository URI ${source} does not belong to ${connectionId}`)
    }
    const root = await getOrCreateRoot(connectionId)
    const found = await root.findByAdtUri(source, false)
    if (!found?.path) throw new Error(`Cannot resolve ADT path ${source} on ${connectionId}`)
    return `adt://${connectionId}${found.path}`
  }

  async compare(
    workflowId: string,
    keys: string[],
    onProgress?: (completed: number, total: number) => Promise<void>,
    token?: vscode.CancellationToken,
    options: SourceComparisonOptions = {}
  ): Promise<SourceComparisonRecord[]> {
    const workflow = await this.store.get(workflowId)
    const results: SourceComparisonRecord[] = []
    const formatter = new RepositoryFormatWorkerPool()
    try {
      await this.prepareFormattedSnapshots(workflowId, keys, formatter, token, options)
      await options.onPhase?.("comparing", 0, keys.length)
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
        const rawIdentical =
          source.status === "complete" &&
          target.status === "complete" &&
          source.aggregateHash === target.aggregateHash
        const sourceFiles = new Map(source.files.map(file => [file.path, file]))
        const targetFiles = new Map(target.files.map(file => [file.path, file]))
        const raw = await compareFileSets(
          this.store.artifactPath(workflow, "sources", "source", "objects", id, "raw"),
          this.store.artifactPath(workflow, "sources", "target", "objects", id, "raw"),
          sourceFiles,
          targetFiles
        )
        const formattingFailures = rawIdentical
          ? []
          : [
              ...(source.formattingFailures ?? []).map(failure => `Source: ${failure}`),
              ...(target.formattingFailures ?? []).map(failure => `Target: ${failure}`)
            ]
        const formattedAvailable =
          !!source.formattedAggregateHash &&
          !!target.formattedAggregateHash &&
          formattingFailures.length === 0
        const formatted =
          !rawIdentical && formattedAvailable
            ? await compareFileSets(
                this.store.artifactPath(workflow, "sources", "source", "objects", id, "formatted"),
                this.store.artifactPath(workflow, "sources", "target", "objects", id, "formatted"),
                new Map((source.formattedFiles ?? []).map(file => [file.path, file])),
                new Map((target.formattedFiles ?? []).map(file => [file.path, file]))
              )
            : undefined
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
          sourceRawHash: source.aggregateHash,
          targetRawHash: target.aggregateHash,
          rawIdentical: source.aggregateHash === target.aggregateHash,
          sourceNormalizedHash: source.normalizedAggregateHash,
          targetNormalizedHash: target.normalizedAggregateHash,
          normalizedIdentical: source.normalizedAggregateHash === target.normalizedAggregateHash,
          sourceFormattedHash: source.formattedAggregateHash,
          targetFormattedHash: target.formattedAggregateHash,
          formattedIdentical: rawIdentical
            ? true
            : formattedAvailable
              ? source.formattedAggregateHash === target.formattedAggregateHash
              : undefined,
          added: raw.added,
          removed: raw.removed,
          changed: raw.changed,
          rawAdded: raw.added,
          rawRemoved: raw.removed,
          rawChanged: raw.changed,
          formattedAdded: formatted?.added ?? [],
          formattedRemoved: formatted?.removed ?? [],
          formattedChanged: formatted?.changed ?? [],
          sourceLines: raw.sourceLines,
          targetLines: raw.targetLines,
          linesAdded: raw.linesAdded,
          linesRemoved: raw.linesRemoved,
          linesChanged: raw.linesChanged,
          rawSourceLines: raw.sourceLines,
          rawTargetLines: raw.targetLines,
          rawLinesAdded: raw.linesAdded,
          rawLinesRemoved: raw.linesRemoved,
          rawLinesChanged: raw.linesChanged,
          formattedSourceLines: formatted?.sourceLines,
          formattedTargetLines: formatted?.targetLines,
          formattedLinesAdded: rawIdentical ? 0 : formatted?.linesAdded,
          formattedLinesRemoved: rawIdentical ? 0 : formatted?.linesRemoved,
          formattedLinesChanged: rawIdentical ? 0 : formatted?.linesChanged,
          formattedError:
            rawIdentical || formattedAvailable
              ? undefined
              : formattingFailures.join("; ") || "Formatted snapshot is unavailable",
          error:
            source.status !== "complete" || target.status !== "complete"
              ? [...source.failures, ...target.failures].join("; ") || "Snapshot is incomplete"
              : undefined
        })
        await onProgress?.(results.length, keys.length)
      }
      return results
    } finally {
      await formatter.dispose()
    }
  }

  private async prepareFormattedSnapshots(
    workflowId: string,
    keys: string[],
    formatter: RepositoryFormatWorkerPool,
    token: vscode.CancellationToken | undefined,
    options: SourceComparisonOptions
  ): Promise<void> {
    const workflow = await this.store.get(workflowId)
    const snapshots: FormattingSnapshot[] = []
    let scanned = 0
    await options.onPhase?.("scanning snapshots", 0, keys.length)
    await runSnapshotPool(keys, DEFAULT_VERIFICATION_CONCURRENCY, async key => {
      if (token?.isCancellationRequested) return
      const id = objectFolderId(key)
      const sourceRoot = this.store.artifactPath(workflow, "sources", "source", "objects", id)
      const targetRoot = this.store.artifactPath(workflow, "sources", "target", "objects", id)
      const [source, target] = await Promise.all([
        this.readManifest(path.join(sourceRoot, "manifest.json")),
        this.readManifest(path.join(targetRoot, "manifest.json"))
      ])
      if (
        source?.status === "complete" &&
        target?.status === "complete" &&
        source.aggregateHash !== target.aggregateHash
      )
        snapshots.push(
          { root: sourceRoot, side: "source", manifest: source },
          { root: targetRoot, side: "target", manifest: target }
        )
      await options.onPhase?.("scanning snapshots", ++scanned, keys.length)
    })
    if (token?.isCancellationRequested) return
    const pendingMaps = snapshots.filter(
      ({ manifest }) =>
        manifest.record.objectType === "CLAS" &&
        !manifest.classMethodMap &&
        manifest.formattingState === "pending"
    )
    let structuresDone = 0
    await options.onPhase?.("getting object structures", 0, pendingMaps.length)
    const sides = ["source", "target"] as const
    const structureResults = await Promise.allSettled(
      sides.map(side =>
        runSnapshotPool(
          pendingMaps.filter(snapshot => snapshot.side === side),
          Math.min(10, Math.max(1, options[`${side}Concurrency`] ?? 5)),
          async snapshot => {
            if (token?.isCancellationRequested) return
            try {
              snapshot.manifest.classMethodMap = await fetchClassMethodMap(snapshot.manifest)
            } catch (error) {
              if (token?.isCancellationRequested) return
              snapshot.manifest.formattingFailures = [
                `Class method ordering: ${error instanceof Error ? error.message : String(error)}`
              ]
              snapshot.manifest.formattedFiles = []
              snapshot.manifest.formattedAggregateHash = undefined
              snapshot.manifest.formatterVersion = REPOSITORY_ABAP_FORMAT_VERSION
              snapshot.manifest.formattingState = "complete"
            }
            await this.store.writeJson(path.join(snapshot.root, "manifest.json"), snapshot.manifest)
            await options.onPhase?.(
              "getting object structures",
              ++structuresDone,
              pendingMaps.length
            )
          }
        )
      )
    )
    const failedStructure = structureResults.find(result => result.status === "rejected")
    if (failedStructure?.status === "rejected") throw failedStructure.reason
    if (token?.isCancellationRequested) return
    let formattedDone = 0
    await options.onPhase?.("formatting", 0, snapshots.length)
    await runSnapshotPool(snapshots, 5, async snapshot => {
      if (token?.isCancellationRequested) return
      await this.ensureFormatted(snapshot.root, snapshot.manifest, formatter, token)
      if (!token?.isCancellationRequested)
        await options.onPhase?.("formatting", ++formattedDone, snapshots.length)
    })
  }

  private async ensureFormatted(
    root: string,
    manifest: ObjectSnapshotManifest,
    formatter: RepositoryFormatWorkerPool,
    token?: vscode.CancellationToken
  ): Promise<ObjectSnapshotManifest> {
    const formattedRoot = path.join(root, "formatted")
    if (
      manifest.formatterVersion === REPOSITORY_ABAP_FORMAT_VERSION &&
      manifest.formattingState !== "pending"
    ) {
      if (manifest.formattingFailures.length) return manifest
      const files = await listFiles(formattedRoot).catch(() => [])
      if (
        manifest.formattedAggregateHash &&
        aggregateHash(files) === manifest.formattedAggregateHash
      )
        return manifest
    }
    if (token?.isCancellationRequested) return manifest
    await fs.rm(formattedRoot, { recursive: true, force: true })
    const formatting = await formatSnapshot(
      path.join(root, "raw"),
      formattedRoot,
      manifest.files,
      manifest.sourceUri ?? "",
      formatter,
      token,
      manifest.record.objectType === "CLAS"
        ? {
            connectionId: manifest.connectionId.toLowerCase(),
            className: manifest.record.objectName,
            adtUrl: manifest.adtUrl,
            cachedMethodMap: manifest.classMethodMap,
            cacheOnly: !!manifest.classMethodMap || manifest.formattingState !== "pending"
          }
        : undefined
    )
    if (token?.isCancellationRequested) return manifest
    const updated: ObjectSnapshotManifest = {
      ...manifest,
      formattedFiles: formatting.files,
      formattedAggregateHash: formatting.failures.length
        ? undefined
        : aggregateHash(formatting.files),
      formatterVersion: REPOSITORY_ABAP_FORMAT_VERSION,
      formattingState: "complete",
      classMethodMap: formatting.classMethodMap,
      formattingFailures: formatting.failures
    }
    await this.store.writeJson(path.join(root, "manifest.json"), updated)
    return updated
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

function failedDownload(
  sourceUri: string,
  root: string,
  error: unknown,
  token: vscode.CancellationToken
): AbapResourceDownloadResult {
  return {
    sourceUri,
    targetPath: path.join(root, "raw"),
    files: 0,
    folders: 0,
    skipped: 0,
    failures: [error instanceof Error ? error.message : String(error)],
    cancelled: token.isCancellationRequested
  }
}

async function formatSnapshot(
  rawRoot: string,
  formattedRoot: string,
  files: SnapshotFile[],
  sourceUri: string,
  formatter: RepositoryFormatWorkerPool,
  token?: vscode.CancellationToken,
  globalClass?: {
    connectionId: string
    className: string
    adtUrl?: string
    cachedMethodMap?: ClassMethodSnapshotMap
    cacheOnly?: boolean
  }
): Promise<{ files: SnapshotFile[]; failures: string[]; classMethodMap?: ClassMethodSnapshotMap }> {
  const failures: string[] = []
  let methodOrder = globalClass?.cachedMethodMap
  if (globalClass) {
    try {
      if (globalClass.cacheOnly) {
        if (
          !methodOrder ||
          methodOrder.schemaVersion !== 1 ||
          methodOrder.rawHash !== aggregateHash(files) ||
          methodOrder.className !== globalClass.className ||
          methodOrder.connectionId !== globalClass.connectionId ||
          methodOrder.sourceUri !== sourceUri ||
          !files.some(file => file.path === methodOrder?.filePath && file.text)
        )
          throw new Error(
            "Cached ADT method map is missing or incompatible; explicitly refresh source to recreate it"
          )
      } else {
        methodOrder = await fetchClassMethodMap({
          connectionId: globalClass.connectionId,
          record: { objectName: globalClass.className },
          sourceUri,
          adtUrl: globalClass.adtUrl,
          files
        })
      }
    } catch (error) {
      return {
        files: [],
        failures: [
          `Class method ordering: ${error instanceof Error ? error.message : String(error)}`
        ]
      }
    }
  }
  for (const file of files) {
    if (token?.isCancellationRequested) break
    const sourcePath = path.join(rawRoot, file.path)
    const targetPath = path.join(formattedRoot, file.path)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    try {
      if (!file.text) {
        await fs.copyFile(sourcePath, targetPath)
        continue
      }
      const source = await fs.readFile(sourcePath, "utf8")
      if (!isAbapSource(file.path, sourceUri, files.length)) {
        await fs.writeFile(targetPath, normalizeTextForComparison(source), "utf8")
        continue
      }
      await fs.writeFile(
        targetPath,
        normalizeTextForComparison(
          await formatter.format(
            {
              fileName: formatFileName(file.path, sourceUri),
              source,
              methodMap: methodOrder?.filePath === file.path ? methodOrder : undefined
            },
            token
          )
        ),
        "utf8"
      )
    } catch (error) {
      failures.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    files: await listFiles(formattedRoot).catch(() => []),
    failures,
    classMethodMap: failures.length ? undefined : methodOrder
  }
}

async function fetchClassMethodMap(snapshot: {
  connectionId: string
  record: { objectName: string }
  sourceUri?: string
  adtUrl?: string
  files: SnapshotFile[]
}): Promise<ClassMethodSnapshotMap> {
  const connectionId = snapshot.connectionId.toLowerCase()
  if (!snapshot.adtUrl)
    throw new Error(
      "Class snapshot has no recorded ADT URL; refresh its source to download it again"
    )
  const objectUrl = snapshot.adtUrl.replace(/[?#].*$/, "").replace(/\/source\/main$/i, "")
  const filePath = classMainFilePath(snapshot.files)
  const client = getClient(connectionId).statelessClone
  // The download reads the inactive source when one exists, so ranges must come from the same version
  const structure = await client.objectStructure(objectUrl)
  const version = structure.metaData["adtcore:version"] === "inactive" ? "inactive" : "active"
  const elements = await client.objectStructureElements(objectUrl, version)
  return {
    schemaVersion: 1,
    className: snapshot.record.objectName,
    connectionId,
    sourceUri: snapshot.sourceUri ?? "",
    rawHash: aggregateHash(snapshot.files),
    filePath,
    sourceUrl: `${objectUrl}/source/main`,
    elements
  }
}

function classMainFilePath(files: SnapshotFile[]): string {
  const text = files.filter(file => file.text)
  if (text.length === 1 && text[0].path === "resource") return "resource"
  const mains = text.filter(file => /^resource\/[^/]+\.clas\.abap$/i.test(file.path))
  if (mains.length !== 1)
    throw new Error("Global class main source is missing from the raw snapshot")
  return mains[0].path
}

export function normalizeTextForComparison(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .join("\n")
    .replace(/\s+$/, "")
}

function isAbapSource(filePath: string, sourceUri: string, fileCount: number): boolean {
  if (filePath.toLowerCase().endsWith(".abap")) return true
  return fileCount === 1 && sourceUriPath(sourceUri).toLowerCase().endsWith(".abap")
}

function formatFileName(filePath: string, sourceUri: string): string {
  if (filePath.toLowerCase().endsWith(".abap")) return path.basename(filePath)
  const sourceName = path.posix.basename(sourceUriPath(sourceUri))
  return sourceName || path.basename(filePath)
}

function sourceUriPath(sourceUri: string): string {
  const withoutQuery = sourceUri.split(/[?#]/, 1)[0].replace(/\\/g, "/")
  try {
    return decodeURIComponent(withoutQuery)
  } catch {
    return withoutQuery
  }
}

async function compareFileSets(
  sourceRoot: string,
  targetRoot: string,
  sourceFiles: Map<string, SnapshotFile>,
  targetFiles: Map<string, SnapshotFile>
) {
  const sourcePaths = [...sourceFiles.keys()]
  const targetPaths = [...targetFiles.keys()]
  const added = sourcePaths.filter(file => !targetFiles.has(file))
  const removed = targetPaths.filter(file => !sourceFiles.has(file))
  const changed = sourcePaths.filter(
    file => targetFiles.has(file) && targetFiles.get(file)?.sha256 !== sourceFiles.get(file)?.sha256
  )
  let sourceLines = 0
  let targetLines = 0
  let linesAdded = 0
  let linesRemoved = 0
  let linesChanged = 0
  for (const filePath of new Set([...sourceFiles.keys(), ...targetFiles.keys()])) {
    const sourceFile = sourceFiles.get(filePath)
    const targetFile = targetFiles.get(filePath)
    const sourceLineCount = sourceFile?.text ? await lineCount(path.join(sourceRoot, filePath)) : 0
    const targetLineCount = targetFile?.text ? await lineCount(path.join(targetRoot, filePath)) : 0
    sourceLines += sourceLineCount
    targetLines += targetLineCount
    if (!sourceFile?.text) {
      linesRemoved += targetLineCount
      continue
    }
    if (!targetFile?.text) {
      linesAdded += sourceLineCount
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
  return {
    added,
    removed,
    changed,
    sourceLines,
    targetLines,
    linesAdded,
    linesRemoved,
    linesChanged
  }
}

async function lineCount(filePath: string): Promise<number> {
  const text = await fs.readFile(filePath, "utf8")
  return text ? text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) : 0
}

export { objectFolderId, listFiles, aggregateHash, normalizedAggregateHash }
