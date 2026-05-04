import { interpolateSql, InterpolationError } from "./interpolation"
import { CellResult } from "./types"

const makeResults = (...entries: Array<[number, unknown]>): Map<number, CellResult> => {
  const map = new Map<number, CellResult>()
  for (const [idx, result] of entries) {
    map.set(idx, { result })
  }
  return map
}

describe("interpolateSql", () => {
  test("returns unchanged SQL when no interpolation markers present", () => {
    const sql = "SELECT * FROM mara WHERE matnr = 'MAT001'"
    expect(interpolateSql(sql, new Map())).toBe(sql)
  })

  test("interpolates a simple string value", () => {
    const results = makeResults([0, "MAT001"])
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[0].result}"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE matnr = 'MAT001'"
    )
  })

  test("interpolates a number value without quotes", () => {
    const results = makeResults([0, 42])
    const sql = "SELECT * FROM mara WHERE mandt = ${cells[0].result}"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE mandt = 42"
    )
  })

  test("interpolates nested object property", () => {
    const results = makeResults([1, { MATNR: "MAT002" }])
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[1].result.MATNR}"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE matnr = 'MAT002'"
    )
  })

  test("interpolates deep nested property with array index", () => {
    const results = makeResults([0, { rows: [{ MATNR: "A" }, { MATNR: "B" }] }])
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[0].result.rows[1].MATNR}"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE matnr = 'B'"
    )
  })

  test("interpolates array into comma-separated list", () => {
    const results = makeResults([0, ["A", "B", "C"]])
    const sql = "SELECT * FROM mara WHERE matnr IN (${cells[0].result})"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE matnr IN ('A','B','C')"
    )
  })

  test("interpolates numeric array without quotes", () => {
    const results = makeResults([0, [1, 2, 3]])
    const sql = "SELECT * FROM t001 WHERE mandt IN (${cells[0].result})"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM t001 WHERE mandt IN (1,2,3)"
    )
  })

  test("escapes single quotes in strings", () => {
    const results = makeResults([0, "it's a test"])
    const sql = "SELECT * FROM mara WHERE name = ${cells[0].result}"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE name = 'it''s a test'"
    )
  })

  test("multiple interpolations in one query", () => {
    const results = makeResults([0, "MAT001"], [1, 100])
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[0].result} AND mandt = ${cells[1].result}"
    expect(interpolateSql(sql, results)).toBe(
      "SELECT * FROM mara WHERE matnr = 'MAT001' AND mandt = 100"
    )
  })

  test("throws InterpolationError when cell has no result", () => {
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[5].result}"
    expect(() => interpolateSql(sql, new Map())).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, new Map())).toThrow("Cell [5] has no result")
  })

  test("throws InterpolationError for null value", () => {
    const results = makeResults([0, null])
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[0].result}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("is null")
  })

  test("throws InterpolationError for undefined value", () => {
    const results = makeResults([0, undefined])
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[0].result}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
  })

  test("throws InterpolationError for boolean value", () => {
    const results = makeResults([0, true])
    const sql = "SELECT * FROM mara WHERE flag = ${cells[0].result}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("boolean")
  })

  test("throws InterpolationError for object value", () => {
    const results = makeResults([0, { a: 1 }])
    const sql = "SELECT * FROM mara WHERE x = ${cells[0].result}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("object")
  })

  test("throws InterpolationError for empty array", () => {
    const results = makeResults([0, []])
    const sql = "SELECT * FROM mara WHERE x IN (${cells[0].result})"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("empty array")
  })

  test("throws InterpolationError for oversized array", () => {
    const big = Array.from({ length: 1001 }, (_, i) => i)
    const results = makeResults([0, big])
    const sql = "SELECT * FROM mara WHERE x IN (${cells[0].result})"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("too large")
  })

  test("throws InterpolationError for NaN", () => {
    const results = makeResults([0, NaN])
    const sql = "SELECT * FROM mara WHERE x = ${cells[0].result}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("NaN")
  })

  test("throws InterpolationError for Infinity", () => {
    const results = makeResults([0, Infinity])
    const sql = "SELECT * FROM mara WHERE x = ${cells[0].result}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
  })

  test("throws when navigating into null object", () => {
    const results = makeResults([0, { a: null }])
    const sql = "SELECT * FROM mara WHERE x = ${cells[0].result.a.b}"
    expect(() => interpolateSql(sql, results)).toThrow(InterpolationError)
    expect(() => interpolateSql(sql, results)).toThrow("null/undefined")
  })

  test("InterpolationError has cellIndex", () => {
    const sql = "SELECT * FROM mara WHERE matnr = ${cells[3].result}"
    try {
      interpolateSql(sql, new Map())
      fail("Should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(InterpolationError)
      expect((e as InterpolationError).cellIndex).toBe(3)
    }
  })

  test("handles very large numbers", () => {
    const results = makeResults([0, 1e20])
    const sql = "SELECT * FROM mara WHERE x = ${cells[0].result}"
    const result = interpolateSql(sql, results)
    // 1e20 => "100000000000000000000" (no scientific notation in JS string)
    expect(result).toBe("SELECT * FROM mara WHERE x = 100000000000000000000")
  })
})
