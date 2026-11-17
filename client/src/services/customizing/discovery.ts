// Adapted from abap-config-mcp, Copyright (c) 2026 Geert Steyaert (MIT).
import type { ADTClient } from "abap-adt-api"
import { ensureConnected, runSql, tableRows, col } from "./query"
import { imgIndexRead, imgSearchViaEngine } from "./engine"
import type { ImgIndexHit, ImgSearchHit } from "./engine"
import { log } from "../../lib"
const sql1 = async (client: ADTClient, sql: string) => tableRows(await runSql(client, sql, 1000))
export async function handleImgSearch(args: {
  keyword: string
  namespace?: string // activity-ID prefix to scope by, e.g. "/POSDW/" (POS DTA)
  inScopeOnly?: boolean // keep only activities in the client's activated scope (CUS_IMGACH_SCOPE)
  language?: string
  maxResults?: number
  connectionId?: string
}) {
  const client = await ensureConnected(args.connectionId)
  if (args.language && !/^[A-Za-z0-9]$/.test(args.language))
    throw new Error("language must be a one-character SAP language key")
  if (args.inScopeOnly || args.namespace) return imgSearchRaw(client, args)

  // Preferred: the in-system engine's img_search op — a full CUS_IMGACT scan with
  // a server-side LIKE over title AND activity id. No 200-row alphabetical window,
  // and it finds component-acronym hits (TSW → SIMG_OIJ_TSW_*). Falls through to
  // the STREE index / raw ADT paths when the engine is unreachable or too old.
  if (args.keyword.trim()) {
    try {
      const viaEngine = await imgSearchViaEngine(args.connectionId, {
        keyword: args.keyword.trim(),
        language: args.language,
        maxRows: args.maxResults
      })
      if (viaEngine) {
        const out = formatImgSearchHits(args.keyword, viaEngine, args.namespace)
        return { content: [{ type: "text" as const, text: out }] }
      }
    } catch (err) {
      log(`IMG search fallback: ${String(err)}`)
    }
  }

  // Next: the STREE/SHI text search index when one exists (built by
  // RS_SHI10_TEXTINDEX_UPDATE). It covers the whole IMG in one cluster read and
  // gives breadcrumb-aware hits. Fall back to the raw CUS_IMGACT tables when no
  // index is present — always reporting which source answered.
  if (args.keyword.trim()) {
    try {
      const viaIndex = await imgSearchViaIndex(client, args)
      if (viaIndex) return { content: [{ type: "text" as const, text: viaIndex }] }
    } catch (err) {
      log(`IMG search fallback: ${String(err)}`)
    }
  }
  return imgSearchRaw(client, args)
}

// Index-backed search: resolve the indexed IMG tree(s) from the TTREESRCH
// directory (∩ TTREE TYPE='IMG'), then call the engine's img_index_read op per
// tree. Returns a formatted block, or null when no index exists (→ caller falls
// back to the raw tables).
async function imgSearchViaIndex(
  client: ADTClient,
  args: { keyword: string; language?: string; maxResults?: number; connectionId?: string }
): Promise<string | null> {
  const lang = (args.language ?? "E").toUpperCase().slice(0, 1)
  const max = args.maxResults ?? 200
  const kw = args.keyword.trim()

  // Which trees have a generated text index? TTREESRCH is small (one row per
  // indexed tree+language), so drive from it and confirm each is an IMG tree
  // with a targeted TTREE lookup — there are far too many IMG trees to scan.
  const genRows = tableRows(
    await runSql(
      client,
      `SELECT TREE_ID, SPRAS, GEN_DATE FROM TTREESRCH ORDER BY GEN_DATE DESCENDING`,
      100
    )
  )
  if (genRows.length === 0) return null

  const genByTree = new Map<string, string>() // tree_id → gen_date (newest first wins)
  for (const r of genRows) {
    const id = col(r, "TREE_ID")
    if (!genByTree.has(id)) genByTree.set(id, col(r, "GEN_DATE"))
  }
  // Keep the IN-list under this system's 255-char literal cap (~7 × 32-char ids)
  const ids = [...genByTree.keys()].slice(0, 6)
  const inList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(",")
  const imgRows = tableRows(
    await runSql(client, `SELECT ID FROM TTREE WHERE TYPE = 'IMG' AND ID IN (${inList})`, 50)
  )
  const imgIds = new Set(imgRows.map(r => col(r, "ID")))

  const trees = ids.filter(id => imgIds.has(id)).map(id => ({ id, gen: genByTree.get(id)! }))
  if (trees.length === 0) return null

  const hits: (ImgIndexHit & { _tree: string; _gen: string })[] = []
  const sources: string[] = []
  for (const t of trees.slice(0, 3)) {
    const res = await imgIndexRead(args.connectionId, {
      structureId: t.id,
      language: lang,
      keyword: kw,
      maxRows: max
    })
    if (res.status === "no_index") continue
    sources.push(`STREE index ${t.id} @${t.gen}`)
    for (const h of res.hits) hits.push({ ...h, _tree: t.id, _gen: t.gen })
    if (hits.length >= max) break
  }
  if (sources.length === 0) return null // engine couldn't read any index → fall back

  if (hits.length === 0) {
    return (
      `No IMG nodes matching "${args.keyword}".\n` +
      `source: ${sources.join("; ")} (index used, vs. raw IMG tables)`
    )
  }

  const lines: string[] = [
    `IMG nodes matching "${args.keyword}" (${hits.length}) — via search index:`,
    ""
  ]
  for (const h of hits.slice(0, max)) {
    const path = h.PATH || h.TEXT
    const ext = h.EXTENSION ? `   [${h.EXTENSION}]` : ""
    lines.push(`• ${path}${ext}`)
  }
  lines.push(
    "",
    `source: ${sources.join("; ")}  (index used — vs. raw IMG tables)`,
    `Use customizing_describe <object> for the table set + transport object.`
  )
  return lines.join("\n")
}

