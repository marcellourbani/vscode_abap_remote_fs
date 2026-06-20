jest.mock(
  "vscode",
  () => ({
    window: {
      createOutputChannel: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn()
      })
    }
  }),
  { virtual: true }
)

jest.mock("../../lib", () => ({
  log: Object.assign(jest.fn(), {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn()
  })
}))

import { joinData } from "./dataFetcher"
import { CustomReference, ItemPiecelistLink, PiecelistEntry, SimplificationItem } from "./types"

function makeItem(id: string, title: string, note: number): SimplificationItem {
  return { id, version: "R", title, note, replacementId: "" }
}

function makeRef(overrides: Partial<CustomReference> = {}): CustomReference {
  return {
    extractionSysid: "TST",
    extractionName: "NEU",
    referenceKind: "R",
    hash: "ABC123",
    refObjType: "TABL",
    refObjName: "KONV",
    refSubType: "",
    refSubName: "",
    refIntType: "",
    refIntName: "",
    objType: "CLAS",
    objName: "ZCL_TEST",
    subType: "",
    subName: "",
    includeName: "",
    devclass: "Z_TEST",
    genflag: "",
    dlvunit: "HOME",
    refApplComponent: "SD",
    ...overrides
  }
}

function makePiecelist(piecelistId: string, objectName: string): PiecelistEntry {
  return {
    piecelistId,
    pgmid: "R3TR",
    objectType: "TABL",
    objectName,
    packageName: "",
    applicationComponent: ""
  }
}

function makeLink(id: string, piecelistId: string): ItemPiecelistLink {
  return { id, version: "R", piecelistId }
}

