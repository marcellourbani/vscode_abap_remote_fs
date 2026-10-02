import {
  buildCellData,
  findCellReferences,
  indexRefsToNames,
  renameReferences,
  validateCellName
} from "./cellReferences"
import { buildRunPlan, describePlan, missingSystems, resolveEffectiveSystems } from "./systemPlan"
import {
  createDisplayHelpers,
  isDisplayValue,
  prettyXml,
  splitDisplay,
  statusKind,
  toXml
} from "./display"
import { interpolateSql } from "./interpolation"
import { type CellResult } from "./types"

const sql = (cells: Array<{ system?: string }>) => cells.map(c => ({ ...c, sql: true }))

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
      [4, { result: [1], system: "dev" }],
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
    expect(data.s1).toEqual({ result: [1], index: 4, system: "dev", name: "s1" })
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

describe("system per cell", () => {
  test("marker is sticky until the next marker", () => {
    const eff = resolveEffectiveSystems(sql([{ system: "DEV" }, {}, {}, { system: "QAS" }, {}]))
    expect(eff.map(e => e.system)).toEqual(["DEV", "DEV", "DEV", "QAS", "QAS"])
    expect(eff[2].from).toBe(0)
    expect(eff[4].from).toBe(3)
  })

  test("cells before the first marker have no system", () => {
    expect(resolveEffectiveSystems(sql([{}, { system: "DEV" }])).map(e => e.system)).toEqual([
      undefined,
      "DEV"
    ])
  })

  test("user example: cell 0 = System1, cell 9 = System2", () => {
    const cells = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? { system: "SYS1" } : i === 9 ? { system: "SYS2" } : {}
    )
    const eff = resolveEffectiveSystems(sql(cells))
    expect(eff.slice(0, 9).every(e => e.system === "SYS1")).toBe(true)
    expect(eff.slice(9).every(e => e.system === "SYS2")).toBe(true)
  })

  test("only SQL cells carry or inherit a system", () => {
    // 0 md(DEV, ignored)  1 sql  2 sql(QAS)  3 js(PRD, ignored)  4 sql  5 js
    const eff = resolveEffectiveSystems([
      { system: "DEV", sql: false },
      { sql: true },
      { system: "QAS", sql: true },
      { system: "PRD", sql: false },
      { sql: true },
      { sql: false }
    ])
    expect(eff).toEqual([{}, {}, { system: "QAS", from: 2 }, {}, { system: "QAS", from: 2 }, {}])
  })

  test("removing the middle marker of three: later cells point at the right marker", () => {
    // reviewer scenario: SQL SYS1, SQL SYS2, SQL SYS3, JS — then the SYS2 marker is removed
    const cells = [
      { system: "SYS1", sql: true },
      { sql: true },
      { system: "SYS3", sql: true },
      { sql: false }
    ]
    expect(resolveEffectiveSystems(cells)).toEqual([
      { system: "SYS1", from: 0 },
      { system: "SYS1", from: 0 },
      { system: "SYS3", from: 2 },
      {}
    ])
  })

  test("run plan groups contiguous cells and counts SQL cells", () => {
    const eff = resolveEffectiveSystems(sql([{ system: "DEV" }, {}, {}, { system: "QAS" }, {}]))
    const plan = buildRunPlan(
      [0, 1, 2, 3, 4].map(i => ({ index: i, needsSystem: i !== 2 })),
      eff
    )
    expect(plan).toEqual([
      { system: "DEV", first: 0, last: 2, sqlCells: 2 },
      { system: "QAS", first: 3, last: 4, sqlCells: 2 }
    ])
    expect(describePlan(plan)).toBe("Cells 0-2 -> DEV  (2 SQL)\nCells 3-4 -> QAS  (2 SQL)")
    expect(missingSystems(plan, s => s.toLowerCase() === "dev")).toEqual(["QAS"])
  })

  test("JavaScript and markdown cells do not split the plan", () => {
    // 0 md, 1 js, 2 md, 3 sql(DEV), 4 js, 5 sql, 6 md, 7 sql(QAS), 8 js, 9 sql
    const isSql = (i: number) => [3, 5, 7, 9].includes(i)
    const eff = resolveEffectiveSystems(
      Array.from({ length: 10 }, (_, i) => ({
        sql: isSql(i),
        system: i === 3 ? "DEV" : i === 7 ? "QAS" : undefined
      }))
    )
    const plan = buildRunPlan(
      [1, 3, 4, 5, 7, 8, 9].map(i => ({ index: i, needsSystem: isSql(i) })),
      eff
    )
    expect(describePlan(plan)).toBe("Cells 1-5 -> DEV  (2 SQL)\nCells 7-9 -> QAS  (2 SQL)")
  })
})

describe("display helpers", () => {
  const display = createDisplayHelpers()
  test("markers are recognised and carry options", () => {
    const d = display.table([{ a: 1 }], { wrap: true, highlight: true })
    expect(isDisplayValue(d)).toBe(true)
    expect(d.options).toEqual({ wrap: true, highlight: true })
  })
  test("data for later cells: table content by default, explicit data wins", () => {
    expect(splitDisplay(display.table([{ a: 1 }])).data).toEqual([{ a: 1 }])
    expect(splitDisplay(display.html("<b>x</b>", { data: [{ b: 2 }] })).data).toEqual([{ b: 2 }])
    expect(
      splitDisplay(display.all(display.markdown("# t"), display.table([{ c: 3 }]))).data
    ).toEqual([{ c: 3 }])
    expect(splitDisplay([{ plain: 1 }])).toEqual({ data: [{ plain: 1 }] })
  })
  test("structured clone keeps markers intact", () => {
    const v8 = require("v8")
    const d = v8.deserialize(v8.serialize(display.json({ x: 1 }, { title: "T" })))
    expect(isDisplayValue(d)).toBe(true)
  })
  test("toXml and prettyXml", () => {
    expect(toXml([{ A: "x<y", B: 1 }], "rows")).toBe(
      "<rows>\n  <row>\n    <A>x&lt;y</A>\n    <B>1</B>\n  </row>\n</rows>"
    )
    expect(prettyXml("<a><b>1</b><c/></a>")).toBe("<a>\n  <b>1</b>\n  <c/>\n</a>")
  })
  test("status words", () => {
    expect(statusKind("RED")).toBe("red")
    expect(statusKind("[PASS]")).toBe("green")
    expect(statusKind(" warn ")).toBe("yellow")
    expect(statusKind("REDUCED")).toBeUndefined()
  })
})