// Format engine img_search hits into the same table layout as the raw path.
function formatImgSearchHits(
  keyword: string,
  res: { hits: ImgSearchHit[]; messages: string[]; capped: boolean },
  namespace?: string
): string {
  const typeLabel: Record<string, string> = {
    V: "view→VDAT",
    S: "table→TABU",
    C: "cluster→CDAT",
    T: "txn",
    D: "doc"
  }
  let hits = res.hits
  if (namespace) {
    const ns = namespace.toUpperCase()
    hits = hits.filter(h => (h.ACTIVITY ?? "").toUpperCase().startsWith(ns))
  }
  const src = `source: SAP IMG search service (full CUS_IMGACT scan — title + activity id)`
  if (hits.length === 0) {
    return `No IMG activities matching "${keyword}"${namespace ? ` in ${namespace}` : ""}.\n${src}`
  }
  const scope = namespace ? ` in ${namespace}` : ""
  const lines: string[] = [
    `IMG activities${scope} matching "${keyword}" (${hits.length}):`,
    "",
    `${"IMG activity".padEnd(22)} ${"Title".padEnd(45)} ${"Type".padEnd(12)} ${"Object".padEnd(24)} Tcode`,
    "-".repeat(120)
  ]
  for (const h of hits) {
    const act = (h.ACTIVITY ?? "").padEnd(22)
    const title = (h.TEXT ?? "").slice(0, 45).padEnd(45)
    const t = h.OBJECTTYPE ?? ""
    const type = (typeLabel[t] ?? t).padEnd(12)
    const obj = (h.OBJECTNAME ?? "").padEnd(24)
    const tc = h.TCODE ?? ""
    lines.push(`${act} ${title} ${type} ${obj} ${tc}`)
  }
  lines.push(
    "",
    `Use customizing_describe <object> for the table set, key fields, and transport object.`,
    src
  )
  if (res.capped)
    lines.push(
      `⚠️  ${res.messages.find(m => /capped/i.test(m)) ?? "result capped — raise maxResults"}`
    )
  return lines.join("\n")
}

