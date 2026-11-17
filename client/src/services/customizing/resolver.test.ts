import { describe, expect, it, vi } from "vitest"
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
import { resolveMaint } from "./resolver"
import type { ADTClient } from "abap-adt-api"

function client(answers: [RegExp, Record<string, string>[]][]) {
  return {
    statelessClone: {
      runQuery: vi.fn(async (sql: string) => ({
        values: answers.find(([pattern]) => pattern.test(sql))?.[1] ?? []
      }))
    }
  } as unknown as ADTClient
}
describe("maintenance-object resolution", () => {
  it("resolves a maintenance view with base/text tables and cluster recording", async () => {
    const result = await resolveMaint(
      client([
        [/FROM DD25L WHERE VIEWNAME = 'V_ZCFG'/, [{ VIEWNAME: "V_ZCFG", ROOTTAB: "ZCFG" }]],
        [/FROM DD26S/, [{ TABNAME: "ZCFG" }, { TABNAME: "ZCFGT" }]],
        [/FROM DD03L/, [{ TABNAME: "ZCFGT" }]],
        [/FROM TVDIR/, [{ AREA: "ZFG", TYPE: "1", DEVCLASS: "ZPKG" }]],
        [/FROM VCLSTRUC/, [{ VCLNAME: "ZCLUSTER" }]],
        [/FROM TDDAT/, [{ CCLASS: "ZCFG" }]]
      ]),
      "V_ZCFG"
    )
    expect(result).toMatchObject({
      rootTable: "ZCFG",
      textTable: "ZCFGT",
      maintObject: "V_ZCFG",
      tables: ["ZCFG", "ZCFGT"],
      recordObject: "CDAT",
      transport: { object: "CDAT", name: "ZCLUSTER" }
    })
  })
  it("resolves single-table generated maintenance", async () => {
    const result = await resolveMaint(
      client([[/FROM TVDIR/, [{ TABNAME: "ZCFG", BASTAB: "X", AREA: "ZFG" }]]]),
      "ZCFG"
    )
    expect(result).toMatchObject({ maintObject: "ZCFG", recordObject: "TABU", rootTable: "ZCFG" })
  })
  it("never invents a maintenance runtime for an unmaintainable view", async () => {
    const result = await resolveMaint(
      client([[/FROM DD25L WHERE VIEWNAME = 'V_ZCFG'/, [{ VIEWNAME: "V_ZCFG", ROOTTAB: "ZCFG" }]]]),
      "V_ZCFG"
    )
    expect(result.maintObject).toBe("")
    expect(result.recordObject).toBeUndefined()
  })
  it("routes view variants through their actual maintenance view", async () => {
    const result = await resolveMaint(
      client([
        [
          /FROM DD25L WHERE VIEWNAME = 'V_VARIANT'/,
          [{ VIEWNAME: "V_VARIANT", ROOTTAB: "V_ZCFG", VIEWCLASS: "V" }]
        ],
        [/FROM DD25L WHERE VIEWNAME = 'V_ZCFG'/, [{ ROOTTAB: "ZCFG" }]],
        [/FROM TVDIR/, [{ TABNAME: "V_ZCFG", AREA: "ZFG" }]],
        [/FROM VCLSTRUC WHERE OBJECT = 'V_VARIANT'/, [{ VCLNAME: "ZCLUSTER" }]]
      ]),
      "V_VARIANT"
    )
    expect(result).toMatchObject({
      variant: "V_VARIANT",
      view: "V_ZCFG",
      rootTable: "ZCFG",
      maintObject: "V_ZCFG",
      recordObject: "CDAT"
    })
  })
  it.each(["", "Z';DROP", "Z CFG", "Z*", "X".repeat(121)])(
    "rejects unsafe object name %s before querying",
    async name => {
      const api = client([])
      await expect(resolveMaint(api, name)).rejects.toThrow("Invalid")
      expect(api.statelessClone.runQuery).not.toHaveBeenCalled()
    }
  )
  it("normalizes lowercase object names", async () => {
    expect(await resolveMaint(client([]), " zcfg ")).toMatchObject({
      input: "ZCFG",
      rootTable: "ZCFG"
    })
  })
  it("does not invent generated maintenance when metadata is empty", async () => {
    const result = await resolveMaint(client([]), "ZCFG")
    expect(result).toMatchObject({
      isView: false,
      tables: ["ZCFG"],
      maintObject: "",
      transport: { object: "TABU", name: "ZCFG" }
    })
    expect(result.recordObject).toBeUndefined()
  })
  it("selects the shortest rooted view with actual generated maintenance", async () => {
    const result = await resolveMaint(
      client([
        [
          /FROM DD25L WHERE ROOTTAB/,
          [{ VIEWNAME: "V_LONG_CONFIG" }, { VIEWNAME: "V_A" }, { VIEWNAME: "V_OK" }]
        ],
        [/FROM TVDIR WHERE TABNAME IN/, [{ TABNAME: "V_LONG_CONFIG" }, { TABNAME: "V_OK" }]],
        [/FROM DD25L WHERE VIEWNAME = 'V_OK'/, [{ ROOTTAB: "ZCFG" }]],
        [/FROM TVDIR WHERE TABNAME = 'V_OK'/, [{ AREA: "ZFG" }]]
      ]),
      "ZCFG"
    )
    expect(result).toMatchObject({
      view: "V_OK",
      maintObject: "V_OK",
      recordObject: "VDAT",
      rootTable: "ZCFG"
    })
  })
  it("ignores duplicate and unmaintained rooted candidates", async () => {
    const result = await resolveMaint(
      client([[/FROM DD25L WHERE ROOTTAB/, [{ VIEWNAME: "V_UNUSED" }, { VIEWNAME: "V_UNUSED" }]]]),
      "ZCFG"
    )
    expect(result.maintObject).toBe("")
    expect(result.view).toBeUndefined()
  })
  it("returns switch, IMG activity and authorization metadata", async () => {
    const result = await resolveMaint(
      client([
        [
          /FROM TVDIR/,
          [{ TABNAME: "ZCFG", BASTAB: "X", AREA: "ZFG", DEVCLASS: "ZPKG", TYPE: "2" }]
        ],
        [/FROM SFW_PACKAGE/, [{ SWITCH_ID: "ZSWITCH" }]],
        [/FROM CUS_ACTOBJ/, [{ ACT_ID: "ZACT", OBJECTTYPE: "S", TCODE: "ZCONFIG" }]],
        [/FROM CUS_IMGACT/, [{ TEXT: "Configuration title" }]],
        [/FROM TDDAT/, [{ CCLASS: "ZCFG" }]]
      ]),
      "ZCFG"
    )
    expect(result).toMatchObject({
      switchId: "ZSWITCH",
      imgActivity: "ZACT",
      imgActivityText: "Configuration title",
      maintTcode: "ZCONFIG",
      authGroup: "ZCFG",
      maintType: "2"
    })
  })
  it("does not label a non-language secondary table as text", async () => {
    const result = await resolveMaint(
      client([
        [/FROM DD25L WHERE VIEWNAME = 'V_ZCFG'/, [{ ROOTTAB: "ZCFG" }]],
        [/FROM DD26S/, [{ TABNAME: "ZCFG" }, { TABNAME: "ZOTHER" }]]
      ]),
      "V_ZCFG"
    )
    expect(result.tables).toEqual(["ZCFG", "ZOTHER"])
    expect(result.textTable).toBeUndefined()
  })
  it.each(["DD25L", "TVDIR", "TDDAT", "CUS_ACTOBJ"])(
    "propagates failure reading %s",
    async table => {
      const api = client([])
      vi.mocked(api.statelessClone.runQuery).mockImplementation(async sql => {
        if (sql.includes(`FROM ${table}`)) throw new Error(`${table} denied`)
        return { values: [], columns: [] }
      })
      await expect(resolveMaint(api, "ZCFG")).rejects.toThrow(`${table} denied`)
    }
  )
  it("propagates metadata errors instead of treating authorization failures as empty tables", async () => {
    const api = {
      statelessClone: { runQuery: vi.fn().mockRejectedValue(new Error("Not authorized")) }
    } as unknown as ADTClient
    await expect(resolveMaint(api, "ZCFG")).rejects.toThrow("Not authorized")
  })
})
