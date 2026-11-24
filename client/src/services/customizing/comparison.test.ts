import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("./query", async importOriginal => ({
  ...(await importOriginal<typeof import("./query")>()),
  ensureConnected: vi.fn()
}))
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("./resolver", () => ({ resolveMaint: vi.fn() }))
import {
  compareRows,
  fingerprint,
  handleCustomizingDiff,
  handleCustomizingPlanChange
} from "./comparison"
import { ensureConnected } from "./query"
import { resolveMaint } from "./resolver"

const source = { MANDT: "100", WERKS: "0001", KEY: "A", TEXT: "Before" }
const target = { ...source, WERKS: "0002", TEXT: "After" }
describe("configuration comparison semantics", () => {
  it("distinguishes changed values from missing primary keys", () => {
    const result = compareRows([source], [target], ["MANDT", "WERKS", "KEY"], "WERKS")
    expect(result.missing).toEqual([])
    expect(result.changed).toEqual([{ source, target }])
  })
  it("ignores only client and organizational key for equality", () => {
    expect(
      compareRows([source], [{ ...source, WERKS: "0002", MANDT: "200" }], ["WERKS", "KEY"], "WERKS")
        .identical
    ).toEqual([source])
  })
  it("identifies source-only and target-only rows", () => {
    const other = { ...target, KEY: "B" }
    expect(compareRows([source], [other], ["WERKS", "KEY"], "WERKS")).toMatchObject({
      missing: [source],
      targetOnly: [other],
      changed: [],
      identical: []
    })
  })
  it("does not collide on embedded delimiters, blank or absent values", () => {
    expect(fingerprint({ A: "x|y", B: "z" }, ["A", "B"])).not.toBe(
      fingerprint({ A: "x", B: "y|z" }, ["A", "B"])
    )
    expect(fingerprint({ A: "" }, ["A"])).not.toBe(fingerprint({}, ["A"]))
  })
  it("compares composite keys independently of row order", () => {
    const rows = [
      { ...source, LANG: "E" },
      { ...source, LANG: "D" }
    ]
    const targets = [
      { ...rows[1], WERKS: "0002" },
      { ...rows[0], WERKS: "0002" }
    ]
    expect(compareRows(rows, targets, ["WERKS", "KEY", "LANG"], "WERKS").identical).toEqual(rows)
  })
  it("detects fields present on only one side", () => {
    expect(
      compareRows([source], [{ ...target, EXTRA: "" }], ["WERKS", "KEY"], "WERKS").changed
    ).toHaveLength(1)
  })
  it("does not mutate input rows or key arrays", () => {
    const row = Object.freeze({ ...source }),
      keys = ["WERKS", "KEY"]
    compareRows([row], [target], keys, "WERKS")
    expect(row).toEqual(source)
    expect(keys).toEqual(["WERKS", "KEY"])
  })
  it("matches singleton scope rows when no other business key exists", () => {
    expect(compareRows([source], [target], ["WERKS"], "WERKS").changed).toHaveLength(1)
  })
  it("handles empty datasets", () =>
    expect(compareRows([], [], ["KEY"], "WERKS")).toEqual({
      missing: [],
      changed: [],
      identical: [],
      targetOnly: []
    }))
})