// Raw fallback: search the CUS_IMGACT / CUS_ACTOBJ tables directly. Used when no
// STREE search index is present (or the engine isn't reachable).
async function imgSearchRaw(
  client: ADTClient,
  args: {
    keyword: string
    namespace?: string
    inScopeOnly?: boolean
    language?: string
    maxResults?: number
    connectionId?: string
  }
) {
  const lang = (args.language ?? "E").toUpperCase()
  const max = args.maxResults ?? 200
  const kw = args.keyword.trim().toUpperCase()

  // The IMG index is CUS_IMGACT (SPRAS, ACTIVITY, TEXT = the SPRO activity title).
  // Joined to CUS_ACTOBJ it yields the maintenance object + type + tcode, across
  // ALL packages — the authoritative discovery entry point.
  //   CUS_IMGACT  IMG activity title   SPRAS, ACTIVITY, TEXT
  //   CUS_ACTOBJ  activity → object    ACT_ID, OBJECTTYPE (V/S/C/T/D), OBJECTNAME, TCODE
  //
  // This system's SQL endpoint REJECTS `LIKE` (even an indexed prefix → HTTP 400),
  // so keyword matching is done MCP-side. We bound the scan with a key RANGE on
  // ACTIVITY (range comparisons DO work): scoped to `namespace` if given, else a
  // best-effort scan of the first `max` activities. Always pass a namespace for a
  // targeted search (e.g. "/POSDW/" for POS DTA).
  const ns = (args.namespace ?? "").toUpperCase().replace(/'/g, "''")
  let where = `a~SPRAS = '${lang}'`
  if (ns) {
    // [ns, ns+'~') — '~' (0x7E) sorts after letters/digits, covering the namespace
    where += ` AND a~ACTIVITY >= '${ns}' AND a~ACTIVITY < '${ns}~'`
  }
  const sql =
    `SELECT a~ACTIVITY, a~TEXT, o~OBJECTTYPE, o~OBJECTNAME, o~TCODE ` +
    `FROM CUS_IMGACT AS a ` +
    `INNER JOIN CUS_ACTOBJ AS o ON o~ACT_ID = a~ACTIVITY ` +
    `WHERE ${where} ORDER BY a~ACTIVITY`

  let scanned: Record<string, string>[] = []
  scanned = tableRows(await runSql(client, sql, max))

  // Keyword filter MCP-side (case-insensitive substring). Match the activity id,
  // object name and tcode too — not just the title — so component-acronym searches
  // (e.g. "TSW" → SIMG_OIJ_TSW_*, whose functional titles never say "TSW") hit.
  let rows = kw
    ? scanned.filter(
        r =>
          col(r, "TEXT").toUpperCase().includes(kw) ||
          col(r, "ACTIVITY").toUpperCase().includes(kw) ||
          col(r, "OBJECTNAME").toUpperCase().includes(kw) ||
          col(r, "TCODE").toUpperCase().includes(kw)
      )
    : scanned

  // F3: this path fetches only the first `max` activities (ordered by ACTIVITY)
  // then filters MCP-side — so without a namespace the scan window may not reach
  // the keyword's activities at all. Flag a truncated scan honestly.
  const truncated = scanned.length >= max

  // Optional: restrict to activities in the client's activated scope.
  // CUS_IMGACH_SCOPE is client-dependent and is empty on systems where scoping
  // isn't activated (e.g. CAR) — there it would drop everything, so we only
  // apply the filter when the scope table actually has rows for this namespace.
  let scopeNote = ""
  if (args.inScopeOnly) {
    const scopeRows = await sql1(
      client,
      `SELECT ACTIVITY FROM CUS_IMGACH_SCOPE${ns ? ` WHERE ACTIVITY >= '${ns}' AND ACTIVITY < '${ns}~'` : ""}`
    )
    if (scopeRows.length > 0) {
      const inScope = new Set(scopeRows.map(r => col(r, "ACTIVITY")))
      rows = rows.filter(r => inScope.has(col(r, "ACTIVITY")))
    } else {
      scopeNote = `\n(inScopeOnly ignored — no scoping data in CUS_IMGACH_SCOPE for ${args.namespace})`
    }
  }

  if (rows.length === 0) {
    const hint = ns
      ? `No IMG activities in ${args.namespace} matching "${args.keyword}".`
      : `No matches in the first ${max} activities scanned. This ADT path can only ` +
        `scan a bounded window (the user can check ABAP FS Customizing Setup for full search), so ` +
        `pass a namespace (e.g. namespace: "/POSDW/") to scope the search, or raise maxResults.`
    return { content: [{ type: "text" as const, text: hint }] }
  }

  const typeLabel: Record<string, string> = {
    V: "view→VDAT",
    S: "table→TABU",
    C: "cluster→CDAT",
    T: "txn",
    D: "doc"
  }
  const scope = ns ? ` in ${args.namespace}` : ""
  const lines: string[] = [
    `IMG activities${scope} matching "${args.keyword}" (${rows.length}):`,
    "",
    `${"IMG activity".padEnd(22)} ${"Title".padEnd(45)} ${"Type".padEnd(12)} ${"Object".padEnd(24)} Tcode`,
    "-".repeat(120)
  ]
  for (const r of rows) {
    const act = col(r, "ACTIVITY").padEnd(22)
    const title = col(r, "TEXT").slice(0, 45).padEnd(45)
    const t = col(r, "OBJECTTYPE")
    const type = (typeLabel[t] ?? t).padEnd(12)
    const obj = col(r, "OBJECTNAME").padEnd(24)
    const tc = col(r, "TCODE")
    lines.push(`${act} ${title} ${type} ${obj} ${tc}`)
  }
  lines.push(
    "",
    `Use customizing_describe <object> to see the table set, key fields, and transport object.`
  )
  lines.push(`source: CUS_IMGACT raw IMG tables (no STREE search index)`)
  if (truncated) {
    lines.push(
      `⚠️  PARTIAL SCAN — only the first ${max} activities (ordered by ID) were read, so ` +
        `matches outside that window are missing. Pass a namespace to scope, raise maxResults, ` +
        `or ask the user to check ABAP FS Customizing Setup for full server-side search.`
    )
  }
  if (scopeNote) lines.push(scopeNote.trim())

  return { content: [{ type: "text" as const, text: lines.join("\n") }] }
}

// ─── customizing_describe ─────────────────────────────────────────────────────
