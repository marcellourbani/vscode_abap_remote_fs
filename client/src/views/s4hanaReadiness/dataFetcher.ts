/**
 * Data fetching and joining logic for S/4HANA Readiness Dashboard.
 *
 * Fetches SYCM tables from SAP and performs the join in JS
 * (required because ADT SQL has a 255-char query limit).
 */

import { ADTClient } from "abap-adt-api"
import {
  CustomReference,
  GroupedData,
  ItemGroup,
  ItemPiecelistLink,
  PiecelistEntry,
  SimplificationItem
} from "./types"
import { log } from "../../lib"

const LOG_PREFIX = "[S4H Data]"
const INITIAL_LIMIT = 150000
const INCREMENT = 50000
const ABSOLUTE_MAX = 500000

/**
 * Runs a query with automatic pagination. Starts at INITIAL_LIMIT rows,
 * and if ADT signals there's more (returns limit+1 rows), retries with
 * a higher limit until all rows are fetched or ABSOLUTE_MAX is hit.
 */
async function safeQuery(client: ADTClient, sql: string, context: string): Promise<any[]> {
  let limit = INITIAL_LIMIT
  while (limit <= ABSOLUTE_MAX) {
    log.debug(`${LOG_PREFIX} ${context}: querying with limit=${limit}`)
    const result = await client.runQuery(sql, limit + 1, true)
    if (!result?.values) return []
    if (result.values.length <= limit) {
      log.debug(`${LOG_PREFIX} ${context}: got ${result.values.length} rows (complete)`)
      return result.values
    }
    // More rows exist — increase limit and retry
    log.debug(`${LOG_PREFIX} ${context}: got ${result.values.length} rows, more available — retrying with higher limit`)
    limit += INCREMENT
  }
  // Hit absolute max — fetch one final time at that limit
  log.warn(`${LOG_PREFIX} ${context}: hit absolute max (${ABSOLUTE_MAX}), results may be incomplete`)
  const result = await client.runQuery(sql, ABSOLUTE_MAX, true)
  return result?.values || []
}

export async function fetchSimplificationItems(client: ADTClient): Promise<SimplificationItem[]> {
  log.debug(`${LOG_PREFIX} fetchSimplificationItems: querying sycm_sitem`)
  const values = await safeQuery(client, "SELECT id, version, title, note, replacement_id FROM sycm_sitem", "fetchSimplificationItems")
  log.debug(`${LOG_PREFIX} fetchSimplificationItems: got ${values.length} items`)
  return values.map((row: any) => ({
    id: (row.ID || "").trim(),
    version: (row.VERSION || "").trim(),
    title: (row.TITLE || "").trim(),
    note: parseInt(row.NOTE, 10) || 0,
    replacementId: (row.REPLACEMENT_ID || "").trim()
  }))
}

export async function fetchCustomRefs(client: ADTClient): Promise<CustomReference[]> {
  log.debug(`${LOG_PREFIX} fetchCustomRefs: querying sycm_cust_refs`)
  const values = await safeQuery(client, "SELECT * FROM sycm_cust_refs", "fetchCustomRefs")
  log.debug(`${LOG_PREFIX} fetchCustomRefs: got ${values.length} refs`)
  return values
    .filter((row: any) => (row.OBJ_NAME || "").trim() !== "")
    .map((row: any) => ({
    extractionSysid: (row.EXTRACTION_SYSID || "").trim(),
    extractionName: (row.EXTRACTION_NAME || "").trim(),
    referenceKind: (row.REFERENCE_KIND || "").trim(),
    hash: (row.HASH || "").trim(),
    refObjType: (row.REF_OBJ_TYPE || "").trim(),
    refObjName: (row.REF_OBJ_NAME || "").trim(),
    refSubType: (row.REF_SUB_TYPE || "").trim(),
    refSubName: (row.REF_SUB_NAME || "").trim(),
    refIntType: (row.REF_INT_TYPE || "").trim(),
    refIntName: (row.REF_INT_NAME || "").trim(),
    objType: (row.OBJ_TYPE || "").trim(),
    objName: (row.OBJ_NAME || "").trim(),
    subType: (row.SUB_TYPE || "").trim(),
    subName: (row.SUB_NAME || "").trim(),
    includeName: (row.INCLUDE_NAME || "").trim(),
    devclass: (row.DEVCLASS || "").trim(),
    genflag: (row.GENFLAG || "").trim(),
    dlvunit: (row.DLVUNIT || "").trim(),
    refApplComponent: (row.REF_APPL_COMPONENT || "").trim()
  }))
}

export async function fetchItemPiecelistLinks(client: ADTClient): Promise<ItemPiecelistLink[]> {
  log.debug(`${LOG_PREFIX} fetchItemPiecelistLinks: querying sycm_sitem_plist`)
  const values = await safeQuery(client, "SELECT id, version, piecelist_id FROM sycm_sitem_plist", "fetchItemPiecelistLinks")
  log.debug(`${LOG_PREFIX} fetchItemPiecelistLinks: got ${values.length} links`)
  return values.map((row: any) => ({
    id: (row.ID || "").trim(),
    version: (row.VERSION || "").trim(),
    piecelistId: (row.PIECELIST_ID || "").trim()
  }))
}

/**
 * Fetches the entire piecelist table in a single ADT call.
 * This table maps piecelist IDs to affected SAP object names.
 * Typically 100K-200K rows but a single call is far better than hundreds of per-ID queries.
 */
