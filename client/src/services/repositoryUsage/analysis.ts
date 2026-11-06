import type {
  DependencyEdge,
  EvidenceSource,
  FunctionMapping,
  InventoryObject,
  Observation,
  TransactionMapping,
  UsageRow
} from "./types"

export const normalizedName = (value: string) => value.trim().toUpperCase()
export const objectKey = (
  type: string,
  name: string,
  pgmid = type.toUpperCase() === "FUNC" ? "LIMU" : "R3TR"
) => `${pgmid}:${type}:${name}`.toUpperCase()
export const inventoryKey = (record: InventoryObject) =>
  objectKey(record.objectType, record.objectName, record.pgmid)

export function resolveEntries(
  entries: string[],
  source: EvidenceSource,
  inventory: InventoryObject[],
  transactions: TransactionMapping[],
  functions: FunctionMapping[]
): Observation[] {
  const byName = new Map<string, InventoryObject[]>()
  for (const record of inventory)
    byName.set(record.objectName, [...(byName.get(record.objectName) || []), record])
  return [...new Set(entries.map(normalizedName).filter(Boolean))].map(name => {
    const base: Observation = {
      id: `${source}:${name}`,
      source,
      keys: [],
      seeds: [],
      reason: `${sourceLabel(source)}: ${name}`
    }
    if (source === "rfc-server") {
      const groups = [
        ...new Set(functions.filter(item => item.name === name).map(item => item.group))
      ]
      if (groups.length !== 1)
        return {
          ...base,
          reason: `${base.reason}; ${groups.length ? "Ambiguous function group" : "Unresolved function module"}`,
          ambiguous: groups.map(group => objectKey("FUGR", group))
        }
      return {
        ...base,
        keys: [objectKey("FUNC", name), objectKey("FUGR", groups[0])],
        seeds: [objectKey("FUNC", name)],
        reason: `${base.reason}; function group ${groups[0]}`
      }
    }
    if (source === "transaction" || source === "rfc-transaction") {
      const asTransaction = transactions.filter(item => item.transaction === name)
      const asProgram = transactions.filter(item => item.program === name)
      const discovered = byName.get(name) || []
      if (discovered.some(record => record.objectType === "TRAN")) {
        const keys = [...new Set(discovered.map(inventoryKey))]
        if (new Set(discovered.map(record => record.objectType)).size > 1)
          return {
            ...base,
            ambiguous: keys,
            reason: `${base.reason}; Ambiguous name match: ${keys.join(", ")}`
          }
        if (!asTransaction.length && !asProgram.length) return { ...base, keys, seeds: keys }
      }
      const programs = new Set([
        ...asTransaction.map(item => item.program).filter(Boolean),
        ...asProgram.map(item => item.program)
      ])
      const programExists = discovered.some(record => record.objectType === "PROG")
      if (programExists) programs.add(name)
      if (programs.size > 1) {
        const ambiguous = [
          ...new Set(
            [...programs]
              .map(program => objectKey("PROG", program))
              .concat(asTransaction.map(item => objectKey("TRAN", item.transaction)))
          )
        ]
        return {
          ...base,
          ambiguous,
          reason: `${base.reason}; Ambiguous transaction/program match: ${ambiguous.join(", ")}`
        }
      }
      if (asTransaction.length || asProgram.length || programExists) {
        const resolved = [...programs][0]
        const keys = [
          ...new Set([
            ...[...programs].map(program => objectKey("PROG", program)),
            ...transactions
              .filter(item => item.transaction === name || (resolved && item.program === resolved))
              .map(item => objectKey("TRAN", item.transaction))
          ])
        ]
        return { ...base, keys, seeds: keys }
      }
      return { ...base, reason: `${base.reason}; No matching transaction or discovered program` }
    }
    const candidates = (byName.get(name) || []).filter(
      record => source !== "jobs" || record.objectType === "PROG"
    )
    if (candidates.length > 1)
      return {
        ...base,
        ambiguous: candidates.map(inventoryKey),
        reason: `${base.reason}; Ambiguous name match`
      }
    if (candidates.length === 1) {
      const keys = [inventoryKey(candidates[0])]
      if (source === "jobs") {
        for (const item of transactions)
          if (item.program === name) keys.push(objectKey("TRAN", item.transaction))
      }
      return { ...base, keys, seeds: keys }
    }
    if (source === "jobs") {
      const keys = [
        objectKey("PROG", name),
        ...transactions
          .filter(item => item.program === name)
          .map(item => objectKey("TRAN", item.transaction))
      ]
      return { ...base, keys, seeds: keys }
    }
    return { ...base, reason: `${base.reason}; Unresolved name` }
  })
}

