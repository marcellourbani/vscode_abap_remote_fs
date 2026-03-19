import { ADTClient, DebugVariable, DebugChildVariablesHierarchy } from "abap-adt-api"
import { CapturedVariable, CapturedScope, CaptureOptions, DEFAULT_CAPTURE_OPTIONS } from "./types"
import { log, caughtToString } from "../../../lib"

/** Max IDs per single ADT API call to avoid server overload */
const MAX_IDS_PER_CALL = 200

/** Max table rows to auto-capture during recording (no prompt) */
const RECORDING_MAX_TABLE_ROWS = 2000

/**
 * Fast batched capture for recording mode with configurable depth.
 *
 * Uses breadth-first expansion with batched API calls across multiple depth levels:
 *   Round 1: debuggerChildVariables(["@ROOT"]) → scope IDs
 *   Round 2: debuggerChildVariables([all scope IDs]) → all top-level variables
 *   Round 3...N: For each depth level:
 *     - Batch all structure IDs at current level → expand all
 *     - Batch all table row keys at current level → fetch all
 *
 * With maxDepth=4 (default), captures 4 levels deep in typically 5-8 HTTP calls (~1.5-3s).
 * With maxDepth=2, captures 2 levels in 3-4 calls (~0.8-1.5s).
 */
export async function captureScopesBatched(
  client: ADTClient,
  options: CaptureOptions = DEFAULT_CAPTURE_OPTIONS
): Promise<CapturedScope[]> {
  // Round 1: get scope hierarchy (1 HTTP call)
  const { hierarchies } = await client.debuggerChildVariables(["@ROOT"])
  const scopeIds = hierarchies.map(h => h.CHILD_ID)
  if (!scopeIds.some(id => id === "SY")) scopeIds.push("SY")

  const scopeNames = new Map<string, string>()
  for (const h of hierarchies) scopeNames.set(h.CHILD_ID, h.CHILD_NAME || h.CHILD_ID)
  scopeNames.set("SY", "SY")

  // Round 2: get ALL scope variables in one call (1 HTTP call)
  const allResult = await batchedChildVariables(client, scopeIds)
  const scopeVarMap = groupByParent(scopeIds, allResult.hierarchies, allResult.variables)

  // Build initial variable tree
  const varTree = new Map<string, VarNode>()
  for (const [scopeId, vars] of scopeVarMap) {
    for (const v of vars) {
      varTree.set(v.ID, { variable: v, children: new Map(), depth: 0 })
    }
  }

  // Expand to maxDepth levels using BFS
  for (let depth = 1; depth < options.maxDepth; depth++) {
    const didExpand = await expandOneLevel(client, varTree, depth)
    if (!didExpand) break // No more expandables at this level
  }

  // Assemble scope tree from varTree
  const scopes: CapturedScope[] = []
  for (const scopeId of scopeIds) {
    const name = scopeNames.get(scopeId) || scopeId
    const vars = scopeVarMap.get(scopeId) || []
    const captured = vars.map(v => buildCapturedTree(v.ID, varTree))
    scopes.push({ name, variables: captured })
  }

  return scopes
}

// ── Expansion engine ──

interface VarNode {
  variable: DebugVariable
  children: Map<string, VarNode>
  depth: number
}

/**
 * Expands all structures and tables at the given depth level.
 * Returns true if any expansion happened, false if nothing to expand.
 */
async function expandOneLevel(
  client: ADTClient,
  varTree: Map<string, VarNode>,
  depth: number
): Promise<boolean> {
  const structIds: string[] = []
  const tableSpecs: TableSpec[] = []

  // Collect all expandables at this depth
  for (const node of varTree.values()) {
    if (node.depth !== depth - 1) continue
    const v = node.variable
    if (v.META_TYPE === "structure") {
      structIds.push(v.ID)
    } else if (v.META_TYPE === "table") {
      const lines = v.TABLE_LINES || 0
      if (lines > 0) {
        tableSpecs.push({ id: v.ID, rows: Math.min(lines, RECORDING_MAX_TABLE_ROWS) })
      }
    }
  }

  if (structIds.length === 0 && tableSpecs.length === 0) return false

  // Expand all structures at this level (1 HTTP call)
  if (structIds.length > 0) {
    const structResult = await batchedChildVariables(client, structIds)
    const grouped = groupByParent(structIds, structResult.hierarchies, structResult.variables)
    for (const [parentId, children] of grouped) {
      const parentNode = varTree.get(parentId)
      if (!parentNode) continue
      for (const child of children) {
        const childNode: VarNode = { variable: child, children: new Map(), depth }
        parentNode.children.set(child.ID, childNode)
        varTree.set(child.ID, childNode)
      }
    }
  }

  // Fetch all table rows at this level (1 HTTP call, batched across all tables)
  if (tableSpecs.length > 0) {
    const allKeys: string[] = []
    const keyToTableId = new Map<string, string>()
    for (const spec of tableSpecs) {
      const cleanId = spec.id.replace(/\[\]$/, "")
      for (let i = 1; i <= spec.rows; i++) {
        const key = `${cleanId}[${i}]`
        allKeys.push(key)
        keyToTableId.set(key, spec.id)
      }
    }
    const rowVars = await batchedVariables(client, allKeys)
    for (const rowVar of rowVars) {
      const tableId = keyToTableId.get(rowVar.ID) || inferTableId(rowVar.ID)
      const tableNode = varTree.get(tableId)
      if (!tableNode) continue
      const rowNode: VarNode = { variable: rowVar, children: new Map(), depth }
      tableNode.children.set(rowVar.ID, rowNode)
      varTree.set(rowVar.ID, rowNode)
    }
  }

  return true
}

