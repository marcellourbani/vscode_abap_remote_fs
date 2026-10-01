import {
  buildCellData,
  findCellReferences,
  indexRefsToNames,
  renameReferences,
  validateCellName
} from "./cellReferences"
import { interpolateSql } from "./interpolation"
import { type CellResult } from "./types"

describe("named cell references", () => {
  test("finds index, dot and quoted references", () => {
    const r = findCellReferences(
      `cells[3].result; cells.s1_auth.result; cells["s2_org"]; cells['x']; cells . y`
    )
    expect([...r.indices]).toEqual([3])
    expect([...r.names].sort()).toEqual(["s1_auth", "s2_org", "x", "y"])
  })

  test("does not treat mycells.x as a reference", () => {
    expect(findCellReferences("mycells.x; cellsX.y").names.size).toBe(0)
  })

  test("buildCellData keys by index and by name", () => {
    const results = new Map<number, CellResult>([
      [4, { result: [1] }],
      [9, { result: [2] }]
    ])
    const names = new Map([
      ["s1", 4],
      ["s2", 9]
    ])
    const data = buildCellData(
      results,
      findCellReferences("cells.s1; cells[9]; cells.missing"),
      names
    )
    expect(data.s1).toEqual({ result: [1], index: 4, name: "s1" })
    expect(data["9"]).toEqual({ result: [2], index: 9, name: "s2" })
    expect(data.missing).toBeUndefined()
  })

  test("validates names", () => {
    expect(validateCellName("s1_auth")).toBeUndefined()
    expect(validateCellName("")).toBeUndefined()
    expect(validateCellName("1x")).toBeDefined()
    expect(validateCellName("a-b")).toBeDefined()
    expect(validateCellName("then")).toMatch(/reserved/)
    expect(validateCellName("dup", ["dup"])).toMatch(/already/)
  })

  test("renames references but not look-alikes", () => {
    const code = `cells.auth.result + cells["auth"].x + cells.auth2 + ${"${cells.auth.result.X}"}`
    expect(renameReferences(code, "auth", "s1_auth")).toBe(
      `cells.s1_auth.result + cells["s1_auth"].x + cells.auth2 + ${"${cells.s1_auth.result.X}"}`
    )
  })

  test("converts index references to names where a name exists", () => {
    expect(indexRefsToNames("cells[1].result + cells[2]", new Map([[1, "params"]]))).toBe(
      "cells.params.result + cells[2]"
    )
  })
})

describe("SQL interpolation by name", () => {
  const results = new Map<number, CellResult>([
    [1, { result: Object.assign([{}], { ROLE_NAME: "Z_ROLE" }) }]
  ])
  const names = new Map([["params", 1]])
  test("dot and quoted names", () => {
    expect(interpolateSql("WHERE a = ${cells.params.result.ROLE_NAME}", results, names)).toBe(
      "WHERE a = 'Z_ROLE'"
    )
    expect(interpolateSql("WHERE a = ${cells['params'].result.ROLE_NAME}", results, names)).toBe(
      "WHERE a = 'Z_ROLE'"
    )
  })
  test("index still works", () => {
    expect(interpolateSql("x = ${cells[1].result.ROLE_NAME}", results, names)).toBe("x = 'Z_ROLE'")
  })
  test("unknown name gives a clear error", () => {
    expect(() => interpolateSql("x = ${cells.nope.result.A}", results, names)).toThrow(
      /No cell is named 'nope'/
    )
  })
  test("named cell without result", () => {
    expect(() => interpolateSql("x = ${cells.p2.result.A}", results, new Map([["p2", 7]]))).toThrow(
      /'p2' \(cell 7\) has no result/
    )
  })
})