export function sourceLabel(source: EvidenceSource): string {
  return {
    transaction: "ST03N transaction profile",
    "rfc-server": "ST03N RFC server function module",
    "rfc-transaction": "ST03N RFC server transaction",
    jobs: "Background job",
    untyped: "Repository name"
  }[source]
}

export function usedClosure(
  observations: Observation[],
  edges: DependencyEdge[],
  scope?: ReadonlySet<string>,
  includeReasons = true
) {
  const used = new Set(observations.flatMap(item => item.seeds))
  const reasons = new Map<string, string[]>()
  const outgoing = new Map<string, DependencyEdge[]>()
  for (const edge of edges) {
    if (scope && (!scope.has(edge.caller) || !scope.has(edge.dependency))) continue
    const dependencies = outgoing.get(edge.caller)
    if (dependencies) dependencies.push(edge)
    else outgoing.set(edge.caller, [edge])
  }
  const queue = [...used]
  for (let index = 0; index < queue.length; index++) {
    for (const edge of outgoing.get(queue[index]) || []) {
      if (includeReasons) {
        if (!reasons.has(edge.dependency)) reasons.set(edge.dependency, [])
        reasons.get(edge.dependency)!.push(`${edge.source}: used by ${edge.caller}`)
      }
      if (used.has(edge.dependency)) continue
      used.add(edge.dependency)
      queue.push(edge.dependency)
    }
  }
  return { used, reasons }
}

export function inventoryUsageScope(inventory: InventoryObject[], observations: Observation[]) {
  return new Set([
    ...inventory.map(inventoryKey),
    ...observations.flatMap(item => [...item.keys, ...item.seeds])
  ])
}

export function usedInventoryKeys(
  inventory: InventoryObject[],
  observations: Observation[],
  edges: DependencyEdge[],
  previousUsed?: readonly string[]
) {
  const direct = new Set(observations.flatMap(item => item.keys))
  const scope = inventoryUsageScope(inventory, observations)
  if (previousUsed) {
    const callers = new Set([
      ...previousUsed,
      ...direct,
      ...observations.flatMap(item => item.seeds)
    ])
    const used = new Set(callers)
    for (const edge of edges)
      if (scope.has(edge.caller) && scope.has(edge.dependency) && callers.has(edge.caller))
        used.add(edge.dependency)
    return inventory.map(inventoryKey).filter(key => used.has(key))
  }
  const closure = usedClosure(observations, edges, scope, false)
  return inventory.map(inventoryKey).filter(key => direct.has(key) || closure.used.has(key))
}

export function analyse(
  inventory: InventoryObject[],
  observations: Observation[],
  edges: DependencyEdge[]
): UsageRow[] {
  const unique = [...new Map(observations.map(item => [item.id, item])).values()]
  const closure = usedClosure(unique, edges, inventoryUsageScope(inventory, unique))
  const direct = new Map<string, Observation[]>()
  const ambiguous = new Map<string, Observation[]>()
  for (const item of unique) {
    for (const key of item.keys) direct.set(key, [...(direct.get(key) || []), item])
    for (const key of item.ambiguous || [])
      ambiguous.set(key, [...(ambiguous.get(key) || []), item])
  }
  return inventory.map(record => {
    const key = inventoryKey(record)
    const matches = direct.get(key) || []
    const dates = matches.flatMap(item => (item.date ? [item.date] : [])).sort()
    const reasons = [
      ...matches.map(item => item.reason),
      ...(closure.reasons.get(key) || []),
      ...(ambiguous.get(key) || []).map(item => `Ambiguous: ${item.reason}`)
    ]
    return {
      ...record,
      key,
      status: matches.length || closure.used.has(key) ? "used" : "unclear",
      reasons: [...new Set(reasons)],
      lastObserved: dates.at(-1),
      periods: [...new Set(matches.flatMap(item => (item.period ? [item.period] : [])))]
    }
  })
}
