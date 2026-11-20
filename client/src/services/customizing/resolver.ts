// Adapted from abap-config-mcp, Copyright (c) 2026 Geert Steyaert (MIT).
import type { ADTClient } from "abap-adt-api"
import { runSql, tableRows, col, objectName } from "./query"
const sql1 = async (client: ADTClient, sql: string) => tableRows(await runSql(client, sql, 200))
export interface ResolvedMaint {
  input: string
  isView: boolean
  view?: string
  rootTable: string
  textTable?: string
  tables: string[] // full ordered table set (base + text + …)
  funcGroup?: string // TVDIR AREA
  maintType?: string // TVDIR TYPE (1 one-step / 2 two-step)
  maintTcode?: string // CUS_ACTOBJ TCODE (SM30 / SM34 / …)
  imgActivity?: string // CUS_ACTOBJ ACT_ID
  imgActivityText?: string // CUS_IMGACT TEXT — the SPRO activity title (the "area")
  authGroup?: string // TDDAT CCLASS of the root table
  objectType?: string // CUS_ACTOBJ OBJECTTYPE: V view / S table / C cluster / T txn / D dummy
  cluster?: string // VCLSTRUC: the view cluster this view belongs to (if any) — NOT the
  // non-termination trigger (see switchId); kept for messaging only.
  devclass?: string // TVDIR DEVCLASS: the maintenance object's own package
  switchId?: string // SFW_PACKAGE SWITCH_ID for devclass, if that package is switch-gated
  // at all — regardless of the switch's current on/off/standby state.
  // THIS is the debugger-verified trigger for a headless commit
  // effectively never terminating on a cold view in that package.
  // maintObject = what VIEW_MAINTENANCE_SINGLE_ENTRY is driven on (a maintenance
  // view for VDAT, or the table itself for single-table TABU maintenance).
  // "" ⇒ no generated SM30/SM34 maintenance → only a direct (untransported) write is possible.
  maintObject: string
  // variant = the view variant that was asked for, when maintObject is the
  // maintenance view it is a variant of (a variant has no maintenance of its own).
  variant?: string
  // recordObject = the transport object the headless write records: CDAT for a
  // view-cluster member (as an SM34 save), else VDAT / TABU.
  recordObject?: "VDAT" | "TABU" | "CDAT"
  // transport = the *official* transport object as SAP/SPRO classifies it
  // (cluster→CDAT, view→VDAT, single table→TABU).
  transport: { object: "VDAT" | "TABU" | "CDAT"; name: string }
}

