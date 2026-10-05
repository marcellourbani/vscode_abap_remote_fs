import { type CellResult } from "./types"

export function interpolateSql(
  rawSql: string,
  cellResults: Map<number, CellResult>,
  nameToIndex: Map<string, number> = new Map()
): string {
  if (!rawSql.includes("${cells")) return rawSql

  // ${cells[5].result...} | ${cells.name.result...} | ${cells["name"].result...}
  const pattern =
    /\$\{cells(?:\[(\d+)\]|\.([A-Za-z_]\w*)|\[["']([A-Za-z_]\w*)["']\])\.result((?:\.[a-zA-Z_]\w*(?:\[\d+\])?)*)\}/g

  return rawSql.replace(pattern, (_match, indexStr, dotName, quotedName, pathStr) => {
    const name: string | undefined = dotName ?? quotedName
    let cellIndex: number
    if (name !== undefined) {
      const idx = nameToIndex.get(name)
      if (idx === undefined) {
        throw new InterpolationError(`No cell is named '${name}'.`, -1)
      }
      cellIndex = idx
    } else {
      cellIndex = parseInt(indexStr, 10)
    }
    const label = name !== undefined ? `'${name}' (cell ${cellIndex})` : `[${cellIndex}]`
    const cellResult = cellResults.get(cellIndex)
    if (!cellResult) {
      throw new InterpolationError(`Cell ${label} has no result. Run it first.`, cellIndex)
    }

    let value: unknown = cellResult.result
    if (pathStr) {
      value = resolvePath(value, pathStr, cellIndex)
    }

    if (value === null || value === undefined) {
      throw new InterpolationError(
        `Cell ${label} result${pathStr || ""} is ${String(value)}. Cannot interpolate null/undefined into SQL.`,
        cellIndex
      )
    }

    return formatValueForSql(value)
  })
}

function resolvePath(obj: unknown, pathStr: string, cellIndex: number): unknown {
  const segments = parsePathSegments(pathStr)
  let current: any = obj

  for (const seg of segments) {
    if (current == null) {
      throw new InterpolationError(
        `Cannot read '${seg}' from null/undefined in cell [${cellIndex}] result`,
        cellIndex
      )
    }
    current = current[seg]
  }
  return current
}

function parsePathSegments(pathStr: string): Array<string | number> {
  const segments: Array<string | number> = []
  const regex = /\.([a-zA-Z_]\w*)|\[(\d+)\]/g
  let m
  while ((m = regex.exec(pathStr)) !== null) {
    if (m[1] !== undefined) segments.push(m[1])
    else if (m[2] !== undefined) segments.push(parseInt(m[2], 10))
  }
  return segments
}

function formatValueForSql(value: unknown): string {
  if (typeof value === "number") {
    if (!isFinite(value)) {
      throw new InterpolationError(`Cannot interpolate ${value} (NaN/Infinity) into SQL.`, -1)
    }
    const str = String(value)
    if (str.includes("e") || str.includes("E")) {
      return `'${str}'`
    }
    return str
  }

  if (typeof value === "boolean") {
    throw new InterpolationError(
      `Cannot interpolate boolean '${value}' into SQL. Convert to string or number first.`,
      -1
    )
  }

  if (typeof value === "string") return `'${escapeSqlString(value)}'`

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new InterpolationError("Cannot interpolate an empty array into SQL.", -1)
    }
    if (value.length > 1000) {
      throw new InterpolationError(
        `Array has ${value.length} elements — too large for SQL interpolation (max 1000). Filter the data in a JavaScript cell first.`,
        -1
      )
    }
    return value.map(v => formatValueForSql(v)).join(",")
  }

  if (typeof value === "object") {
    throw new InterpolationError(
      `Cannot interpolate an object into SQL. Access a specific property (e.g., .FIELD_NAME).`,
      -1
    )
  }

  return `'${escapeSqlString(String(value))}'`
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''")
}

export class InterpolationError extends Error {
  constructor(
    message: string,
    public readonly cellIndex: number
  ) {
    super(message)
    this.name = "InterpolationError"
  }
}