export async function fetchPiecelist(client: ADTClient): Promise<PiecelistEntry[]> {
  log.debug(`${LOG_PREFIX} fetchPiecelist: querying full sycm_piecelist`)
  const values = await safeQuery(client, "SELECT piecelist_id, object_type, object_name FROM sycm_piecelist", "fetchPiecelist")
  log.debug(`${LOG_PREFIX} fetchPiecelist: got ${values.length} entries`)
  return values.map(mapPiecelistRow)
}

function mapPiecelistRow(row: any): PiecelistEntry {
  return {
    piecelistId: (row.PIECELIST_ID || "").trim(),
    pgmid: "",
    objectType: (row.OBJECT_TYPE || "").trim(),
    objectName: (row.OBJECT_NAME || "").trim(),
    packageName: "",
    applicationComponent: ""
  }
}

/**
 * Joins custom references to simplification items via piecelist.
 *
 * Join path: CUST_REFS.REF_OBJ_NAME → PIECELIST.OBJECT_NAME
 *          → PIECELIST.PIECELIST_ID → SITEM_PLIST.PIECELIST_ID
 *          → SITEM_PLIST.ID → SITEM.ID
 */
export function joinData(
  items: SimplificationItem[],
  refs: CustomReference[],
  piecelist: PiecelistEntry[],
  itemPiecelistLinks: ItemPiecelistLink[]
): GroupedData {
  // Build lookup: piecelistId → Set of item IDs
  const piecelistToItemIds = new Map<string, Set<string>>()
  for (const link of itemPiecelistLinks) {
    let set = piecelistToItemIds.get(link.piecelistId)
    if (!set) {
      set = new Set()
      piecelistToItemIds.set(link.piecelistId, set)
    }
    set.add(link.id)
  }

  // Build lookup: objectName → Set of piecelist IDs
  const objNameToPiecelistIds = new Map<string, Set<string>>()
  for (const p of piecelist) {
    let set = objNameToPiecelistIds.get(p.objectName)
    if (!set) {
      set = new Set()
      objNameToPiecelistIds.set(p.objectName, set)
    }
    set.add(p.piecelistId)
  }

  // Build item lookup
  const itemMap = new Map<string, SimplificationItem>()
  for (const item of items) {
    itemMap.set(item.id, item)
  }

  // For each ref, find which item it belongs to
  const groupMap = new Map<string, CustomReference[]>() // itemId → refs
  const ungrouped: CustomReference[] = []

  for (const ref of refs) {
    const piecelistIds = objNameToPiecelistIds.get(ref.refObjName)
    if (!piecelistIds) {
      ungrouped.push(ref)
      continue
    }

    let matched = false
    for (const plId of piecelistIds) {
      const itemIds = piecelistToItemIds.get(plId)
      if (itemIds) {
        for (const itemId of itemIds) {
          if (itemMap.has(itemId)) {
            let arr = groupMap.get(itemId)
            if (!arr) {
              arr = []
              groupMap.set(itemId, arr)
            }
            arr.push(ref)
            matched = true
            break // assign to first matching item
          }
        }
        if (matched) break
      }
    }
    if (!matched) {
      ungrouped.push(ref)
    }
  }

  const groups: ItemGroup[] = []
  for (const [itemId, itemRefs] of groupMap) {
    const item = itemMap.get(itemId)!
    groups.push({ item, refs: itemRefs })
  }

  // Merge groups that share the same title+note (different versions of same item)
  const mergedMap = new Map<string, ItemGroup>()
  for (const group of groups) {
    const key = `${group.item.title}||${group.item.note}`
    const existing = mergedMap.get(key)
    if (existing) {
      existing.refs.push(...group.refs)
    } else {
      mergedMap.set(key, { item: group.item, refs: [...group.refs] })
    }
  }
  const mergedGroups = [...mergedMap.values()]

  // Sort groups by number of refs descending
  mergedGroups.sort((a, b) => b.refs.length - a.refs.length)

  return { groups: mergedGroups, ungrouped, totalRefs: refs.length }
}

/**
 * Orchestrates the full data fetch + join for a connection.
 */
export async function loadReadinessData(
  client: ADTClient,
  onProgress?: (message: string) => void
): Promise<GroupedData> {
  const report = onProgress || (() => {})
  log.debug(`${LOG_PREFIX} loadReadinessData: starting`)
  report("Fetching simplification items & custom references...")
  // Fetch items and links in parallel (small tables)
  const [items, itemLinks, refs] = await Promise.all([
    fetchSimplificationItems(client),
    fetchItemPiecelistLinks(client),
    fetchCustomRefs(client)
  ])
  report(`Found ${refs.length} custom references, ${items.length} simplification items`)

  if (refs.length === 0) {
    log(`${LOG_PREFIX} loadReadinessData: no custom refs found`)
    return { groups: [], ungrouped: [], totalRefs: 0 }
  }

  // Fetch the full piecelist in one call (typically 100K-200K rows)
  // Much faster than per-ID queries which could be 500+ sequential calls
  report("Fetching piecelist (this may take a moment)...")
  const piecelist = await fetchPiecelist(client)
  report(`Got ${piecelist.length} piecelist entries, joining data...`)

  log.debug(`${LOG_PREFIX} loadReadinessData: joining data...`)
  const result = joinData(items, refs, piecelist, itemLinks)
  log.debug(`${LOG_PREFIX} loadReadinessData: done. ${result.groups.length} groups, ${result.ungrouped.length} ungrouped`)
  return result
}
