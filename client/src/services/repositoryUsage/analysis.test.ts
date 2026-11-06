import { describe, expect, it } from "vitest"
import { analyse, objectKey, resolveEntries, usedInventoryKeys } from "./analysis"
import type { InventoryObject, Observation } from "./types"

const inventory = (type: string, name: string): InventoryObject => ({
  pgmid: "R3TR",
  objectType: type,
  objectName: name,
  packageName: "ZPACKAGE"
})
const objects = [
  inventory("TRAN", "ZSTART"),
  inventory("PROG", "ZREPORT"),
  inventory("FUGR", "ZGROUP")
]
const seed = (name: string): Observation => ({
  id: name,
  source: "transaction",
  keys: [objectKey("PROG", name)],
  seeds: [objectKey("PROG", name)],
  reason: "ST03N transaction profile",
  date: "2026-01-03"
})

describe("repository usage identity resolution", () => {
  it.each(["transaction", "rfc-transaction"] as const)(
    "marks an unmapped discovered transaction Used from %s without inventing a program",
    source => {
      const records = [inventory("TRAN", "ZSTART"), inventory("PROG", "ZOTHER")]
      const matched = resolveEntries(["ZSTART"], source, records, [], [])
      expect(matched[0].keys).toEqual([objectKey("TRAN", "ZSTART")])
      expect(matched[0].seeds).toEqual([objectKey("TRAN", "ZSTART")])
      expect(matched[0].ambiguous).toBeUndefined()
      expect(analyse(records, matched, []).map(row => row.status)).toEqual(["used", "unclear"])
    }
  )
  it.each(["PROG", "CLAS", "TABL"])(
    "leaves an unmapped transaction sharing a name with %s Unclear",
    type => {
      const records = [inventory("TRAN", "ZSAME"), inventory(type, "ZSAME")]
      for (const source of ["transaction", "rfc-transaction"] as const) {
        const matched = resolveEntries(["ZSAME"], source, records, [], [])
        expect(matched[0].keys).toEqual([])
        expect(matched[0].seeds).toEqual([])
        expect(matched[0].ambiguous).toEqual([objectKey("TRAN", "ZSAME"), objectKey(type, "ZSAME")])
        expect(analyse(records, matched, []).map(row => row.status)).toEqual(["unclear", "unclear"])
      }
    }
  )
  it("treats a transaction-profile name absent from TSTC as a discovered program", () => {
    const records = [inventory("PROG", "ZREPORT"), inventory("CLAS", "ZCLASS")]
    const matched = resolveEntries(["ZREPORT"], "transaction", records, [], [])
    expect(matched[0].keys).toEqual([objectKey("PROG", "ZREPORT")])
    expect(analyse(records, matched, []).map(row => row.status)).toEqual(["used", "unclear"])
    expect(
      resolveEntries(["ZCLASS", "UNKNOWN"], "transaction", records, [], []).every(
        row => !row.seeds.length
      )
    ).toBe(true)
  })
  it("maps transactions and programs bidirectionally", () => {
    const mappings = [{ transaction: "ZSTART", program: "ZREPORT" }]
    for (const name of ["ZSTART", "ZREPORT"]) {
      const result = resolveEntries([name], "transaction", objects, mappings, [])
      expect(result[0].keys.sort()).toEqual(
        [objectKey("TRAN", "ZSTART"), objectKey("PROG", "ZREPORT")].sort()
      )
    }
  })
  it("does not seed incompatible transaction/program interpretations", () => {
    const result = resolveEntries(
      ["ZENTRY"],
      "transaction",
      [inventory("PROG", "ZENTRY"), inventory("PROG", "ZOTHER"), inventory("TRAN", "ZENTRY")],
      [
        { transaction: "ZENTRY", program: "ZOTHER" },
        { transaction: "ZANOTHER", program: "ZENTRY" }
      ],
      []
    )
    expect(result[0].seeds).toEqual([])
    expect(result[0].keys).toEqual([])
    expect(result[0].ambiguous?.length).toBeGreaterThan(1)
  })
  it.each(["PROG", "CLAS", "TABL"])(
    "leaves a transaction and same-name %s Unclear even with a program mapping",
    type => {
      const records = [inventory("TRAN", "ZSAME"), inventory(type, "ZSAME")]
      for (const source of ["transaction", "rfc-transaction"] as const) {
        const result = resolveEntries(
          ["ZSAME"],
          source,
          records,
          [{ transaction: "ZSAME", program: "ZSAME" }],
          []
        )
        expect(result[0].keys).toEqual([])
        expect(result[0].seeds).toEqual([])
        expect(result[0].ambiguous).toEqual(
          records.map(record => objectKey(record.objectType, record.objectName))
        )
        expect(analyse(records, result, []).map(row => row.status)).toEqual(["unclear", "unclear"])
      }
    }
  )
  it("keeps genuinely untyped same-name matches ambiguous", () => {
    const result = resolveEntries(
      ["ZSAME"],
      "untyped",
      [inventory("CLAS", "ZSAME"), inventory("TABL", "ZSAME")],
      [],
      []
    )
    expect(result[0].keys).toEqual([])
    expect(result[0].ambiguous).toHaveLength(2)
  })
  it("maps an FM to its owner without seeding every member of that group", () => {
    const result = resolveEntries(
      ["Z_FUNCTION"],
      "rfc-server",
      objects,
      [],
      [{ name: "Z_FUNCTION", group: "ZGROUP" }]
    )
    expect(result[0].keys).toEqual([objectKey("FUNC", "Z_FUNCTION"), objectKey("FUGR", "ZGROUP")])
    expect(result[0].seeds).toEqual([objectKey("FUNC", "Z_FUNCTION")])
  })
  it("marks an observed FM and its owner Used while leaving a sibling Unclear", () => {
    const records: InventoryObject[] = [
      inventory("FUGR", "ZGROUP"),
      { ...inventory("FUNC", "Z_FIRST"), pgmid: "LIMU", functionGroup: "ZGROUP" },
      { ...inventory("FUNC", "Z_SECOND"), pgmid: "LIMU", functionGroup: "ZGROUP" }
    ]
    const observations = resolveEntries(
      ["Z_FIRST"],
      "rfc-server",
      records,
      [],
      [
        { name: "Z_FIRST", group: "ZGROUP" },
        { name: "Z_SECOND", group: "ZGROUP" }
      ]
    )
    const rows = analyse(records, observations, [])
    expect(rows.map(row => row.status)).toEqual(["used", "used", "unclear"])
    expect(observations[0].seeds).toEqual(["LIMU:FUNC:Z_FIRST"])
  })
  it("retains out-of-scope usage seeds and deduplicates entries", () => {
    const result = resolveEntries(
      [" outside ", "OUTSIDE"],
      "transaction",
      objects,
      [{ transaction: "OUTSIDE", program: "STANDARD" }],
      []
    )
    expect(result).toHaveLength(1)
    expect(result[0].seeds).toContain(objectKey("PROG", "STANDARD"))
  })
})