/**
 * Recursively builds CapturedVariable tree from VarNode tree.
 */
function buildCapturedTree(varId: string, varTree: Map<string, VarNode>): CapturedVariable {
  const node = varTree.get(varId)
  if (!node) {
    // Shouldn't happen, but return a placeholder
    return { id: varId, name: varId, value: "", type: "", metaType: "unknown" }
  }

  const v = node.variable
  const cv: CapturedVariable = {
    id: v.ID,
    name: v.NAME,
    value: v.VALUE,
    type: v.TECHNICAL_TYPE,
    metaType: v.META_TYPE,
    tableLines: v.TABLE_LINES
  }

  if (node.children.size > 0) {
    cv.children = Array.from(node.children.values()).map(child =>
      buildCapturedTree(child.variable.ID, varTree)
    )
    // Add skip reason for tables that were truncated
    if (v.META_TYPE === "table" && cv.children.length < (v.TABLE_LINES || 0)) {
      cv.skipReason = `Captured ${cv.children.length} of ${v.TABLE_LINES} rows`
    }
  } else if (v.META_TYPE === "table" && (v.TABLE_LINES || 0) > 0 && node.children.size === 0) {
    cv.skipReason = `No rows captured (table may have been empty at deeper depth levels)`
  }

  return cv
}

// ── Batched API helpers ──

interface TableSpec { id: string; rows: number }

interface BatchedChildResult {
  hierarchies: DebugChildVariablesHierarchy[]
  variables: DebugVariable[]
}

/** Call debuggerChildVariables in sub-batches if needed */
async function batchedChildVariables(
  client: ADTClient,
  ids: string[]
): Promise<BatchedChildResult> {
  if (ids.length <= MAX_IDS_PER_CALL) {
    return client.debuggerChildVariables(ids)
  }
  const allHierarchies: DebugChildVariablesHierarchy[] = []
  const allVariables: DebugVariable[] = []
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    const batch = ids.slice(i, i + MAX_IDS_PER_CALL)
    const result = await client.debuggerChildVariables(batch)
    allHierarchies.push(...result.hierarchies)
    allVariables.push(...result.variables)
  }
  return { hierarchies: allHierarchies, variables: allVariables }
}

/** Call debuggerVariables in sub-batches if needed */
async function batchedVariables(
  client: ADTClient,
  ids: string[]
): Promise<DebugVariable[]> {
  if (ids.length <= MAX_IDS_PER_CALL) {
    return client.debuggerVariables(ids)
  }
  const all: DebugVariable[] = []
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    const batch = ids.slice(i, i + MAX_IDS_PER_CALL)
    try {
      const result = await client.debuggerVariables(batch)
      all.push(...result)
    } catch (error) {
      log(`Failed batch variables ${i + 1}-${i + batch.length}: ${caughtToString(error)}`)
      break
    }
  }
  return all
}

// ── Grouping and assembly ──

/** Group flat variable list back to their parent IDs using hierarchy info */
function groupByParent(
  parentIds: string[],
  hierarchies: DebugChildVariablesHierarchy[],
  variables: DebugVariable[]
): Map<string, DebugVariable[]> {
  const result = new Map<string, DebugVariable[]>()
  for (const pid of parentIds) result.set(pid, [])

  // Build child→parent lookup from hierarchies
  const childToParent = new Map<string, string>()
  for (const h of hierarchies) {
    childToParent.set(h.CHILD_ID, h.PARENT_ID)
  }

  for (const v of variables) {
    // Try hierarchy mapping first
    const parent = childToParent.get(v.ID)
    if (parent && result.has(parent)) {
      result.get(parent)!.push(v)
      continue
    }
    // Fallback: match by ID prefix
    for (const pid of parentIds) {
      if (v.ID.startsWith(pid)) {
        result.get(pid)!.push(v)
        break
      }
    }
  }

  return result
}

function inferTableId(rowId: string): string {
  const match = rowId.match(/^(.+)\[\d+\]$/)
  return match ? match[1] : rowId
}
