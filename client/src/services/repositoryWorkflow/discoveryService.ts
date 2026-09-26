import { getClient } from "../../adt/conections"
import { RepositoryCriteria, RepositoryObjectRecord } from "./types"

const MAX_DISCOVERY_ROWS = 10_000_000
export const MAX_ADT_SQL_LENGTH = 255
export const PACKAGE_DISCOVERY_SQL = "SELECT devclass, parentcl, namespace FROM tdevc"

export function tadirDiscoverySql(packagePatterns: string[], objectNamePattern?: string): string {
  const nameCondition = objectNamePattern ? `obj_name LIKE '${sqlPattern(objectNamePattern)}'` : ""
  const where = packagePatterns.length
    ? packagePatterns
        .map(packagePattern =>
          [nameCondition, sqlPackageCondition(packagePattern)].filter(Boolean).join(" AND ")
        )
        .join(" OR ")
    : nameCondition
  const sql =
    "SELECT pgmid, object, obj_name, devclass, srcsystem, author, component, " +
    `genflag, delflag, created_on FROM tadir WHERE ${where}`
  if (sql.length > MAX_ADT_SQL_LENGTH) {
    throw new Error(
      `The resolved package scope creates a ${sql.length}-character query, but ADT accepts at most ${MAX_ADT_SQL_LENGTH}. Shorten the package pattern or disable Include subpackages.`
    )
  }
  return sql
}

export interface PackageDiscoveryResult {
  packageName: string
  packageNames: string[]
  rows: RepositoryObjectRecord[]
  totalPackages: number
}

function text(row: Record<string, unknown>, name: string): string {
  return String(row[name] ?? "").trim()
}

function classify(
  record: Omit<RepositoryObjectRecord, "classification" | "classificationReason">,
  criteria: RepositoryCriteria
) {
  if (record.generated)
    return { classification: "generated" as const, classificationReason: "TADIR generated flag" }
  if (/^[ZY]/.test(record.objectName))
    return { classification: "custom" as const, classificationReason: "Z/Y object name" }
  if (/^[ZY]/.test(record.packageName))
    return { classification: "custom" as const, classificationReason: "Z/Y package" }
  if (criteria.packages.some(value => wildcard(value).test(record.packageName)))
    return { classification: "custom" as const, classificationReason: "Included package" }
  if (record.namespace && criteria.namespaces.includes(record.namespace))
    return { classification: "custom" as const, classificationReason: "Included namespace" }
  if (record.namespace)
    return { classification: "partner" as const, classificationReason: "Registered namespace" }
  if (record.originalSystem === "SAP")
    return { classification: "standard" as const, classificationReason: "SAP original system" }
  return { classification: "uncertain" as const, classificationReason: "Non-SAP ownership signal" }
}

export class RepositoryDiscoveryService {
  async *discoverPackages(
    connectionId: string,
    criteria: RepositoryCriteria,
    completedPackages: Set<string> = new Set()
  ): AsyncGenerator<PackageDiscoveryResult> {
    const client = getClient(connectionId)
    const packageResult = await client.runQuery(PACKAGE_DISCOVERY_SQL, 1_000_000, true)
    const packages = buildPackageIndex(packageResult.values ?? [])
    const objectNamePattern = criteria.includeNames[0]
    if (!criteria.includeSubpackages) {
      const checkpoint = `scope:${objectNamePattern || "*"}:${criteria.packages.join(",")}`
      if (completedPackages.has(checkpoint)) return
      const sql = tadirDiscoverySql(criteria.packages, objectNamePattern)
      const tadir = await client.runQuery(sql, MAX_DISCOVERY_ROWS, true)
      yield {
        packageName: checkpoint,
        packageNames: [checkpoint],
        rows: discoveryRows(tadir.values ?? [], criteria, packages, new Set()),
        totalPackages: criteria.packages.length
      }
      return
    }
    const selectedPackages = expandPackages(
      criteria.packages,
      packages,
      criteria.includeSubpackages
    )
    const pendingPackages = [...selectedPackages]
      .sort()
      .filter(packageName => !completedPackages.has(packageName))
    if (!pendingPackages.length) return
    for (const packageBatch of packageBatches(pendingPackages, criteria.includeNames[0])) {
      const sql = tadirDiscoverySql(packageBatch, objectNamePattern)
      let tadir
      try {
        tadir = await client.runQuery(sql, MAX_DISCOVERY_ROWS, true)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/only one select|boolean expression was expected/i.test(message)) {
          throw new Error(
            `ADT rejected the ${sql.length}-character discovery query for ${packageBatch.join(", ")}.`
          )
        }
        throw error
      }
      yield {
        packageName: packageBatch[0],
        packageNames: packageBatch,
        rows: discoveryRows(tadir.values ?? [], criteria, packages, selectedPackages),
        totalPackages: selectedPackages.size
      }
    }
  }
}