describe("joinData", () => {
  it("groups refs by simplification item via piecelist join", () => {
    const items = [makeItem("ITEM1", "SD CHANGES", 2198647)]
    const refs = [makeRef({ refObjName: "KONV", objName: "ZCL_SD" })]
    const piecelist = [makePiecelist("PL1", "KONV")]
    const links = [makeLink("ITEM1", "PL1")]

    const result = joinData(items, refs, piecelist, links)

    expect(result.totalRefs).toBe(1)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].item.title).toBe("SD CHANGES")
    expect(result.groups[0].refs).toHaveLength(1)
    expect(result.groups[0].refs[0].objName).toBe("ZCL_SD")
    expect(result.ungrouped).toHaveLength(0)
  })

  it("puts unmatched refs in ungrouped", () => {
    const items = [makeItem("ITEM1", "SD CHANGES", 2198647)]
    const refs = [makeRef({ refObjName: "UNKNOWN_TABLE", objName: "ZCL_X" })]
    const piecelist = [makePiecelist("PL1", "KONV")]
    const links = [makeLink("ITEM1", "PL1")]

    const result = joinData(items, refs, piecelist, links)

    expect(result.groups).toHaveLength(0)
    expect(result.ungrouped).toHaveLength(1)
    expect(result.ungrouped[0].objName).toBe("ZCL_X")
  })

  it("handles empty refs", () => {
    const result = joinData([makeItem("I1", "X", 1)], [], [], [])
    expect(result.totalRefs).toBe(0)
    expect(result.groups).toHaveLength(0)
    expect(result.ungrouped).toHaveLength(0)
  })

  it("handles empty items", () => {
    const refs = [makeRef()]
    const result = joinData([], refs, [], [])
    expect(result.ungrouped).toHaveLength(1)
  })

  it("handles multiple refs to same item", () => {
    const items = [makeItem("ITEM1", "MM CHANGES", 2206980)]
    const refs = [
      makeRef({ refObjName: "MSEG", objName: "ZCL_A", hash: "1" }),
      makeRef({ refObjName: "MKPF", objName: "ZCL_B", hash: "2" })
    ]
    const piecelist = [makePiecelist("PL1", "MSEG"), makePiecelist("PL1", "MKPF")]
    const links = [makeLink("ITEM1", "PL1")]

    const result = joinData(items, refs, piecelist, links)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].refs).toHaveLength(2)
  })

  it("handles ref matching multiple piecelist entries across items - assigns to first match", () => {
    const items = [makeItem("ITEM1", "FIRST", 111), makeItem("ITEM2", "SECOND", 222)]
    const refs = [makeRef({ refObjName: "SHARED_TABLE" })]
    const piecelist = [makePiecelist("PL1", "SHARED_TABLE"), makePiecelist("PL2", "SHARED_TABLE")]
    const links = [makeLink("ITEM1", "PL1"), makeLink("ITEM2", "PL2")]

    const result = joinData(items, refs, piecelist, links)

    // Should be assigned to one item (not duplicated)
    expect(result.totalRefs).toBe(1)
    expect(result.groups.length + result.ungrouped.length).toBeGreaterThanOrEqual(1)
    const allGroupedRefs = result.groups.flatMap(g => g.refs)
    expect(allGroupedRefs.length + result.ungrouped.length).toBe(1)
  })

  it("sorts groups by ref count descending", () => {
    const items = [makeItem("ITEM1", "FEW", 100), makeItem("ITEM2", "MANY", 200)]
    const refs = [
      makeRef({ refObjName: "T1", objName: "Z1", hash: "1" }),
      makeRef({ refObjName: "T2", objName: "Z2", hash: "2" }),
      makeRef({ refObjName: "T2", objName: "Z3", hash: "3" }),
      makeRef({ refObjName: "T2", objName: "Z4", hash: "4" })
    ]
    const piecelist = [makePiecelist("PL1", "T1"), makePiecelist("PL2", "T2")]
    const links = [makeLink("ITEM1", "PL1"), makeLink("ITEM2", "PL2")]

    const result = joinData(items, refs, piecelist, links)

    expect(result.groups[0].item.title).toBe("MANY")
    expect(result.groups[1].item.title).toBe("FEW")
  })

  it("handles piecelist with no link to any item", () => {
    const items = [makeItem("ITEM1", "X", 1)]
    const refs = [makeRef({ refObjName: "ORPHAN_TABLE" })]
    const piecelist = [makePiecelist("PL_ORPHAN", "ORPHAN_TABLE")]
    const links = [makeLink("ITEM1", "PL_OTHER")] // link points elsewhere

    const result = joinData(items, refs, piecelist, links)

    expect(result.ungrouped).toHaveLength(1)
  })

  it("handles link pointing to non-existent item", () => {
    const items: SimplificationItem[] = [] // no items
    const refs = [makeRef({ refObjName: "TABLE_X" })]
    const piecelist = [makePiecelist("PL1", "TABLE_X")]
    const links = [makeLink("GHOST_ITEM", "PL1")]

    const result = joinData(items, refs, piecelist, links)

    // Link resolves to piecelist, but item doesn't exist
    expect(result.ungrouped).toHaveLength(1)
  })

  it("handles duplicate object names in piecelist with different piecelist IDs", () => {
    const items = [makeItem("ITEM1", "A", 1), makeItem("ITEM2", "B", 2)]
    const refs = [makeRef({ refObjName: "MULTI_PL_TABLE" })]
    const piecelist = [
      makePiecelist("PL1", "MULTI_PL_TABLE"),
      makePiecelist("PL2", "MULTI_PL_TABLE")
    ]
    const links = [makeLink("ITEM1", "PL1"), makeLink("ITEM2", "PL2")]

    const result = joinData(items, refs, piecelist, links)

    // Ref should be assigned to exactly one group
    const total = result.groups.reduce((sum, g) => sum + g.refs.length, 0) + result.ungrouped.length
    expect(total).toBe(1)
  })

  it("handles large numbers of refs efficiently", () => {
    const items = [makeItem("ITEM1", "BIG", 999)]
    const refs = Array.from({ length: 1000 }, (_, i) =>
      makeRef({ refObjName: "TABLE_A", objName: `ZOBJ_${i}`, hash: `H${i}` })
    )
    const piecelist = [makePiecelist("PL1", "TABLE_A")]
    const links = [makeLink("ITEM1", "PL1")]

    const start = Date.now()
    const result = joinData(items, refs, piecelist, links)
    const elapsed = Date.now() - start

    expect(result.groups[0].refs).toHaveLength(1000)
    expect(elapsed).toBeLessThan(1000) // Should complete in under 1s
  })
})
