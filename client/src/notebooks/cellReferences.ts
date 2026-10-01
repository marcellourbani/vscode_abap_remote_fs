/**
 * Cell references: by index (cells[5]) or by name (cells.s1_auth / cells["s1_auth"]).
 *
 * Names are stored in the cell metadata and survive inserting, deleting and moving cells,
 * so workbooks keep working when they are edited. Index references keep working as before.
 */
import { type CellResult } from "./types"

export const CELL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** Names that would clash with JavaScript/Proxy internals. */
const RESERVED = new Set([
  "then",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "length",
  "hasOwnProperty",
  "__proto__"
])

export function validateCellName(name: string, taken: Iterable<string> = []): string | undefined {
  if (!name) return undefined // empty = remove the name
  if (!CELL_NAME_PATTERN.test(name))
    return "Use letters, digits and _ only, starting with a letter or _ (max 64 characters)"
  if (/^\d/.test(name)) return "A name cannot start with a digit"
  if (RESERVED.has(name)) return `'${name}' is reserved`
  for (const t of taken) if (t === name) return `Another cell is already named '${name}'`
  return undefined
}

export interface CellRefs {
  indices: Set<number>
  names: Set<string>
}

export function findCellReferences(code: string): CellRefs {
  const indices = new Set<number>()
  const names = new Set<string>()
  let m: RegExpExecArray | null
  const byIndex = /\bcells\s*\[\s*(\d+)\s*\]/g
  while ((m = byIndex.exec(code)) !== null) indices.add(parseInt(m[1], 10))
  const byDot = /\bcells\s*\.\s*([A-Za-z_]\w*)/g
  while ((m = byDot.exec(code)) !== null) names.add(m[1])
  const byQuoted = /\bcells\s*\[\s*(["'`])([A-Za-z_]\w*)\1\s*\]/g
  while ((m = byQuoted.exec(code)) !== null) names.add(m[2])
  return { indices, names }
}

/**
 * Data handed to the JS worker: every referenced cell that has a result, keyed by its index
 * and (when it has one) by its name.
 */
export function buildCellData(
  resultsByIndex: Map<number, CellResult>,
  refs: CellRefs,
  nameToIndex: Map<string, number>
): Record<string, { result: unknown; system?: string; name?: string; index: number }> {
  const data: Record<string, { result: unknown; system?: string; name?: string; index: number }> =
    {}
  const indexToName = new Map<number, string>()
  for (const [n, i] of nameToIndex) indexToName.set(i, n)

  const add = (idx: number, key: string) => {
    const r = resultsByIndex.get(idx)
    if (!r) return
    data[key] = {
      result: r.result,
      index: idx,
      ...(r.system ? { system: r.system } : {}),
      ...(indexToName.has(idx) ? { name: indexToName.get(idx) } : {})
    }
  }
  for (const idx of refs.indices) add(idx, String(idx))
  for (const name of refs.names) {
    const idx = nameToIndex.get(name)
    if (idx !== undefined) add(idx, name)
  }
  return data
}

/** Replace references to a renamed cell in another cell's source. */
export function renameReferences(code: string, oldName: string, newName: string): string {
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return code
    .replace(new RegExp(`(\\bcells\\s*\\.\\s*)${esc}\\b`, "g"), `$1${newName}`)
    .replace(
      new RegExp(`(\\bcells\\s*\\[\\s*)(["'\`])${esc}\\2(\\s*\\])`, "g"),
      `$1$2${newName}$2$3`
    )
}

/** Replace index references (cells[5]) with name references (cells.s1_auth) where a name exists. */
export function indexRefsToNames(code: string, indexToName: Map<number, string>): string {
  return code.replace(/\bcells\s*\[\s*(\d+)\s*\]/g, (whole, idx) => {
    const name = indexToName.get(parseInt(idx, 10))
    return name ? `cells.${name}` : whole
  })
}