function discoveryRows(
  rows: Array<Record<string, unknown>>,
  criteria: RepositoryCriteria,
  packages: Map<string, { parent: string; namespace: string }>,
  selectedPackages: Set<string>
): RepositoryObjectRecord[] {
  const results: RepositoryObjectRecord[] = []
  for (const row of rows) {
    const packageName = text(row, "DEVCLASS")
    const base = {
      pgmid: text(row, "PGMID"),
      objectType: text(row, "OBJECT"),
      objectName: text(row, "OBJ_NAME"),
      packageName,
      originalSystem: text(row, "SRCSYSTEM"),
      author: text(row, "AUTHOR"),
      component: text(row, "COMPONENT"),
      namespace: packages.get(packageName)?.namespace || undefined,
      generated: text(row, "GENFLAG") === "X",
      deleted: text(row, "DELFLAG") === "X",
      createdOn: text(row, "CREATED_ON")
    }
    if (!matchesCriteria(base, criteria, selectedPackages)) continue
    results.push({ ...base, ...classify(base, criteria) })
  }
  return results
}

function packageBatches(packageNames: string[], objectNamePattern?: string): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  for (const packageName of packageNames) {
    const candidate = [...current, packageName]
    try {
      tadirDiscoverySql(candidate, objectNamePattern)
      current = candidate
    } catch {
      if (!current.length) tadirDiscoverySql([packageName], objectNamePattern)
      batches.push(current)
      current = [packageName]
    }
  }
  if (current.length) batches.push(current)
  return batches
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function sqlPattern(value: string): string {
  return sqlLiteral(value.toUpperCase()).replace(/\*/g, "%").replace(/\?/g, "_")
}

function sqlPackageCondition(value: string): string {
  return `devclass LIKE '${sqlPattern(value)}'`
}

function buildPackageIndex(rows: Array<Record<string, unknown>>) {
  return new Map(
    rows.map(row => [
      text(row, "DEVCLASS"),
      { parent: text(row, "PARENTCL"), namespace: text(row, "NAMESPACE") }
    ])
  )
}

function expandPackages(
  roots: string[],
  packages: Map<string, { parent: string; namespace: string }>,
  includeSubpackages: boolean
) {
  const patterns = roots.map(wildcard)
  const selected = new Set(
    [...packages.keys()].filter(packageName => patterns.some(pattern => pattern.test(packageName)))
  )
  if (!includeSubpackages) return selected
  let changed = true
  while (changed) {
    changed = false
    for (const [name, item] of packages)
      if (selected.has(item.parent) && !selected.has(name)) {
        selected.add(name)
        changed = true
      }
  }
  return selected
}

function matchesCriteria(
  record: Omit<RepositoryObjectRecord, "classification" | "classificationReason"> & {
    createdOn: string
  },
  criteria: RepositoryCriteria,
  packages: Set<string>
): boolean {
  if (
    criteria.includeNames.length &&
    !criteria.includeNames.some(value => wildcard(value).test(record.objectName))
  )
    return false
  if (criteria.excludeNames.some(value => wildcard(value).test(record.objectName))) return false
  if (packages.size && !packages.has(record.packageName)) return false
  if (!matchesSet(record.objectType, criteria.objectTypes)) return false
  if (!matchesSet(record.namespace || "", criteria.namespaces)) return false
  if (!matchesSet(record.author, criteria.authors)) return false
  if (!criteria.includeDeleted && record.deleted) return false
  if (!criteria.includeGenerated && record.generated) return false
  if (!criteria.includeTemporary && record.packageName === "$TMP") return false
  if (criteria.createdFrom && record.createdOn < criteria.createdFrom) return false
  if (criteria.createdTo && record.createdOn > criteria.createdTo) return false
  return true
}

function matchesSet(value: string, accepted: string[]): boolean {
  return !accepted.length || accepted.some(item => item.toUpperCase() === value.toUpperCase())
}

function wildcard(value: string): RegExp {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i")
}
