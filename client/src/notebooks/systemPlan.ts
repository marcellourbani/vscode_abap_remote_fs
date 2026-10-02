/**
 * System-per-cell resolution.
 *
 * Only ABAP SQL cells talk to SAP, so only they carry or inherit a system. An SQL cell that sets
 * `system` applies to itself and every following SQL cell until the next SQL cell that sets one.
 * Example: SQL cell 1 = DEV, SQL cell 9 = QAS  =>  SQL cells 1-8 run on DEV, 9..N on QAS.
 * A `system` on a JavaScript or markdown cell is ignored.
 */

export interface PlanCell {
  index: number
  system?: string
  /** true for cells that talk to SAP (SQL). */
  needsSystem: boolean
}

export const normalizeSystem = (s: string | undefined) => (s ? s.trim().toLowerCase() : "")

/** Effective system for every cell of the notebook (by position). Non-SQL cells get none. */
export function resolveEffectiveSystems(
  cells: Array<{ system?: string; sql: boolean }>
): Array<{ system?: string; from?: number }> {
  let current: string | undefined
  let from: number | undefined
  return cells.map((c, i) => {
    if (!c.sql) return {}
    const s = c.system?.trim()
    if (s) {
      current = s
      from = i
    }
    return current ? { system: current, from } : {}
  })
}

export interface PlanRange {
  system?: string
  first: number
  last: number
  sqlCells: number
}

/** Group the cells about to run into contiguous ranges per system (for the confirmation). */
export function buildRunPlan(
  toRun: PlanCell[],
  effective: Array<{ system?: string }>
): PlanRange[] {
  const ranges: PlanRange[] = []
  for (const c of toRun) {
    const sys = effective[c.index]?.system
    const last = ranges[ranges.length - 1]
    // JavaScript cells have no system: they join the range they are in
    if (last && !c.needsSystem) {
      last.last = c.index
      continue
    }
    // consecutive cells on the same system form one range (markdown cells in between are not run)
    if (last && (!last.sqlCells || normalizeSystem(last.system) === normalizeSystem(sys))) {
      if (!last.sqlCells) last.system = sys
      last.last = c.index
      if (c.needsSystem) last.sqlCells++
    } else {
      ranges.push({ system: sys, first: c.index, last: c.index, sqlCells: c.needsSystem ? 1 : 0 })
    }
  }
  return ranges
}

export function describePlan(ranges: PlanRange[]): string {
  return ranges
    .filter(r => r.sqlCells > 0)
    .map(
      r =>
        `${r.first === r.last ? `Cell ${r.first}` : `Cells ${r.first}-${r.last}`} -> ${r.system ?? "(ask when run)"}  (${r.sqlCells} SQL)`
    )
    .join("\n")
}

/** Systems used by SQL cells in the plan that are not currently connected. */
export function missingSystems(
  ranges: PlanRange[],
  isConnected: (system: string) => boolean
): string[] {
  const missing = new Set<string>()
  for (const r of ranges)
    if (r.system && r.sqlCells > 0 && !isConnected(r.system)) missing.add(r.system)
  return [...missing]
}
