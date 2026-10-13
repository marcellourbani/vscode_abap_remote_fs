import * as vscode from "vscode"
import * as fs from "fs/promises"
import { getClient } from "../../adt/conections"
import { log } from "../../lib/logger"
import type { RepositoryObjectRecord } from "./types"
import { WorkflowStore } from "./workflowStore"

const URI_MAP_SCHEMA_VERSION = 1
const URI_MAP_STRATEGY = "suffix-wildcard-v1"
const SEARCH_RESULT_LIMIT = 200
const MAX_REPOSITORY_CONCURRENCY = 10

export interface PreparedRepositoryUri {
  objectType: string
  objectName: string
  adtType: string
  adtUri: string
}

interface RepositoryUriMapArtifact {
  schemaVersion: number
  strategy: string
  connectionId: string
  side: "source" | "target"
  updatedAt: string
  entries: Record<string, PreparedRepositoryUri>
  lastPreparation: {
    wildcardTerms: number
    skippedTerms: number
    cappedResponses: number
    failedSearches: number
  }
}

interface WildcardGroup {
  objectType: string
  pattern: string
  records: RepositoryObjectRecord[]
  parent?: WildcardGroup
}

interface AdtRepositorySearchResult {
  "adtcore:name"?: unknown
  "adtcore:type"?: unknown
  "adtcore:uri"?: unknown
}

export function repositoryUriMapKey(
  record: Pick<RepositoryObjectRecord, "objectType" | "objectName">
): string {
  return `${record.objectType.trim()}:${record.objectName.trim()}`.toUpperCase()
}

export function repositoryWildcardPattern(objectName: string): string | undefined {
  const normalized = objectName.trim().toUpperCase()
  if (normalized.length <= 3) return undefined
  const remove = normalized.length > 10 ? 5 : 3
  const prefix = normalized.slice(0, -remove)
  if (prefix.length <= 3) return undefined
  return `${prefix}*`
}

export class RepositoryUriPreparationService {
  constructor(private readonly store: WorkflowStore) {}

  async prepare(
    workflowId: string,
    side: "source" | "target",
    records: RepositoryObjectRecord[],
    concurrency: number,
    token: vscode.CancellationToken
  ): Promise<Map<string, PreparedRepositoryUri>> {
    const workflow = await this.store.get(workflowId)
    const connectionId = workflow[side].connectionId.toLowerCase()
    const artifactPath = this.store.artifactPath(workflow, "sources", side, "uri-map.json")
    const cached = await this.readArtifact(artifactPath, connectionId, side)
    const prepared = this.compatibleCachedEntries(records, cached)
    const groups = this.wildcardGroups(
      records.filter(record => !record.adtUri && !prepared.has(repositoryUriMapKey(record)))
    )
    const stats = {
      wildcardTerms: groups.length,
      skippedTerms: 0,
      cappedResponses: 0,
      failedSearches: 0
    }
    if (groups.length) {
      const client = getClient(connectionId)
      const recordsByType = new Map<string, RepositoryObjectRecord[]>()
      for (const record of records) {
        if (record.adtUri) continue
        const objectType = record.objectType.trim().toUpperCase()
        const typeRecords = recordsByType.get(objectType) ?? []
        typeRecords.push(record)
        recordsByType.set(objectType, typeRecords)
      }
      this.linkWildcardParents(groups)
      stats.wildcardTerms = 0
      await runWildcardSchedule(
        groups,
        Math.min(MAX_REPOSITORY_CONCURRENCY, Math.max(1, concurrency)),
        token,
        async group => {
          if (token.isCancellationRequested) return
          if (group.records.every(record => prepared.has(repositoryUriMapKey(record)))) {
            stats.skippedTerms++
            return
          }
          try {
            stats.wildcardTerms++
            const results = await client.searchObject(
              group.pattern,
              group.objectType,
              SEARCH_RESULT_LIMIT
            )
            if (results.length >= SEARCH_RESULT_LIMIT) stats.cappedResponses++
            this.collectExactMatches(recordsByType.get(group.objectType) ?? [], results, prepared)
          } catch {
            stats.failedSearches++
          }
        }
      )
    }
    await this.store.writeJson(artifactPath, {
      schemaVersion: URI_MAP_SCHEMA_VERSION,
      strategy: URI_MAP_STRATEGY,
      connectionId,
      side,
      updatedAt: new Date().toISOString(),
      entries: Object.fromEntries(prepared),
      lastPreparation: stats
    } satisfies RepositoryUriMapArtifact)
    log.info(
      `[repository comparison] Resolved ${prepared.size} ${side} object URI${prepared.size === 1 ? "" : "s"} for workflow ${workflowId} (${stats.wildcardTerms} wildcard searches, ${stats.skippedTerms} skipped, ${stats.cappedResponses} capped, ${stats.failedSearches} failed).`
    )
    return prepared
  }

