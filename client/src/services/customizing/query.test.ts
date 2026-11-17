import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
import { getOrCreateClient } from "../../adt/conections"
import {
  ensureConnected,
  objectName,
  runSql,
  sqlLiteral,
  tableRows,
  col,
  formatQueryResult
} from "./query"

describe("shared ADT query adapter", () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([undefined, "", "   "])("requires an explicit connection %s", async connection => {
    await expect(ensureConnected(connection)).rejects.toThrow("required")
    expect(getOrCreateClient).not.toHaveBeenCalled()
  })
  it("trims the selected connection without changing its identity", async () => {
    await ensureConnected(" EXAMPLE ")
    expect(getOrCreateClient).toHaveBeenCalledWith("example", true)
  })
  it("can return the original client for stateful operations", async () => {
    await ensureConnected(" EXAMPLE ", false)
    expect(getOrCreateClient).toHaveBeenCalledWith("example", false)
  })
  it("propagates connection errors", async () => {
    vi.mocked(getOrCreateClient).mockRejectedValueOnce(new Error("Offline"))
    await expect(ensureConnected("example")).rejects.toThrow("Offline")
  })
  it.each(["", "'", "O'Brien", "0000", "' OR 1=1 --"])("escapes SQL literal %s", value => {
    expect(sqlLiteral(value)).toBe(value.split("'").join("''"))
  })
  it("normalizes column casing and SAP scalar values", () => {
    expect(
      tableRows({ values: [{ code: "0001  ", count: 2, missing: undefined, blank: " " }] } as never)
    ).toEqual([{ CODE: "0001", COUNT: "2", MISSING: "", BLANK: "" }])
  })
  it("handles missing rows and column aliases", () => {
    expect(tableRows({} as never)).toEqual([])
    expect(col({ ALIAS: "value" }, "MISSING", "ALIAS")).toBe("value")
    expect(col({ EMPTY: "", ALIAS: "value" }, "EMPTY", "ALIAS")).toBe("")
    expect(col({}, "MISSING")).toBe("")
  })
  it("formats rows without mutating their original values", () => {
    const result = { columns: [{ name: "CODE" }], values: [{ CODE: "0001 " }] }
    expect(JSON.parse(formatQueryResult(result as never))).toEqual({
      columns: result.columns,
      rows: result.values
    })
  })
  it.each([1, 10000])("accepts row boundary %s", async maxRows => {
    const runQuery = vi.fn().mockResolvedValue({ values: [] })
    await runSql({ statelessClone: { runQuery } } as never, "SELECT * FROM ZCFG", maxRows)
    expect(runQuery).toHaveBeenCalledWith("SELECT * FROM ZCFG", maxRows, false)
  })
  it("propagates SQL failures rather than returning empty data", async () => {
    const runQuery = vi.fn().mockRejectedValue(new Error("Forbidden"))
    await expect(
      runSql({ statelessClone: { runQuery } } as never, "SELECT * FROM ZCFG")
    ).rejects.toThrow("Forbidden")
  })
  it("normalizes the selected connection", async () => {
    await ensureConnected("EXAMPLE")
    expect(getOrCreateClient).toHaveBeenCalledWith("example", true)
  })
  it.each(["ZCFG", "/EXAMPLE/CONFIG", "WERKS", "field_1"])("accepts SAP identifier %s", name =>
    expect(objectName(name)).toBe(name.toUpperCase())
  )
  it.each(["", "X Y", "X;DROP", "X'", "X--", "X%", "X".repeat(121)])(
    "rejects invalid identifier %s",
    name => expect(() => objectName(name)).toThrow()
  )
  it("escapes literal apostrophes without losing leading zeros", () =>
    expect(sqlLiteral("0001'X")).toBe("0001''X"))
  it("preserves leading whitespace, zeros and blank values", () => {
    expect(tableRows({ values: [{ CODE: "0010", TEXT: " x  ", EMPTY: null }] } as never)).toEqual([
      { CODE: "0010", TEXT: " x", EMPTY: "" }
    ])
  })
  it.each([0, -1, 1.5, 10001, NaN])("rejects invalid row cap %s", async maxRows => {
    const runQuery = vi.fn()
    await expect(
      runSql({ statelessClone: { runQuery } } as never, "SELECT * FROM ZCFG", maxRows)
    ).rejects.toThrow("maxRows")
    expect(runQuery).not.toHaveBeenCalled()
  })
  it("uses raw stateless ADT queries without reconnecting or opening UI", async () => {
    const runQuery = vi.fn().mockResolvedValue({ values: [] })
    await runSql({ statelessClone: { runQuery } } as never, "SELECT * FROM ZCFG", 20)
    expect(runQuery).toHaveBeenCalledWith("SELECT * FROM ZCFG", 20, false)
  })
})
