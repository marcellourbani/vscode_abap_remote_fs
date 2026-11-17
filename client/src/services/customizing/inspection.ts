// Adapted from abap-config-mcp, Copyright (c) 2026 Geert Steyaert (MIT).
import { ensureConnected, runSql, tableRows, col, formatQueryResult, objectName } from "./query"
import { resolveMaint } from "./resolver"
export async function handleCustomizingDescribe(args: {
  objectName: string // view name (TVDIR) or table name (DD02L)
  language?: string
  connectionId?: string
}) {
  const client = await ensureConnected(args.connectionId)
  const lang = (args.language ?? "E").toUpperCase()
  if (!/^[A-Z0-9]$/.test(lang)) throw new Error("language must be a one-character SAP language key")
  const obj = objectName(args.objectName)

  // 1. Resolve the full maintenance object (view ↔ base + text table set, IMG, transport)
  const maint = await resolveMaint(client, obj)
  const baseTable = maint.rootTable

  // 3. Table metadata: flags live in DD02L, the description in DD02T (NOT DD02T for both).
  const dd02lRows = tableRows(
    await runSql(
      client,
      `SELECT TABNAME, TABCLASS, CONTFLAG, CLIDEP, MAINFLAG FROM DD02L WHERE TABNAME = '${baseTable}'`,
      1
    ).catch(() => ({ columns: [], values: [] }))
  )
  const dd02tRows = tableRows(
    await runSql(
      client,
      `SELECT TABNAME, DDTEXT FROM DD02T WHERE TABNAME = '${baseTable}' AND DDLANGUAGE = '${lang}' AND AS4LOCAL = 'A'`,
      1
    ).catch(() => ({ columns: [], values: [] }))
  )
  const dd02 =
    dd02lRows[0] || dd02tRows[0] ? { ...(dd02lRows[0] ?? {}), ...(dd02tRows[0] ?? {}) } : undefined

  // 4. Field list with key flag — structure from DD03L (DD03T holds only the label)
  const dd03Sql =
    `SELECT FIELDNAME, KEYFLAG, ROLLNAME, DATATYPE, LENG, DECIMALS, POSITION ` +
    `FROM DD03L WHERE TABNAME = '${baseTable}' AND AS4LOCAL = 'A' ` +
    `AND FIELDNAME <> '.INCLUDE' ORDER BY POSITION`
  const fields = tableRows(
    await runSql(client, dd03Sql, 100).catch(() => ({ columns: [], values: [] }))
  )

  // 5. TDDAT — authorization group for the table
  const tddatSql = `SELECT TABNAME, CCLASS FROM TDDAT WHERE TABNAME = '${baseTable}'`
  const tddatRows = tableRows(
    await runSql(client, tddatSql, 1).catch(() => ({ columns: [], values: [] }))
  )
  const authGroup = (tddatRows[0] ? col(tddatRows[0], "CCLASS") : "") || maint.authGroup || ""

  // 6. View cluster membership comes from the resolver (VCLSTRUC OBJECT = view)
  const clusterName = maint.cluster

  // 7. Foreign key references for key fields (DD08L) — tells us org-unit fields
  const keyFields = fields.filter(f => col(f, "KEYFLAG") === "X").map(f => col(f, "FIELDNAME"))
  let fkRows: Record<string, string>[] = []
  if (keyFields.length > 0) {
    const fkIn = keyFields.map(f => `'${f}'`).join(",")
    const fkSql =
      `SELECT TABNAME, FIELDNAME, CHECKTABLE, CHECKFIELD, FRKEYNAME ` +
      `FROM DD08L WHERE TABNAME = '${baseTable}' AND FIELDNAME IN (${fkIn}) AND AS4LOCAL = 'A'`
    fkRows = tableRows(await runSql(client, fkSql, 20).catch(() => ({ columns: [], values: [] })))
  }

  // ── Format output ──────────────────────────────────────────────────────────

  const lines: string[] = [
    `Customizing object: ${obj}`,
    dd02 ? `Description:        ${col(dd02, "DDTEXT")}` : "",
    `Base table:         ${baseTable}`
  ]

  if (maint.isView) {
    lines.push(
      `Maintenance view:   ${maint.view}  (${maint.maintTcode ?? "SM30"})`,
      `Table set:          ${maint.tables.join(" + ")}${maint.textTable ? `   (text table: ${maint.textTable})` : ""}`,
      `Function group:     ${maint.funcGroup ?? "?"}   Maint. type: ${maint.maintType === "2" ? "2 (two-step)" : (maint.maintType ?? "?")}`
    )
  }
  if (maint.imgActivity) {
    lines.push(
      `IMG activity:       ${maint.imgActivity}${maint.imgActivityText ? `  —  ${maint.imgActivityText}` : ""}`
    )
  }
  lines.push(
    `Transport object:   R3TR ${maint.transport.object} ${maint.transport.name}` +
      (maint.transport.object === "VDAT" ? "   (records the whole view: base + text table)" : "")
  )
  if (dd02) {
    const cf = col(dd02, "CONTFLAG")
    const cfDesc: Record<string, string> = {
      C: "C — customizing (transport with workbench/cust. request)",
      G: "G — customizing (client-independent)",
      S: "S — system (SAP-managed, not transportable)",
      E: "E — system (client-independent)",
      W: "W — system (client-independent, industry solution)",
      A: "A — application data",
      L: "L — local / temporary"
    }
    lines.push(`Delivery class:     ${cfDesc[cf] ?? cf}`)
    lines.push(
      `Client-dependent:   ${col(dd02, "CLIDEP") === "X" ? "yes (MANDT key field)" : "no"}`
    )
  }
  lines.push(
    `Auth group (TDDAT): ${authGroup || "(none — S_TABU_DIS with &NC& or check TVDIR CCLASS)"}`
  )

  if (clusterName) {
    lines.push(
      `View cluster:       ${clusterName} (member-view maintenance; recorded as R3TR CDAT with member table keys)`
    )
  }

  if (fields.length > 0) {
    lines.push("", `Fields (${fields.length}):`)
    lines.push(
      `  ${"Field".padEnd(30)} ${"Key"} ${"Type".padEnd(8)} ${"Len".padEnd(5)} Description`
    )
    lines.push(`  ${"-".repeat(80)}`)
    for (const f of fields) {
      const key = col(f, "KEYFLAG") === "X" ? "🔑 " : "   "
      const name = col(f, "FIELDNAME").padEnd(30)
      const dt = col(f, "DATATYPE").padEnd(8)
      const len = col(f, "LENG").padEnd(5)
      const desc = col(f, "DDTEXT")
      lines.push(`  ${name} ${key} ${dt} ${len} ${desc}`)
    }
  }

  if (fkRows.length > 0) {
    lines.push("", "Foreign keys on key fields (org-unit candidates):")
    for (const fk of fkRows) {
      lines.push(
        `  ${col(fk, "FIELDNAME").padEnd(20)} → ${col(fk, "CHECKTABLE")}.${col(fk, "CHECKFIELD")}`
      )
    }
  }

  lines.push(
    "",
    `Next steps:`,
    `  customizing_read   objectName: ${obj}  — read current config rows`,
    `  customizing_diff   objectName: ${obj}  sourceKey: <val>  targetKey: <val>  keyField: <field>  — compare two org units`
  )

  return { content: [{ type: "text" as const, text: lines.filter(l => l !== null).join("\n") }] }
}