describe("repository usage fixed point", () => {
  const chain = ["A", "B", "C", "D"].map(name => inventory("PROG", name))
  const edges = ["C:D", "B:C", "A:B"].map(pair => {
    const [caller, dependency] = pair.split(":")
    return {
      caller: objectKey("PROG", caller),
      dependency: objectKey("PROG", dependency),
      source: "where-used"
    }
  })
  it("propagates through reverse-ordered cached edges", () => {
    expect(analyse(chain, [seed("A")], edges).every(row => row.status === "used")).toBe(true)
  })
  it("uses only the frozen previous-pass callers when reassessing cached WUL edges", () => {
    const first = usedInventoryKeys(chain, [seed("A")], edges, [objectKey("PROG", "A")])
    expect(first).toEqual([objectKey("PROG", "A"), objectKey("PROG", "B")])
    const second = usedInventoryKeys(chain, [seed("A")], edges, first)
    expect(second).toEqual([objectKey("PROG", "A"), objectKey("PROG", "B"), objectKey("PROG", "C")])
    expect(usedInventoryKeys(chain, [seed("A")], edges, second)).toHaveLength(4)
  })
  it("does not promote callers from used dependencies or seed isolated cycles", () => {
    const rows = analyse(
      chain,
      [seed("D")],
      [
        ...edges,
        { caller: objectKey("PROG", "B"), dependency: objectKey("PROG", "A"), source: "relations" }
      ]
    )
    expect(rows.filter(row => row.status === "used").map(row => row.objectName)).toEqual(["D"])
  })
  it("appends all independent reasons, keeps the latest date and never invents dependency dates", () => {
    const rows = analyse(
      chain,
      [
        seed("A"),
        {
          ...seed("A"),
          id: "job",
          source: "jobs",
          date: "2026-02-01",
          reason: "Failed background job"
        }
      ],
      edges
    )
    expect(rows[0].reasons).toHaveLength(2)
    expect(rows[0].lastObserved).toBe("2026-02-01")
    expect(rows[1].lastObserved).toBeUndefined()
  })
  it("is idempotent and recomputes when evidence is removed", () => {
    expect(analyse(chain, [seed("A"), seed("A")], edges)[0].reasons).toHaveLength(1)
    expect(analyse(chain, [], edges).every(row => row.status === "unclear")).toBe(true)
  })
  it("does not downgrade a used object because another source is ambiguous", () => {
    const ambiguous = {
      ...seed("B"),
      id: "ambiguous",
      keys: [],
      seeds: [],
      ambiguous: [objectKey("PROG", "A"), objectKey("PROG", "B")]
    }
    const rows = analyse(chain, [seed("A"), ambiguous], [])
    expect(rows[0].status).toBe("used")
    expect(rows[1].status).toBe("unclear")
    expect(rows[1].reasons.join(" ")).toContain("Ambiguous")
  })
})
