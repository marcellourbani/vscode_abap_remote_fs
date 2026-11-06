import { getClient } from "../../adt/conections"
import { AdtRelationApi, type RelationObject } from "../../adt/relationApi"
import { getSearchService } from "../abapSearchService"
import { normalizeUsageReferences } from "../whereUsedReferences"
import { getOptimalObjectURI } from "../lm-tools/shared"
import { countedQuery, sqlLiteral, abortIfNeeded } from "./query"
import { objectKey, inventoryKey } from "./analysis"
import type {
  DependencyEdge,
  DependencyResult,
  InventoryObject,
  JobOptions,
  UsageAnalysis
} from "./types"
import { collectLatestJobs } from "./jobs"

type MappingSnapshot = Pick<UsageAnalysis, "transactions" | "functions"> & {
  completedFunctionMappings: string[]
  completedTransactionPrefixes: string[]
}

const patternRegex = (value: string) =>
  new RegExp(
    `^${value
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i"
  )
const unsupported = (error: unknown) =>
  /404|405|501|does not exist|not supported|not implemented/i.test(String(error))
export const isUnsupportedRelations = unsupported
const likeCondition = (field: string, pattern: string) => {
  const escaped = pattern
    .replace(/[!_%]/g, character => `!${character}`)
    .replace(/\*/g, "%")
    .replace(/\?/g, "_")
  return `${field} LIKE ${sqlLiteral(escaped)}${/[!_%]/.test(pattern) ? " ESCAPE '!'" : ""}`
}
const namePrefixes = (names: string[]) => [
  ...new Set(
    names
      .map(name => name.trim().toUpperCase())
      .filter(Boolean)
      .map(name => (name.startsWith("/") ? name.match(/^\/[^/]+\//)?.[0] || "/" : name[0]))
  )
]

export class UsageSap {
  private readonly resolved = new Map<string, RelationObject>()

  async packages(
    connection: string,
    patterns: string[],
    subpackages: boolean,
    signal: AbortSignal
  ) {
    if (
      !patterns.length ||
      patterns.some(pattern => !pattern.trim() || ["*", "/*"].includes(pattern))
    )
      throw new Error("Choose bounded package patterns")
    if (!subpackages) {
      const where = [...new Set(patterns.map(pattern => pattern.trim().toUpperCase()))]
        .map(pattern => likeCondition("devclass", pattern))
        .join(" OR ")
      const rows = await countedQuery(getClient(connection), "tdevc", ["devclass"], where, signal)
      return [...new Set(rows.map(row => row.DEVCLASS))].sort()
    }
    const rows = await countedQuery(
      getClient(connection),
      "tdevc",
      ["devclass", "parentcl"],
      "",
      signal
    )
    const matchers = patterns.map(patternRegex)
    const selected = new Set(
      rows
        .filter(row => matchers.some(pattern => pattern.test(row.DEVCLASS)))
        .map(row => row.DEVCLASS)
    )
    const children = new Map<string, string[]>()
    for (const row of rows) {
      const siblings = children.get(row.PARENTCL)
      if (siblings) siblings.push(row.DEVCLASS)
      else children.set(row.PARENTCL, [row.DEVCLASS])
    }
    const queue = [...selected]
    for (let index = 0; index < queue.length; index++) {
      for (const child of children.get(queue[index]) || []) {
        if (selected.has(child)) continue
        selected.add(child)
        queue.push(child)
      }
    }
    return [...selected].sort()
  }

  async inventory(
    connection: string,
    packageName: string,
    signal: AbortSignal
  ): Promise<InventoryObject[]> {
    const rows = await countedQuery(
      getClient(connection),
      "tadir",
      ["pgmid", "object", "obj_name", "devclass"],
      `devclass = ${sqlLiteral(packageName)}`,
      signal
    )
    return rows.map(row => ({
      pgmid: row.PGMID,
      objectType: row.OBJECT,
      objectName: row.OBJ_NAME,
      packageName: row.DEVCLASS
    }))
  }

  async functionModules(
    connection: string,
    groups: InventoryObject[],
    signal: AbortSignal
  ): Promise<InventoryObject[]> {
    if (!groups.length) return []
    if (groups.some(group => group.objectType !== "FUGR" || !group.objectName.trim()))
      throw new Error("Choose function groups to list their function modules")
    const prefixes = [...new Set(groups.map(group => group.objectName[0]))]
    if (prefixes.length !== 1)
      throw new Error("Choose function groups with the same first character")
    const byName = new Map(groups.map(group => [group.objectName, group]))
    const rows = await countedQuery(
      getClient(connection),
      "enlfdir",
      ["area", "funcname"],
      likeCondition("area", prefixes[0] + "*"),
      signal
    )
    return rows.flatMap(row => {
      const group = byName.get(row.AREA)
      return group
        ? [
            {
              pgmid: "LIMU",
              objectType: "FUNC",
              objectName: row.FUNCNAME,
              packageName: group.packageName,
              functionGroup: group.objectName
            }
          ]
        : []
    })
  }

  async mappings(
    state: UsageAnalysis,
    signal: AbortSignal,
    request: {
      transactionNames: string[]
      functionNames: string[]
      resume?: boolean
      checkpoint?: (snapshot: MappingSnapshot, activity: string) => Promise<void>
    }
  ) {
    abortIfNeeded(signal)
    const transactionPrefixes = namePrefixes(
      request.transactionNames.filter(name => !/[*?%]/.test(name))
    )
    const completedPrefixes = new Set(
      request.resume ? state.completedTransactionPrefixes || [] : []
    )
    const transactions = new Map(
      state.transactions
        .filter(
          item =>
            !transactionPrefixes.some(
              prefix =>
                !completedPrefixes.has(prefix) &&
                (item.transaction.startsWith(prefix) || item.program.startsWith(prefix))
            )
        )
        .map(item => [item.transaction, item])
    )
    const groups = state.inventory.filter(row => row.objectType === "FUGR")
    const groupNames = new Set(groups.map(group => group.objectName))
    const inventoryFunctions = new Set(
      state.inventory.filter(row => row.objectType === "FUNC").map(row => row.objectName)
    )
    const functions = new Map(
      state.functions
        .filter(item => groupNames.has(item.group) || inventoryFunctions.has(item.name))
        .map(item => [item.name, item])
    )
    const completedMappings = new Set(state.completedFunctionMappings || [])
    const completedGroups = new Set([
      ...(state.completedFunctionGroups || []),
      ...completedMappings
    ])
    for (const row of state.inventory)
      if (row.objectType === "FUNC" && row.functionGroup)
        functions.set(row.objectName, { name: row.objectName, group: row.functionGroup })
    const snapshot = (): MappingSnapshot => ({
      transactions: [...transactions.values()],
      functions: [...functions.values()],
      completedFunctionMappings: [...completedMappings],
      completedTransactionPrefixes: [...completedPrefixes]
    })
    const client = getClient(state.connectionId)
    for (const prefix of transactionPrefixes) {
      if (completedPrefixes.has(prefix)) continue
      for (const row of await countedQuery(
        client,
        "tstc",
        ["tcode", "pgmna"],
        `${likeCondition("tcode", prefix + "*")} OR ${likeCondition("pgmna", prefix + "*")}`,
        signal
      )) {
        transactions.set(row.TCODE, { transaction: row.TCODE, program: row.PGMNA })
      }
      completedPrefixes.add(prefix)
      await request.checkpoint?.(snapshot(), `Resolved transaction mappings: ${prefix}*`)
      abortIfNeeded(signal)
    }
    const missingFunctions = request.functionNames
      .map(name => name.trim().toUpperCase())
      .filter(name => name && !/[*?%]/.test(name) && !functions.has(name))
    if (missingFunctions.length) {
      const batches = new Map<string, InventoryObject[]>()
      for (const group of groups) {
        if (completedGroups.has(inventoryKey(group))) continue
        const prefix = group.objectName[0]
        const batch = batches.get(prefix)
        if (batch) batch.push(group)
        else batches.set(prefix, [group])
      }
      for (const batch of batches.values()) {
        const modules = await this.functionModules(state.connectionId, batch, signal)
        for (const module of modules)
          functions.set(module.objectName, {
            name: module.objectName,
            group: module.functionGroup!
          })
        batch.forEach(group => completedMappings.add(inventoryKey(group)))
        await request.checkpoint?.(
          snapshot(),
          `Resolved function-group ownership: ${batch[0].objectName[0]}*`
        )
        abortIfNeeded(signal)
      }
    }
    return snapshot()
  }

  async jobs(
    connection: string,
    from: string,
    to: string,
    signal: AbortSignal,
    progress: (done: number, total: number) => Promise<void>,
    options: JobOptions = {}
  ) {
    return collectLatestJobs(getClient(connection), from, to, signal, progress, options)
  }

  async resolve(connection: string, key: string, signal: AbortSignal): Promise<RelationObject> {
    abortIfNeeded(signal)
    const cacheKey = `${connection}:${key}`
    if (this.resolved.has(cacheKey)) return this.resolved.get(cacheKey)!
    const [, type, name] = key.split(":")
    const results = await getSearchService(connection).searchObjects(
      name,
      [type === "FUNC" ? "FUNC" : type],
      100
    )
    abortIfNeeded(signal)
    const exact = results.filter(
      row =>
        row.name.trim().toUpperCase() === name &&
        (type === "FUNC" ? row.type === "FUGR/FF" : row.type.split("/")[0] === type)
    )
    if (exact.length !== 1 || !exact[0].uri)
      throw new Error(`Cannot uniquely resolve ${key} on the dependency system`)
    const row = exact[0]
    const uri = exact[0].uri
    const value: RelationObject = {
      id: uri,
      uri,
      name,
      type: row.type,
      displayName: name,
      properties: [],
      links: []
    }
    this.resolved.set(cacheKey, value)
    return value
  }

  async findEntries(
    connection: string,
    names: string[],
    signal: AbortSignal
  ): Promise<InventoryObject[]> {
    const records: InventoryObject[] = []
    for (const name of names) {
      abortIfNeeded(signal)
      const results = await getSearchService(connection).searchObjects(name, undefined, 100)
      abortIfNeeded(signal)
      for (const row of results)
        if (row.name.trim().toUpperCase() === name) {
          records.push({
            pgmid: row.type === "FUGR/FF" ? "LIMU" : "R3TR",
            objectType: row.type === "FUGR/FF" ? "FUNC" : row.type.split("/")[0],
            objectName: name,
            packageName: ""
          })
        }
    }
    return deduplicateInventory(records)
  }

  async probe(connection: string, key: string, signal: AbortSignal) {
    abortIfNeeded(signal)
    const root = await this.resolve(connection, key, signal)
    abortIfNeeded(signal)
    try {
      await new AdtRelationApi(connection).network(root, "ENV", ["ENV"])
      abortIfNeeded(signal)
      return true
    } catch (error) {
      abortIfNeeded(signal)
      if (unsupported(error)) return false
      throw error
    }
  }

  async dependencies(
    connection: string,
    key: string,
    direction: "ENV" | "WUL",
    relations: boolean,
    signal: AbortSignal
  ): Promise<DependencyResult> {
    abortIfNeeded(signal)
    const root = await this.resolve(connection, key, signal)
    abortIfNeeded(signal)
    const edges: DependencyEdge[] = []
    const errors: string[] = []
    if (relations) {
      try {
        const network = await new AdtRelationApi(connection).network(root, direction, [direction])
        abortIfNeeded(signal)
        const rootIds = new Set([root.id, root.uri, root.name])
        for (const relation of network.relations) {
          const endpoint = rootIds.has(relation.from)
            ? relation.to
            : rootIds.has(relation.to)
              ? relation.from
              : undefined
          if (!endpoint) continue
          const object = network.objects.find(item =>
            [item.id, item.uri, item.name].includes(endpoint)
          )
          if (!object || object.exists === false) continue
          const other = relationKey(object)
          if (!other || other === key) continue
          edges.push(
            direction === "ENV"
              ? { caller: key, dependency: other, source: "Object relations ENV" }
              : { caller: other, dependency: key, source: "Object relations WUL" }
          )
        }
      } catch (error) {
        abortIfNeeded(signal)
        errors.push(`Relations failed for ${key}: ${error}`)
      }
    }
    if (direction === "WUL") {
      try {
        abortIfNeeded(signal)
        const client = getClient(connection)
        const uri = getOptimalObjectURI(root.type, root.uri)
        let line = 1,
          character = 0
        try {
          const source = await client.getObjectSource(uri)
          abortIfNeeded(signal)
          const escaped = root.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const declaration = new RegExp(
            `\\b(?:REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|DEFINE\\s+(?:TABLE|VIEW|STRUCTURE))\\s+${escaped}(?=\\s|[.;]|$)`,
            "i"
          )
          const lines = source.split(/\r?\n/)
          const index = lines.findIndex(text => declaration.test(text))
          if (index >= 0) {
            line = index + 1
            character = lines[index].toUpperCase().indexOf(root.name)
          }
        } catch {
          abortIfNeeded(signal)
        }
        abortIfNeeded(signal)
        const references = await client.statelessClone.usageReferences(uri, line, character)
        abortIfNeeded(signal)
        for (const reference of normalizeUsageReferences(references || [])) {
          const parts = reference.objectIdentifier?.split(";") || []
          const type = reference["adtcore:type"] || ""
          let name = reference.fullName
          let objectType = type.split("/")[0] || "PROG"
          if (/=+CP$/.test(name)) {
            name = name.replace(/=+CP$/, "")
            objectType = "CLAS"
          } else if (type === "FUGR/FF") {
            name = reference["adtcore:name"] || ""
            objectType = "FUNC"
          } else if (type === "PROG/I") name = parts[2] || name
          if (name)
            edges.push({
              caller: objectKey(objectType, name),
              dependency: key,
              source: "Where-used"
            })
        }
      } catch (error) {
        abortIfNeeded(signal)
        errors.push(`Where-used failed for ${key}: ${error}`)
      }
    }
    abortIfNeeded(signal)
    return { edges, errors }
  }
}

export function relationKey(object: RelationObject): string | undefined {
  const type = object.type === "FUGR/FF" ? "FUNC" : object.type.split("/")[0]
  let name = object.name.trim().toUpperCase()
  if (object.type === "CLAS/OM" && object.parentUri) {
    name = decodeURIComponent(object.parentUri.split("/").at(-1) || "").toUpperCase()
  }
  if (object.type === "FUGR/FF")
    name = decodeURIComponent(object.uri.split("/").at(-1) || name).toUpperCase()
  if (!type || !name) return undefined
  return objectKey(type, name)
}

export const deduplicateInventory = (rows: InventoryObject[]) => [
  ...new Map(rows.map(row => [inventoryKey(row), row])).values()
]