describe("query-backed plans", () => {
  const runQuery = vi.fn()
  const input = {
    connectionId: "example",
    objectName: "ZCFG",
    keyField: "WERKS",
    sourceKey: "0001",
    targetKey: "0002"
  }
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(ensureConnected).mockResolvedValue({ statelessClone: { runQuery } } as never)
    vi.mocked(resolveMaint).mockResolvedValue({
      rootTable: "ZCFG",
      tables: ["ZCFG"],
      maintObject: "ZCFG"
    } as never)
    runQuery
      .mockResolvedValueOnce({
        values: [
          { FIELDNAME: "WERKS", KEYFLAG: "X" },
          { FIELDNAME: "KEY", KEYFLAG: "X" },
          { FIELDNAME: "TEXT", KEYFLAG: "" }
        ]
      })
      .mockResolvedValueOnce({ values: [source] })
      .mockResolvedValueOnce({ values: [target] })
  })
  it("does not plan an insert when only non-key values changed", async () => {
    expect(await handleCustomizingPlanChange(input)).toMatchObject({
      dryRun: true,
      inserts: 0,
      updates: 0,
      rows: []
    })
  })
  it("plans updates only when requested", async () => {
    expect(await handleCustomizingPlanChange({ ...input, onlyMissing: false })).toMatchObject({
      inserts: 0,
      updates: 1,
      rows: [{ ...source, WERKS: "0002" }]
    })
  })
  it("returns complete diff with changed rows", async () => {
    expect(await handleCustomizingDiff(input)).toMatchObject({
      complete: true,
      sourceRows: 1,
      targetRows: 1,
      changed: [{ source, target }]
    })
  })
  it("refuses truncated data rather than reporting equality", async () => {
    runQuery
      .mockReset()
      .mockResolvedValueOnce({ values: [{ FIELDNAME: "WERKS", KEYFLAG: "X" }] })
      .mockResolvedValueOnce({ values: [source, source] })
      .mockResolvedValueOnce({ values: [] })
    await expect(handleCustomizingDiff({ ...input, maxRows: 1 })).rejects.toThrow("exceeds maxRows")
  })
  it.each(["WERKS OR 1=1", "WERKS;DELETE", "'", ""])(
    "rejects unsafe scope field %s",
    async keyField => {
      await expect(handleCustomizingDiff({ ...input, keyField })).rejects.toThrow()
      expect(runQuery).not.toHaveBeenCalled()
    }
  )
  it.each([0, -1, 1.5, 10000, NaN])("rejects invalid service-level row limit %s", async maxRows => {
    await expect(handleCustomizingDiff({ ...input, maxRows })).rejects.toThrow("maxRows")
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
  it("rejects a missing scope field before reading configuration", async () => {
    runQuery.mockReset().mockResolvedValue({ values: [{ FIELDNAME: "KEY", KEYFLAG: "X" }] })
    await expect(handleCustomizingDiff(input)).rejects.toThrow("does not exist")
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
  it("rejects non-key scope fields", async () => {
    await expect(handleCustomizingDiff({ ...input, keyField: "TEXT" })).rejects.toThrow(
      "must be a key"
    )
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
  it("escapes source and target literals without changing leading zeros", async () => {
    await handleCustomizingDiff({ ...input, sourceKey: "00'1", targetKey: "00'2" })
    expect(runQuery.mock.calls[1][0]).toContain("'00''1'")
    expect(runQuery.mock.calls[2][0]).toContain("'00''2'")
  })
  it("accepts an exact row limit while requesting a sentinel row", async () => {
    expect(await handleCustomizingDiff({ ...input, maxRows: 1 })).toMatchObject({ complete: true })
    expect(runQuery.mock.calls[1][1]).toBe(2)
  })
  it.each(["source", "target"])("rejects %s-side truncation", async side => {
    runQuery
      .mockReset()
      .mockResolvedValueOnce({ values: [{ FIELDNAME: "WERKS", KEYFLAG: "X" }] })
      .mockResolvedValueOnce({ values: side === "source" ? [source, source] : [] })
      .mockResolvedValueOnce({ values: side === "target" ? [target, target] : [] })
    await expect(handleCustomizingPlanChange({ ...input, maxRows: 1 })).rejects.toThrow(
      "partial data"
    )
  })
  it("propagates DDIC query errors", async () => {
    runQuery.mockReset().mockRejectedValue(new Error("DDIC forbidden"))
    await expect(handleCustomizingDiff(input)).rejects.toThrow("DDIC forbidden")
  })
  it("propagates row read errors rather than producing a plan", async () => {
    runQuery
      .mockReset()
      .mockResolvedValueOnce({ values: [{ FIELDNAME: "WERKS", KEYFLAG: "X" }] })
      .mockRejectedValue(new Error("Read failed"))
    await expect(handleCustomizingPlanChange(input)).rejects.toThrow("Read failed")
  })
  it("plans only missing rows with their new scope key", async () => {
    runQuery
      .mockReset()
      .mockResolvedValueOnce({
        values: [
          { FIELDNAME: "WERKS", KEYFLAG: "X" },
          { FIELDNAME: "KEY", KEYFLAG: "X" }
        ]
      })
      .mockResolvedValueOnce({ values: [source] })
      .mockResolvedValueOnce({ values: [] })
    expect(await handleCustomizingPlanChange(input)).toMatchObject({
      inserts: 1,
      updates: 0,
      rows: [{ ...source, WERKS: "0002" }]
    })
    expect(source.WERKS).toBe("0001")
  })
  it("rejects identical source and target keys", async () => {
    await expect(handleCustomizingDiff({ ...input, targetKey: input.sourceKey })).rejects.toThrow(
      "must differ"
    )
  })
})