  private compatibleCachedEntries(
    records: RepositoryObjectRecord[],
    artifact: RepositoryUriMapArtifact | undefined
  ): Map<string, PreparedRepositoryUri> {
    const prepared = new Map<string, PreparedRepositoryUri>()
    if (!artifact) return prepared
    for (const record of records) {
      const key = repositoryUriMapKey(record)
      const entry = artifact.entries[key]
      if (
        entry?.adtUri &&
        entry.objectName.trim().toUpperCase() === record.objectName.trim().toUpperCase() &&
        entry.objectType.trim().toUpperCase() === record.objectType.trim().toUpperCase() &&
        compatibleAdtType(record.objectType, entry.adtType)
      )
        prepared.set(key, entry)
    }
    return prepared
  }

  private wildcardGroups(records: RepositoryObjectRecord[]): WildcardGroup[] {
    const groups = new Map<string, WildcardGroup>()
    for (const record of records) {
      const pattern = repositoryWildcardPattern(record.objectName)
      if (!pattern) continue
      const objectType = record.objectType.trim().toUpperCase()
      const key = `${objectType}\0${pattern}`
      const group = groups.get(key) ?? { objectType, pattern, records: [] }
      group.records.push(record)
      groups.set(key, group)
    }
    return [...groups.values()].sort(
      (left, right) =>
        left.pattern.length - right.pattern.length || left.pattern.localeCompare(right.pattern)
    )
  }

  private linkWildcardParents(groups: WildcardGroup[]): void {
    for (const group of groups) {
      const prefix = group.pattern.slice(0, -1)
      group.parent = groups
        .filter(candidate => {
          const candidatePrefix = candidate.pattern.slice(0, -1)
          return (
            candidate.objectType === group.objectType &&
            candidatePrefix.length < prefix.length &&
            prefix.startsWith(candidatePrefix)
          )
        })
        .sort(
          (left, right) =>
            right.pattern.length - left.pattern.length || left.pattern.localeCompare(right.pattern)
        )[0]
    }
  }

  private collectExactMatches(
    records: readonly RepositoryObjectRecord[],
    results: readonly AdtRepositorySearchResult[],
    prepared: Map<string, PreparedRepositoryUri>
  ): void {
    const pending = new Map(
      records
        .filter(record => !record.adtUri && !prepared.has(repositoryUriMapKey(record)))
        .map(record => [record.objectName.trim().toUpperCase(), record])
    )
    const candidates = new Map<string, Map<string, PreparedRepositoryUri>>()
    for (const result of results) {
      const objectName = `${result["adtcore:name"] ?? ""}`.trim().toUpperCase()
      const record = pending.get(objectName)
      const adtType = `${result["adtcore:type"] ?? ""}`.trim()
      const adtUri = `${result["adtcore:uri"] ?? ""}`.trim()
      if (!record || !adtUri || !compatibleAdtType(record.objectType, adtType)) continue
      const key = repositoryUriMapKey(record)
      const byUri = candidates.get(key) ?? new Map<string, PreparedRepositoryUri>()
      byUri.set(adtUri, {
        objectType: record.objectType.trim().toUpperCase(),
        objectName: record.objectName.trim().toUpperCase(),
        adtType,
        adtUri
      })
      candidates.set(key, byUri)
    }
    for (const [key, byUri] of candidates)
      if (byUri.size === 1) prepared.set(key, [...byUri.values()][0])
  }

  private async readArtifact(
    filePath: string,
    connectionId: string,
    side: "source" | "target"
  ): Promise<RepositoryUriMapArtifact | undefined> {
    try {
      const artifact = JSON.parse(await fs.readFile(filePath, "utf8")) as RepositoryUriMapArtifact
      if (
        artifact.schemaVersion !== URI_MAP_SCHEMA_VERSION ||
        artifact.strategy !== URI_MAP_STRATEGY ||
        artifact.connectionId.toLowerCase() !== connectionId ||
        artifact.side !== side
      )
        return undefined
      return artifact
    } catch {
      return undefined
    }
  }
}

function compatibleAdtType(repositoryType: string, adtType: string): boolean {
  const expected = repositoryType.trim().toUpperCase()
  const actual = adtType.trim().toUpperCase()
  return actual === expected || actual.startsWith(`${expected}/`)
}

async function runPreparationPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

async function runWildcardSchedule(
  groups: readonly WildcardGroup[],
  limit: number,
  token: vscode.CancellationToken,
  worker: (group: WildcardGroup) => Promise<void>
): Promise<void> {
  const pending = new Set(groups)
  const completed = new Set<WildcardGroup>()
  const active = new Set<Promise<void>>()
  let failure: unknown

  while (pending.size || active.size) {
    if (!token.isCancellationRequested && failure === undefined) {
      while (active.size < limit) {
        const group = [...pending].find(item => !item.parent || completed.has(item.parent))
        if (!group) break
        pending.delete(group)
        let task: Promise<void>
        task = Promise.resolve()
          .then(() => worker(group))
          .then(
            () => {
              completed.add(group)
            },
            error => {
              failure ??= error
              completed.add(group)
            }
          )
          .then(() => {
            active.delete(task)
          })
        active.add(task)
      }
    }
    if (active.size) {
      await Promise.race(active)
      continue
    }
    if (token.isCancellationRequested || failure !== undefined || !pending.size) break
    throw new Error("Wildcard search dependency cycle")
  }
  if (active.size) await Promise.all(active)
  if (failure !== undefined) throw failure
}