// ─── customizing_read ─────────────────────────────────────────────────────────

export async function handleCustomizingRead(args: {
  objectName: string
  keyField?: string
  keyValue?: string
  maxRows?: number
  connectionId?: string
}) {
  const client = await ensureConnected(args.connectionId)
  const table = objectName(args.objectName)
  const max = args.maxRows ?? 100

  // Resolve underlying base table if a view was passed
  const baseTable = (await resolveMaint(client, table)).rootTable

  let whereClause: string | undefined
  if (args.keyField !== undefined && args.keyValue !== undefined) {
    const kf = objectName(args.keyField)
    const kv = args.keyValue.replace(/'/g, "''")
    whereClause = `${kf} = '${kv}'`
  }

  if ((args.keyField === undefined) !== (args.keyValue === undefined))
    throw new Error("keyField and keyValue must be supplied together")
  const result = await runSql(
    client,
    `SELECT * FROM ${baseTable}${whereClause ? ` WHERE ${whereClause}` : ""}`,
    max
  )

  const text = formatQueryResult(result)
  const header = whereClause
    ? `Customizing: ${baseTable}  WHERE ${whereClause}\n\n`
    : `Customizing: ${baseTable}  (first ${max} rows)\n\n`

  return { content: [{ type: "text" as const, text: header + text }] }
}

// ─── customizing_diff ─────────────────────────────────────────────────────────
