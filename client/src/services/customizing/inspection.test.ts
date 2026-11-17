import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("./query", async original => ({
  ...(await original<typeof import("./query")>()),
  ensureConnected: vi.fn()
}))
vi.mock("./resolver", () => ({ resolveMaint: vi.fn() }))
import { ensureConnected } from "./query"
import { resolveMaint } from "./resolver"
import { handleCustomizingDescribe, handleCustomizingRead } from "./inspection"

const input = { connectionId: "example", objectName: "ZCFG" }
const runQuery = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(ensureConnected).mockResolvedValue({ statelessClone: { runQuery } } as never)
  vi.mocked(resolveMaint).mockResolvedValue({
    rootTable: "ZCFG",
    tables: ["ZCFG"],
    transport: { object: "TABU", name: "ZCFG" }
  } as never)
  runQuery.mockResolvedValue({ values: [], columns: [] })
})

describe("configuration reads", () => {
  it("returns bounded base-table data", async () => {
    runQuery.mockResolvedValue({ values: [{ CODE: "0001" }], columns: [{ name: "CODE" }] })
    const result = await handleCustomizingRead(input)
    expect(runQuery).toHaveBeenCalledWith("SELECT * FROM ZCFG", 100, false)
    expect(result.content[0].text).toContain("0001")
  })
  it("reads the resolved base table rather than the maintenance view", async () => {
    vi.mocked(resolveMaint).mockResolvedValue({ rootTable: "ZBASE" } as never)
    await handleCustomizingRead({ ...input, objectName: "V_ZCFG" })
    expect(runQuery).toHaveBeenCalledWith("SELECT * FROM ZBASE", 100, false)
  })
  it("escapes filter values and normalizes identifiers", async () => {
    await handleCustomizingRead({ ...input, keyField: "code", keyValue: "00'1", maxRows: 5 })
    expect(runQuery).toHaveBeenCalledWith("SELECT * FROM ZCFG WHERE CODE = '00''1'", 5, false)
  })
  it("supports an explicit blank filter", async () => {
    await handleCustomizingRead({ ...input, keyField: "CODE", keyValue: "" })
    expect(runQuery.mock.calls[0][0]).toContain("CODE = ''")
  })
  it.each([{ keyField: "CODE" }, { keyValue: "0001" }])(
    "rejects an incomplete filter %#",
    async filter => {
      await expect(handleCustomizingRead({ ...input, ...filter })).rejects.toThrow("together")
      expect(runQuery).not.toHaveBeenCalled()
    }
  )
  it.each(["", "CODE OR 1=1", "CODE;DELETE"])("rejects unsafe filter %s", async keyField => {
    await expect(handleCustomizingRead({ ...input, keyField, keyValue: "1" })).rejects.toThrow()
    expect(runQuery).not.toHaveBeenCalled()
  })
  it.each([0, -1, 10001, 1.5])("rejects invalid row limit %s", async maxRows => {
    await expect(handleCustomizingRead({ ...input, maxRows })).rejects.toThrow("maxRows")
  })
  it("propagates data-read failures", async () => {
    runQuery.mockRejectedValue(new Error("Read forbidden"))
    await expect(handleCustomizingRead(input)).rejects.toThrow("Read forbidden")
  })
  it("propagates resolver failures", async () => {
    vi.mocked(resolveMaint).mockRejectedValue(new Error("Metadata unavailable"))
    await expect(handleCustomizingRead(input)).rejects.toThrow("Metadata unavailable")
  })
})

describe("configuration descriptions", () => {
  it("describes an object with missing optional metadata", async () => {
    const result = await handleCustomizingDescribe(input)
    expect(result.content[0].text).toContain("Base table:         ZCFG")
    expect(result.content[0].text).toContain("R3TR TABU ZCFG")
  })
  it.each(["C", "G", "S", "E", "W", "A", "L"])("describes delivery class %s", async CONTFLAG => {
    runQuery.mockImplementation(async (sql: string) => ({
      values: sql.includes("FROM DD02L") ? [{ CONTFLAG, CLIDEP: "X" }] : [],
      columns: []
    }))
    const result = await handleCustomizingDescribe(input)
    expect(result.content[0].text).toContain(`Delivery class:     ${CONTFLAG}`)
    expect(result.content[0].text).toContain("yes (MANDT key field)")
  })
  it("preserves maintenance view, cluster and IMG context", async () => {
    vi.mocked(resolveMaint).mockResolvedValue({
      rootTable: "ZCFG",
      isView: true,
      view: "V_ZCFG",
      tables: ["ZCFG", "ZCFGT"],
      textTable: "ZCFGT",
      funcGroup: "ZFG",
      maintType: "2",
      cluster: "ZCLUSTER",
      imgActivity: "ZACT",
      imgActivityText: "Plant setup",
      transport: { object: "CDAT", name: "ZCLUSTER" }
    } as never)
    const text = (await handleCustomizingDescribe(input)).content[0].text
    for (const value of [
      "V_ZCFG",
      "ZCFG + ZCFGT",
      "ZFG",
      "two-step",
      "ZCLUSTER",
      "ZACT",
      "Plant setup"
    ])
      expect(text).toContain(value)
  })
  it("formats key and non-key fields plus organizational foreign keys", async () => {
    runQuery.mockImplementation(async (sql: string) => ({
      values: sql.includes("FROM DD03L")
        ? [
            { FIELDNAME: "WERKS", KEYFLAG: "X", DATATYPE: "CHAR", LENG: "4" },
            { FIELDNAME: "TEXT", KEYFLAG: "", DATATYPE: "CHAR", LENG: "40" }
          ]
        : sql.includes("FROM DD08L")
          ? [{ FIELDNAME: "WERKS", CHECKTABLE: "ZPLANT", CHECKFIELD: "WERKS" }]
          : [],
      columns: []
    }))
    const text = (await handleCustomizingDescribe(input)).content[0].text
    for (const value of ["Fields (2)", "WERKS", "TEXT", "CHAR", "Foreign keys", "ZPLANT.WERKS"])
      expect(text).toContain(value)
  })
  it("uses the selected language in text lookup", async () => {
    await handleCustomizingDescribe({ ...input, language: "d" })
    expect(runQuery.mock.calls.some(call => call[0].includes("DDLANGUAGE = 'D'"))).toBe(true)
  })
  it.each(["DE", "E' OR '1'='1", ""])("rejects invalid language %s", async language => {
    await expect(handleCustomizingDescribe({ ...input, language })).rejects.toThrow("language")
    expect(runQuery).not.toHaveBeenCalled()
  })
  it("keeps optional metadata query failures from hiding resolved identity", async () => {
    runQuery.mockRejectedValue(new Error("Optional metadata forbidden"))
    const result = await handleCustomizingDescribe(input)
    expect(result.content[0].text).toContain("ZCFG")
  })
})