export async function resolveMaint(client: ADTClient, name: string): Promise<ResolvedMaint> {
  const obj = objectName(name)

  let view: string | undefined
  let rootTable = obj
  let tabRows: Record<string, string>[] = []
  let singleTable = false // table that is its own SM30 maintenance object (TVDIR BASTAB='X')

  // 1. Is the input itself a maintenance view?
  const dd25 = await sql1(
    client,
    `SELECT VIEWNAME, AGGTYPE, ROOTTAB FROM DD25L WHERE VIEWNAME = '${obj}'`
  )
  if (dd25[0]) {
    view = obj
    rootTable = col(dd25[0], "ROOTTAB") || obj
    tabRows = await sql1(
      client,
      `SELECT TABNAME, TABPOS FROM DD26S WHERE VIEWNAME = '${obj}' ORDER BY TABPOS`
    )
  } else {
    // 2. Input is a config table — find the maintenance view(s) ROOTED on it.
    //    NB: filtering DD26S by TABNAME is wrong — a base table is also a check/text
    //    table in many unrelated views (for /POSDW/PROF that's 37), which both
    //    overflows the 255-char IN-list and picks the wrong view. DD25L.ROOTTAB
    //    gives only the views whose *root* is this table (the real maintenance views).
    const rooted = await sql1(
      client,
      `SELECT VIEWNAME FROM DD25L WHERE ROOTTAB = '${obj}' AND AGGTYPE = 'V'`
    )
    const cand = [...new Set(rooted.map(r => col(r, "VIEWNAME")))]
      .filter(v => v && v !== obj)
      .sort((a, b) => a.length - b.length || a.localeCompare(b)) // canonical = shortest name
    if (cand.length) {
      const inList = cand
        .slice(0, 12)
        .map(v => `'${v}'`)
        .join(",") // cap: stay under 255 chars
      const tv = await sql1(client, `SELECT TABNAME FROM TVDIR WHERE TABNAME IN (${inList})`)
      const maintViews = new Set(tv.map(r => col(r, "TABNAME")))
      view = cand.find(v => maintViews.has(v)) // shortest-named view that has a maintenance dialog
      if (view) {
        const dd25v = await sql1(client, `SELECT ROOTTAB FROM DD25L WHERE VIEWNAME = '${view}'`)
        rootTable = col(dd25v[0] ?? {}, "ROOTTAB") || obj
        tabRows = await sql1(
          client,
          `SELECT TABNAME, TABPOS FROM DD26S WHERE VIEWNAME = '${view}' ORDER BY TABPOS`
        )
      }
    }
    // 3. No view → is the table its own single-table maintenance object? TVDIR BASTAB='X'
    if (!view) {
      const selfTv = await sql1(
        client,
        `SELECT TABNAME, AREA, TYPE, BASTAB FROM TVDIR WHERE TABNAME = '${obj}'`
      )
      if (selfTv[0] && col(selfTv[0], "BASTAB") === "X") singleTable = true
    }
  }

  // A view variant (DD25L VIEWCLASS 'V') has no maintenance of its own: SM30 and
  // SM34 maintain it through the maintenance view it is a variant of (its
  // ROOTTAB). Driving VIEW_MAINTENANCE_SINGLE_ENTRY on the variant itself is not
  // what SAP does (/POSDW/V_GPAC3, a member of /POSDW/VC_TASKSG, CAR).
  let variant: string | undefined
  if (view) {
    const vc = await sql1(client, `SELECT VIEWCLASS, ROOTTAB FROM DD25L WHERE VIEWNAME = '${view}'`)
    const base = col(vc[0] ?? {}, "ROOTTAB")
    if (col(vc[0] ?? {}, "VIEWCLASS") === "V" && base) {
      const baseTv = await sql1(client, `SELECT TABNAME FROM TVDIR WHERE TABNAME = '${base}'`)
      if (baseTv[0]) {
        variant = view
        view = base
        const dd25b = await sql1(client, `SELECT ROOTTAB FROM DD25L WHERE VIEWNAME = '${base}'`)
        rootTable = col(dd25b[0] ?? {}, "ROOTTAB") || base
        tabRows = await sql1(
          client,
          `SELECT TABNAME, TABPOS FROM DD26S WHERE VIEWNAME = '${base}' ORDER BY TABPOS`
        )
      }
    }
  }

  let tables = tabRows.map(r => col(r, "TABNAME")).filter(Boolean)
  if (tables.length === 0) tables = [rootTable]
  if (!rootTable) rootTable = tables[0]

  // Identify the text table: a member (≠ root) carrying a LANG-typed key (SPRAS)
  let textTable: string | undefined
  const nonRoot = tables.filter(t => t !== rootTable)
  if (nonRoot.length) {
    const inList = nonRoot.map(t => `'${t}'`).join(",")
    const langFields = await sql1(
      client,
      `SELECT TABNAME FROM DD03L WHERE TABNAME IN (${inList}) AND DATATYPE = 'LANG' AND AS4LOCAL = 'A'`
    )
    textTable = langFields.map(r => col(r, "TABNAME")).find(Boolean)
  }

  // TVDIR (function group / maint type / package) of the maintenance object
  const maintName = view ?? (singleTable ? obj : "")
  let funcGroup: string | undefined, maintType: string | undefined, devclass: string | undefined
  let hasMaint = false
  if (maintName) {
    const tvdir = await sql1(
      client,
      `SELECT AREA, TYPE, DEVCLASS FROM TVDIR WHERE TABNAME = '${maintName}'`
    )
    hasMaint = !!tvdir[0]
    funcGroup = col(tvdir[0] ?? {}, "AREA") || undefined
    maintType = col(tvdir[0] ?? {}, "TYPE") || undefined
    devclass = col(tvdir[0] ?? {}, "DEVCLASS") || undefined
  }

  // Switch Framework gating of that package (SFW_PACKAGE), reported for
  // information. It used to decide a refusal; the hang it stood for is the
  // dialog-mode switch-BC-set recording in CTS, which the writer no longer
  // triggers (see the note above customizing_apply in customizingEngine.ts).
  let switchId: string | undefined
  if (devclass) {
    const sfw = await sql1(
      client,
      `SELECT SWITCH_ID FROM SFW_PACKAGE WHERE DEVCLASS = '${devclass}'`
    )
    switchId = col(sfw[0] ?? {}, "SWITCH_ID") || undefined
  }

  // View-cluster membership (VCLSTRUC): does a cluster maintain this view?
  // A variant counts as the member the cluster names (/POSDW/V_GPAC3 is in
  // VC_TASKSG, its base view /POSDW/V_GPAC is in no cluster).
  let cluster: string | undefined
  for (const member of [variant, view].filter((v): v is string => !!v)) {
    const vcl = await sql1(client, `SELECT VCLNAME FROM VCLSTRUC WHERE OBJECT = '${member}'`)
    cluster = col(vcl[0] ?? {}, "VCLNAME") || undefined
    if (cluster) break
  }

  // IMG activity wiring (CUS_ACTOBJ) — object type V/S/C/T/D, IMG activity, tcode.
  // Use || (not ??): maintName is "" (empty, not null) when the table has no
  // maintenance view, and must fall through to rootTable — otherwise the lookup
  // runs on '' and objectType comes back undefined ("object type ?" in errors).
  const actName = cluster || maintName || rootTable
  const actObj = await sql1(
    client,
    `SELECT ACT_ID, OBJECTTYPE, OBJECTNAME, TCODE FROM CUS_ACTOBJ WHERE OBJECTNAME = '${actName}'`
  )
  const imgActivity = col(actObj[0] ?? {}, "ACT_ID") || undefined
  const objectType = col(actObj[0] ?? {}, "OBJECTTYPE") || undefined
  const maintTcode = col(actObj[0] ?? {}, "TCODE") || undefined

  // IMG activity title (CUS_IMGACT) — the SPRO area name this config lives under
  let imgActivityText: string | undefined
  if (imgActivity) {
    const it = await sql1(
      client,
      `SELECT TEXT FROM CUS_IMGACT WHERE SPRAS = 'E' AND ACTIVITY = '${imgActivity.replace(/'/g, "''")}'`
    )
    imgActivityText = col(it[0] ?? {}, "TEXT") || undefined
  }

  // Auth group of the root table (TDDAT)
  const tddat = await sql1(client, `SELECT CCLASS FROM TDDAT WHERE TABNAME = '${rootTable}'`)
  const authGroup = col(tddat[0] ?? {}, "CCLASS") || undefined

  // What the headless write drives + records, vs the official transport object.
  // Only an object with generated maintenance (TVDIR) is driven through the view
  // runtime; a view without one has no maintenance dialog to run.
  const maintObject = hasMaint ? (view ?? (singleTable ? obj : "")) : ""
  const recordObject: ResolvedMaint["recordObject"] = !maintObject
    ? undefined
    : cluster
      ? "CDAT"
      : view
        ? "VDAT"
        : "TABU"
  const transport: ResolvedMaint["transport"] = cluster
    ? { object: "CDAT", name: cluster }
    : view
      ? { object: "VDAT", name: view }
      : { object: "TABU", name: rootTable }

  return {
    input: obj,
    isView: !!view,
    view,
    rootTable,
    textTable,
    tables,
    funcGroup,
    maintType,
    maintTcode,
    imgActivity,
    imgActivityText,
    authGroup,
    objectType,
    cluster,
    variant,
    devclass,
    switchId,
    maintObject,
    recordObject,
    transport
  }
}
