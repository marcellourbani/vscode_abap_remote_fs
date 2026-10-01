/**
 * System-per-cell resolution.
 *
 * A cell that sets `system` applies to itself and every following cell until the next cell that
 * sets a system. Example: cell 0 = DEV, cell 9 = QAS  =>  cells 0-8 run on DEV, 9..N on QAS.
 */

export interface PlanCell {
  index: number
  system?: string
  /** true for cells that talk to SAP (SQL). */
  needsSystem: boolean
}

export const normalizeSystem = (s: string | undefined) => (s ? s.trim().toLowerCase() : "")

/** Effective system for every cell of the notebook (by position). */
export function resolveEffectiveSystems(
  cells: Array<{ system?: string }>
): Array<{ system?: string; from?: number }> {
  let current: string | undefined
  let from: number | undefined
  return cells.map((c, i) => {
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
    // consecutive cells on the same system form one range (markdown cells in between are not run)
    if (last && normalizeSystem(last.system) === normalizeSystem(sys)) {
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
