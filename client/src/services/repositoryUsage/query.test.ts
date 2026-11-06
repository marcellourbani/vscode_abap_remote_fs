import { describe, expect, it, vi } from "vitest"
import { countedQuery } from "./query"

describe("count once and fetch once", () => {
  it("does not fetch data if cancelled during the count request", async () => {
    const controller = new AbortController()
    let release!: (value: unknown) => void
    let started!: () => void
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    const runQuery = vi.fn().mockImplementationOnce(() => {
      started()
      return new Promise(resolve => {
        release = resolve
      })
    })
    const operation = countedQuery({ runQuery }, "sample", ["name"], "", controller.signal)
    const rejected = expect(operation).rejects.toThrow("Analysis paused")
    await entered
    controller.abort()
    release({ values: [{ TOTAL: "2" }] })
    await rejected
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
  it("uses identical selection filters and passes the full count as the ADT row limit", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ NAME: "A" }, { NAME: "B" }] })
    expect(await countedQuery({ runQuery }, "sample", ["name"], "category = 'Z'")).toHaveLength(2)
    expect(runQuery.mock.calls).toEqual([
      ["SELECT COUNT(*) AS total FROM sample WHERE category = 'Z'", 1, true],
      ["SELECT name FROM sample WHERE category = 'Z'", 1002, true]
    ])
  })
  it.each([12001, 100000])(
    "fetches %i rows in one data request without paging or a fixed row cap",
    async total => {
      const values = Array.from({ length: total }, (_, index) => ({ NAME: `Z${index}` }))
      const runQuery = vi
        .fn()
        .mockResolvedValueOnce({ values: [{ TOTAL: String(total) }] })
        .mockResolvedValueOnce({ values })
      expect(await countedQuery({ runQuery }, "sample", ["name"])).toHaveLength(total)
      expect(runQuery).toHaveBeenCalledTimes(2)
      expect(runQuery.mock.calls[1]).toEqual(["SELECT name FROM sample", total + 1000, true])
    }
  )
  it("fetches with headroom even when the initial count is zero and reports missing rows", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
      .mockResolvedValueOnce({ values: [] })
    expect(await countedQuery({ runQuery }, "sample", ["name"])).toEqual([])
    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(runQuery.mock.calls[1][1]).toBe(1000)
    runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ NAME: "A" }] })
    await expect(countedQuery({ runQuery }, "sample", ["name"])).rejects.toThrow(
      /incomplete|expected/i
    )
  })
  it("does not add cursor predicates or sorting to a TADIR query", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({
        values: [
          { PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZFIRST" },
          { PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZSECOND" }
        ]
      })
    await countedQuery(
      { runQuery },
      "tadir",
      ["pgmid", "object", "obj_name", "devclass"],
      "devclass = 'ZPACKAGE'"
    )
    expect(runQuery.mock.calls[1]).toEqual([
      "SELECT pgmid,object,obj_name,devclass FROM tadir WHERE devclass = 'ZPACKAGE'",
      1002,
      true
    ])
    expect(runQuery).toHaveBeenCalledTimes(2)
  })
  it("awaits progress callbacks and stops before fetching when progress requests cancellation", async () => {
    const controller = new AbortController()
    const runQuery = vi.fn().mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
    const progress = vi.fn(async () => {
      await Promise.resolve()
      controller.abort()
    })
    await expect(
      countedQuery({ runQuery }, "sample", ["name"], "", controller.signal, progress)
    ).rejects.toThrow("Analysis paused")
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
  it.each(["-1", "1.5", "not a count"])(
    "rejects invalid count %s without fetching rows",
    async total => {
      const runQuery = vi.fn().mockResolvedValueOnce({ values: [{ TOTAL: total }] })
      await expect(countedQuery({ runQuery }, "sample", ["name"])).rejects.toThrow(
        /invalid row count/i
      )
      expect(runQuery).toHaveBeenCalledTimes(1)
    }
  )
  it("rejects a cancelled in-flight data result without starting another request", async () => {
    const controller = new AbortController()
    let release!: (value: unknown) => void
    let started!: () => void
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
      .mockImplementationOnce(() => {
        started()
        return new Promise(resolve => {
          release = resolve
        })
      })
    const operation = countedQuery({ runQuery }, "sample", ["name"], "", controller.signal)
    const rejected = expect(operation).rejects.toThrow("Analysis paused")
    await entered
    controller.abort()
    release({ values: [{ NAME: "A" }] })
    await rejected
    expect(runQuery).toHaveBeenCalledTimes(2)
  })
  it("does not discard legitimate duplicate rows or add a sorting requirement", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ NAME: "A" }, { NAME: "A" }] })
    expect(await countedQuery({ runQuery }, "sample", ["name"])).toEqual([
      { NAME: "A" },
      { NAME: "A" }
    ])
    expect(runQuery.mock.calls[1][0]).toBe("SELECT name FROM sample")
  })
  it("keeps rows created between the count and fetch", async () => {
    const values = Array.from({ length: 10 }, (_, index) => ({ NAME: `Z${index}` }))
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values })
    expect(await countedQuery({ runQuery }, "sample", ["name"])).toHaveLength(10)
    expect(runQuery.mock.calls[1][1]).toBe(1002)
  })
  it("keeps records created after an initial zero count", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
      .mockResolvedValueOnce({ values: [{ NAME: "NEW" }] })
    expect(await countedQuery({ runQuery }, "sample", ["name"])).toEqual([{ NAME: "NEW" }])
  })
  it.each([1002, 1003])(
    "reports a possibly truncated result of %i rows instead of assuming ADT sends an extra row",
    async actual => {
      const runQuery = vi
        .fn()
        .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
        .mockResolvedValueOnce({ values: Array.from({ length: actual }, () => ({ NAME: "A" })) })
      await expect(countedQuery({ runQuery }, "sample", ["name"])).rejects.toThrow(
        /limit|incomplete|truncat/i
      )
      expect(runQuery).toHaveBeenCalledTimes(2)
    }
  )
})
