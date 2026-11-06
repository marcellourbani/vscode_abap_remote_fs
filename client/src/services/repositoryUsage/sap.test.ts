import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  network: vi.fn(),
  references: vi.fn(),
  source: vi.fn(),
  runQuery: vi.fn()
}))
vi.mock("../../adt/conections", () => ({
  getClient: () => ({
    runQuery: mocks.runQuery,
    getObjectSource: mocks.source,
    statelessClone: { usageReferences: mocks.references }
  })
}))
vi.mock("../abapSearchService", () => ({
  getSearchService: () => ({ searchObjects: mocks.search })
}))
vi.mock("../../adt/relationApi", () => ({
  AdtRelationApi: class {
    network = mocks.network
  }
}))
vi.mock("../lm-tools/shared", () => ({ getOptimalObjectURI: (_type: string, uri: string) => uri }))
import { UsageSap, relationKey } from "./sap"
import type { UsageAnalysis } from "./types"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.search.mockResolvedValue([{ name: "ZROOT", type: "PROG/P", uri: "/root" }])
  mocks.references.mockResolvedValue([])
  mocks.source.mockResolvedValue("REPORT ZROOT.")
  mocks.network.mockResolvedValue({ objects: [], relations: [] })
})
describe("repository usage SAP adapter", () => {
  it.each([false, true])(
    "creates metadata-only domain usage edges without package hierarchy nodes (source unavailable: %s)",
    async sourceUnavailable => {
      mocks.search.mockResolvedValue([
        { name: "ZDOMAIN", type: "DOMA/DD", uri: "/sap/bc/adt/ddic/domains/zdomain" }
      ])
      if (sourceUnavailable) mocks.source.mockRejectedValue(new Error("No source available"))
      mocks.references.mockResolvedValue([
        {
          objectIdentifier: "",
          isResult: "true",
          uri: "/sap/bc/adt/ddic/dataelements/z_element",
          "adtcore:name": "Z_ELEMENT",
          "adtcore:type": "DTEL/DE"
        },
        {
          objectIdentifier: "",
          isResult: "false",
          uri: "/packages/zpackage",
          "adtcore:name": "ZPACKAGE",
          "adtcore:type": "DEVC/K"
        }
      ])
      expect(
        await new UsageSap().dependencies(
          "example",
          "R3TR:DOMA:ZDOMAIN",
          "WUL",
          false,
          new AbortController().signal
        )
      ).toEqual({
        edges: [
          { caller: "R3TR:DTEL:Z_ELEMENT", dependency: "R3TR:DOMA:ZDOMAIN", source: "Where-used" }
        ],
        errors: []
      })
      expect(mocks.references).toHaveBeenCalledWith("/sap/bc/adt/ddic/domains/zdomain", 1, 0)
    }
  )
  it("preserves source-reference identity handling for class pools, functions and includes", async () => {
    mocks.references.mockResolvedValue([
      { objectIdentifier: "ABAPFullName;ZCL_EXAMPLE=====CP", "adtcore:type": "PROG/P" },
      {
        objectIdentifier: "ABAPFullName;SAPLZGROUP",
        "adtcore:type": "FUGR/FF",
        "adtcore:name": "Z_FUNCTION"
      },
      { objectIdentifier: "ABAPFullName;ZREPORT;ZINCLUDE", "adtcore:type": "PROG/I" }
    ])
    const result = await new UsageSap().dependencies(
      "example",
      "R3TR:PROG:ZROOT",
      "WUL",
      false,
      new AbortController().signal
    )
    expect(result.errors).toEqual([])
    expect(result.edges.map(edge => edge.caller)).toEqual([
      "R3TR:CLAS:ZCL_EXAMPLE",
      "LIMU:FUNC:Z_FUNCTION",
      "R3TR:PROG:ZINCLUDE"
    ])
  })
  it("resumes mapping from the last completed prefix without repeating its SQL", async () => {
    const state = {
      connectionId: "example",
      inventory: [],
      functions: [],
      transactions: [],
      completedTransactionPrefixes: []
    } as unknown as UsageAnalysis
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
      .mockResolvedValueOnce({ values: [{ TCODE: "ZSTART", PGMNA: "ZREPORT" }] })
      .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
      .mockResolvedValueOnce({ values: [{ TCODE: "YSTART", PGMNA: "YREPORT" }] })
    const controller = new AbortController()
    const sap = new UsageSap()
    const request = { transactionNames: ["ZSTART", "YSTART"], functionNames: [] }
    await expect(
      sap.mappings(state, controller.signal, {
        ...request,
        checkpoint: async snapshot => {
          Object.assign(state, snapshot)
          controller.abort()
        }
      })
    ).rejects.toThrow("Analysis paused")
    expect(mocks.runQuery).toHaveBeenCalledTimes(2)
    expect(state.completedTransactionPrefixes).toEqual(["Z"])
    const result = await sap.mappings(state, new AbortController().signal, {
      ...request,
      resume: true
    })
    expect(mocks.runQuery).toHaveBeenCalledTimes(4)
    expect(mocks.runQuery.mock.calls.slice(2).every(([sql]) => sql.includes("'Y%'"))).toBe(true)
    expect(result.transactions).toEqual([
      { transaction: "ZSTART", program: "ZREPORT" },
      { transaction: "YSTART", program: "YREPORT" }
    ])
  })
  it("combines package filters into one count and one data query when subpackages are off", async () => {
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPACKAGE" }, { DEVCLASS: "YPACKAGE" }] })
    expect(
      await new UsageSap().packages(
        "example",
        ["Z*", "Y*", "Z*"],
        false,
        new AbortController().signal
      )
    ).toEqual(["YPACKAGE", "ZPACKAGE"])
    expect(mocks.runQuery.mock.calls).toEqual([
      [
        "SELECT COUNT(*) AS total FROM tdevc WHERE devclass LIKE 'Z%' OR devclass LIKE 'Y%'",
        1,
        true
      ],
      ["SELECT devclass FROM tdevc WHERE devclass LIKE 'Z%' OR devclass LIKE 'Y%'", 1002, true]
    ])
  })
  it("fetches the complete package hierarchy once and finds subpackages locally", async () => {
    const values = Array.from({ length: 25000 }, (_, index) => ({
      DEVCLASS: `SAP_PACKAGE_${index}`,
      PARENTCL: ""
    }))
    values[0] = { DEVCLASS: "ZROOT", PARENTCL: "" }
    values[1] = { DEVCLASS: "YCHILD", PARENTCL: "ZROOT" }
    values[2] = { DEVCLASS: "/DEMO/GRANDCHILD", PARENTCL: "YCHILD" }
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: String(values.length) }] })
      .mockResolvedValueOnce({ values })
    expect(
      await new UsageSap().packages("example", ["ZROOT"], true, new AbortController().signal)
    ).toEqual(["/DEMO/GRANDCHILD", "YCHILD", "ZROOT"])
    expect(mocks.runQuery.mock.calls).toEqual([
      ["SELECT COUNT(*) AS total FROM tdevc", 1, true],
      ["SELECT devclass,parentcl FROM tdevc", 26000, true]
    ])
  })
  it("filters package discovery in SAP when subpackages are not requested", async () => {
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "Z_SALES_MAIN" }] })
    expect(
      await new UsageSap().packages("example", ["Z_SALES*"], false, new AbortController().signal)
    ).toEqual(["Z_SALES_MAIN"])
    expect(mocks.runQuery.mock.calls.every(call => call[0].includes("WHERE"))).toBe(true)
    expect(mocks.runQuery.mock.calls[1][0]).not.toContain("parentcl")
    expect(mocks.runQuery.mock.calls[1][0]).toContain("Z!_SALES%")
  })
  it("does not query ENLFDIR or unrelated inventory prefixes when only transaction mappings are requested", async () => {
    const state = {
      connectionId: "example",
      inventory: [
        { pgmid: "R3TR", objectType: "PROG", objectName: "STANDARD", packageName: "ZPACKAGE" }
      ],
      inputs: [],
      jobPrograms: [],
      functions: [],
      transactions: []
    } as unknown as UsageAnalysis
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
      .mockResolvedValueOnce({ values: [{ TCODE: "ZSTART", PGMNA: "ZREPORT" }] })
    const result = await new UsageSap().mappings(state, new AbortController().signal, {
      transactionNames: ["ZREPORT"],
      functionNames: []
    })
    expect(result.transactions).toEqual([{ transaction: "ZSTART", program: "ZREPORT" }])
    expect(mocks.runQuery.mock.calls.every(call => call[0].includes("tstc"))).toBe(true)
    expect(mocks.runQuery.mock.calls.every(call => !call[0].includes("'S%'"))).toBe(true)
  })
  it("reuses FM ownership from discovery without querying TSTC or ENLFDIR", async () => {
    const state = {
      connectionId: "example",
      inventory: [
        {
          pgmid: "LIMU",
          objectType: "FUNC",
          objectName: "Z_FIRST",
          packageName: "ZPACKAGE",
          functionGroup: "ZGROUP"
        }
      ],
      inputs: [],
      jobPrograms: [],
      functions: [],
      transactions: []
    } as unknown as UsageAnalysis
    const result = await new UsageSap().mappings(state, new AbortController().signal, {
      transactionNames: [],
      functionNames: ["Z_FIRST"]
    })
    expect(result.functions).toEqual([{ name: "Z_FIRST", group: "ZGROUP" }])
    expect(mocks.runQuery).not.toHaveBeenCalled()
  })
  it("does not keep removed transaction mappings when a queried prefix is refreshed", async () => {
    const state = {
      connectionId: "example",
      inventory: [],
      functions: [],
      transactions: [
        { transaction: "ZREMOVED", program: "ZOLD" },
        { transaction: "YKEEP", program: "YREPORT" }
      ]
    } as unknown as UsageAnalysis
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
      .mockResolvedValueOnce({ values: [] })
    const result = await new UsageSap().mappings(state, new AbortController().signal, {
      transactionNames: ["ZNEW"],
      functionNames: []
    })
    expect(result.transactions).toEqual([{ transaction: "YKEEP", program: "YREPORT" }])
  })
  it("does not query ownership for standard namespace or wildcard extract entries after discovery", async () => {
    const state = {
      connectionId: "example",
      inventory: [
        { pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }
      ],
      completedFunctionGroups: ["R3TR:FUGR:ZGROUP"],
      functions: [
        { name: "Z_FIRST", group: "ZGROUP" },
        { name: "/SSF/OUTSIDE", group: "/SSF/GROUP" }
      ],
      transactions: []
    } as unknown as UsageAnalysis
    const result = await new UsageSap().mappings(state, new AbortController().signal, {
      transactionNames: [],
      functionNames: ["Z_FIRST", "/SSF/OUTSIDE", "STANDARD_FM", "*", "%", ""]
    })
    expect(mocks.runQuery).not.toHaveBeenCalled()
    expect(result.functions).toEqual([{ name: "Z_FIRST", group: "ZGROUP" }])
  })
  it("does not query ENLFDIR when there are no discovered function groups", async () => {
    const state = {
      connectionId: "example",
      inventory: [],
      functions: [],
      transactions: []
    } as unknown as UsageAnalysis
    const result = await new UsageSap().mappings(state, new AbortController().signal, {
      transactionNames: [],
      functionNames: ["/SSF/OUTSIDE", "*", "STANDARD_FM"]
    })
    expect(mocks.runQuery).not.toHaveBeenCalled()
    expect(result.functions).toEqual([])
  })
  it("bounds missing upload ownership by discovered groups and caches the completed read", async () => {
    const state = {
      connectionId: "example",
      inventory: ["ZFIRST", "ZSECOND"].map(name => ({
        pgmid: "R3TR",
        objectType: "FUGR",
        objectName: name,
        packageName: "ZPACKAGE"
      })),
      functions: [],
      transactions: [],
      completedFunctionGroups: []
    } as unknown as UsageAnalysis
    mocks.runQuery.mockResolvedValueOnce({ values: [{ TOTAL: "3" }] }).mockResolvedValueOnce({
      values: [
        { FUNCNAME: "Z_FIRST", AREA: "ZFIRST" },
        { FUNCNAME: "OTHER_NAME", AREA: "ZSECOND" },
        { FUNCNAME: "Z_OUTSIDE", AREA: "ZUNRELATED" }
      ]
    })
    const sap = new UsageSap()
    const request = { transactionNames: [], functionNames: ["Z_FIRST", "/SSF/OUTSIDE", "*"] }
    const result = await sap.mappings(state, new AbortController().signal, request)
    expect(mocks.runQuery.mock.calls).toEqual([
      ["SELECT COUNT(*) AS total FROM enlfdir WHERE area LIKE 'Z%'", 1, true],
      ["SELECT area,funcname FROM enlfdir WHERE area LIKE 'Z%'", 1003, true]
    ])
    expect(result.functions).toEqual([
      { name: "Z_FIRST", group: "ZFIRST" },
      { name: "OTHER_NAME", group: "ZSECOND" }
    ])
    expect(result.completedFunctionMappings).toEqual(["R3TR:FUGR:ZFIRST", "R3TR:FUGR:ZSECOND"])
    Object.assign(state, result)
    expect(state.completedFunctionGroups).toEqual([])
    await sap.mappings(state, new AbortController().signal, request)
    expect(mocks.runQuery).toHaveBeenCalledTimes(2)
  })
  it.each(["search", "network", "source", "references"] as const)(
    "starts no follow-up SAP request after cancellation during %s",
    async stage => {
      const controller = new AbortController()
      let release!: (value: unknown) => void
      let entered!: () => void
      const started = new Promise<void>(resolve => {
        entered = resolve
      })
      const gate = new Promise(resolve => {
        release = resolve
      })
      mocks[stage].mockImplementationOnce(() => {
        entered()
        return gate
      })
      const operation = new UsageSap().dependencies(
        "example",
        "R3TR:PROG:ZROOT",
        "WUL",
        true,
        controller.signal
      )
      const rejected = expect(operation).rejects.toThrow("Analysis paused")
      await started
      const before = {
        search: mocks.search.mock.calls.length,
        network: mocks.network.mock.calls.length,
        source: mocks.source.mock.calls.length,
        references: mocks.references.mock.calls.length
      }
      controller.abort()
      release(
        stage === "search"
          ? [{ name: "ZROOT", type: "PROG/P", uri: "/root" }]
          : stage === "network"
            ? { objects: [], relations: [] }
            : stage === "source"
              ? "REPORT ZROOT."
              : []
      )
      await rejected
      expect({
        search: mocks.search.mock.calls.length,
        network: mocks.network.mock.calls.length,
        source: mocks.source.mock.calls.length,
        references: mocks.references.mock.calls.length
      }).toEqual(before)
    }
  )
  it("does not run the capability probe after a cancelled object search", async () => {
    const controller = new AbortController()
    let release!: (value: unknown) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    mocks.search.mockImplementationOnce(() => {
      entered()
      return new Promise(resolve => {
        release = resolve
      })
    })
    const operation = new UsageSap().probe("example", "R3TR:PROG:ZROOT", controller.signal)
    const rejected = expect(operation).rejects.toThrow("Analysis paused")
    await started
    controller.abort()
    release([{ name: "ZROOT", type: "PROG/P", uri: "/root" }])
    await rejected
    expect(mocks.network).not.toHaveBeenCalled()
  })
  it("does not treat a cancelled unsupported-probe response as an unavailable API", async () => {
    const controller = new AbortController()
    mocks.network.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error("404 Resource does not exist")
    })
    await expect(
      new UsageSap().probe("example", "R3TR:PROG:ZROOT", controller.signal)
    ).rejects.toThrow("Analysis paused")
  })
  it("gets every FM in a discovered function group and inherits its package", async () => {
    mocks.runQuery.mockResolvedValueOnce({ values: [{ TOTAL: "2" }] }).mockResolvedValueOnce({
      values: [
        { AREA: "ZGROUP", FUNCNAME: "Z_FIRST" },
        { AREA: "ZGROUP", FUNCNAME: "OTHER_FUNCTION" }
      ]
    })
    const rows = await new UsageSap().functionModules(
      "example",
      [{ pgmid: "R3TR", objectType: "FUGR", objectName: "ZGROUP", packageName: "ZPACKAGE" }],
      new AbortController().signal
    )
    expect(rows).toEqual([
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "Z_FIRST",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      },
      {
        pgmid: "LIMU",
        objectType: "FUNC",
        objectName: "OTHER_FUNCTION",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP"
      }
    ])
    expect(mocks.runQuery.mock.calls.every(call => call[0].includes("area LIKE 'Z%'"))).toBe(true)
    expect(mocks.runQuery.mock.calls[1][1]).toBe(1002)
  })
  it("accepts a function group with no function modules", async () => {
    mocks.runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
      .mockResolvedValueOnce({ values: [] })
    expect(
      await new UsageSap().functionModules(
        "example",
        [{ pgmid: "R3TR", objectType: "FUGR", objectName: "ZEMPTY", packageName: "ZPACKAGE" }],
        new AbortController().signal
      )
    ).toEqual([])
    expect(mocks.runQuery).toHaveBeenCalledTimes(2)
  })
  it("fetches a prefix once and keeps only exact discovered groups with their own packages", async () => {
    mocks.runQuery.mockResolvedValueOnce({ values: [{ TOTAL: "3" }] }).mockResolvedValueOnce({
      values: [
        { AREA: "ZFIRST", FUNCNAME: "STANDARD_NAME" },
        { AREA: "ZSECOND", FUNCNAME: "Z_SECOND" },
        { AREA: "ZOUTSIDE", FUNCNAME: "Z_OUTSIDE" }
      ]
    })
    const rows = await new UsageSap().functionModules(
      "example",
      [
        { pgmid: "R3TR", objectType: "FUGR", objectName: "ZFIRST", packageName: "ZPACKAGE" },
        { pgmid: "R3TR", objectType: "FUGR", objectName: "ZSECOND", packageName: "YPACKAGE" }
      ],
      new AbortController().signal
    )
    expect(rows.map(row => [row.objectName, row.functionGroup, row.packageName])).toEqual([
      ["STANDARD_NAME", "ZFIRST", "ZPACKAGE"],
      ["Z_SECOND", "ZSECOND", "YPACKAGE"]
    ])
    expect(mocks.runQuery.mock.calls).toEqual([
      ["SELECT COUNT(*) AS total FROM enlfdir WHERE area LIKE 'Z%'", 1, true],
      ["SELECT area,funcname FROM enlfdir WHERE area LIKE 'Z%'", 1003, true]
    ])
  })
  it("falls back only for an unsupported relations API", async () => {
    mocks.network.mockRejectedValueOnce(new Error("404 Resource does not exist"))
    expect(
      await new UsageSap().probe("example", "R3TR:PROG:ZROOT", new AbortController().signal)
    ).toBe(false)
    mocks.network.mockRejectedValueOnce(new Error("403 Not authorized"))
    await expect(
      new UsageSap().probe("example", "R3TR:PROG:ZROOT", new AbortController().signal)
    ).rejects.toThrow(/403/)
  })
  it("rejects ambiguous exact search results instead of picking the first", async () => {
    mocks.search.mockResolvedValue([
      { name: "ZROOT", type: "PROG/P", uri: "/one" },
      { name: "ZROOT", type: "PROG/P", uri: "/two" }
    ])
    await expect(
      new UsageSap().resolve("example", "R3TR:PROG:ZROOT", new AbortController().signal)
    ).rejects.toThrow(/uniquely/)
  })
  it("collects only incident relation edges in the selected direction", async () => {
    mocks.network.mockResolvedValue({
      objects: [
        { id: "/target", uri: "/target", name: "ZTARGET", type: "CLAS/OC" },
        { id: "/unrelated", uri: "/unrelated", name: "ZOTHER", type: "CLAS/OC" }
      ],
      relations: [{ from: "/root", to: "/target" }]
    })
    const result = await new UsageSap().dependencies(
      "example",
      "R3TR:PROG:ZROOT",
      "ENV",
      true,
      new AbortController().signal
    )
    expect(result).toEqual({
      edges: [
        {
          caller: "R3TR:PROG:ZROOT",
          dependency: "R3TR:CLAS:ZTARGET",
          source: "Object relations ENV"
        }
      ],
      errors: []
    })
  })
  it("keeps where-used edges when object relations fail", async () => {
    mocks.network.mockRejectedValueOnce(new Error("Relations unavailable for this object"))
    mocks.references.mockResolvedValueOnce([
      { objectIdentifier: "ABAPFullName;ZCALLER", "adtcore:type": "PROG/P" }
    ])
    const result = await new UsageSap().dependencies(
      "example",
      "R3TR:PROG:ZROOT",
      "WUL",
      true,
      new AbortController().signal
    )
    expect(result.edges).toContainEqual({
      caller: "R3TR:PROG:ZCALLER",
      dependency: "R3TR:PROG:ZROOT",
      source: "Where-used"
    })
    expect(result.errors).toEqual([
      "Relations failed for R3TR:PROG:ZROOT: Error: Relations unavailable for this object"
    ])
  })
  it("keeps relation edges when where-used fails", async () => {
    mocks.network.mockResolvedValueOnce({
      objects: [{ id: "/target", uri: "/target", name: "ZTARGET", type: "CLAS/OC" }],
      relations: [{ from: "/root", to: "/target" }]
    })
    mocks.references.mockRejectedValueOnce(new Error("Where-used unavailable"))
    const result = await new UsageSap().dependencies(
      "example",
      "R3TR:PROG:ZROOT",
      "WUL",
      true,
      new AbortController().signal
    )
    expect(result.edges).toContainEqual({
      caller: "R3TR:CLAS:ZTARGET",
      dependency: "R3TR:PROG:ZROOT",
      source: "Object relations WUL"
    })
    expect(result.errors[0]).toContain("Where-used failed for R3TR:PROG:ZROOT")
  })
  it("normalizes FM and method endpoints without losing their owner", () => {
    expect(
      relationKey({
        name: "METHOD",
        type: "CLAS/OM",
        parentUri: "/classes/zcl_owner",
        uri: "/methods/method"
      } as never)
    ).toBe("R3TR:CLAS:ZCL_OWNER")
    expect(
      relationKey({ name: "Description", type: "FUGR/FF", uri: "/functions/z_function" } as never)
    ).toBe("LIMU:FUNC:Z_FUNCTION")
  })
})
