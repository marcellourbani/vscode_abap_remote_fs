jest.mock("vscode", () => {
  class MockEventEmitter {
    private listeners: Function[] = []
    event = (listener: Function) => { this.listeners.push(listener); return { dispose: jest.fn() } }
    fire = (data: any) => { this.listeners.forEach(l => l(data)) }
  }
  return {
    EventEmitter: MockEventEmitter,
    TreeItem: class { constructor(label: any, collapsible?: any) { (this as any).label = label; (this as any).collapsibleState = collapsible } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeColor: class { constructor(public id: string) {} },
    ThemeIcon: class { constructor(public id: string, public color?: any) {} }
  }
}, { virtual: true })

import { S4HItemNode, S4HProvider, S4HRefNode, S4HRoot, S4HSummaryNode } from "./view"
import { CustomReference, GroupedData, ItemGroup } from "./types"

function makeRef(overrides: Partial<CustomReference> = {}): CustomReference {
  return {
    extractionSysid: "TST",
    extractionName: "NEU",
    referenceKind: "R",
    hash: "H1",
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
    devclass: "Z_PKG",
    genflag: "",
    dlvunit: "HOME",
    refApplComponent: "SD",
    ...overrides
  }
}

function makeGroupedData(overrides: Partial<GroupedData> = {}): GroupedData {
  return {
    groups: [{
      item: { id: "ITEM1", version: "R", title: "SD CHANGES", note: 2198647, replacementId: "" },
      refs: [makeRef()]
    }],
    ungrouped: [],
    totalRefs: 1,
    ...overrides
  }
}

describe("S4HProvider", () => {
  let provider: S4HProvider

  beforeEach(() => {
    provider = new S4HProvider()
  })

  it("returns empty children when no data loaded", async () => {
    const children = await provider.getChildren()
    expect(children).toHaveLength(0)
  })

  it("returns root node after setData", async () => {
    provider.setData("dev100", makeGroupedData())
    const children = await provider.getChildren()
    expect(children).toHaveLength(1)
    expect(children[0]).toBeInstanceOf(S4HRoot)
  })

  it("clear removes a connection", async () => {
    provider.setData("dev100", makeGroupedData())
    provider.clear("dev100")
    const children = await provider.getChildren()
    expect(children).toHaveLength(0)
  })

  it("supports multiple connections", async () => {
    provider.setData("dev100", makeGroupedData())
    provider.setData("qas200", makeGroupedData({ totalRefs: 5 }))
    const children = await provider.getChildren()
    expect(children).toHaveLength(2)
  })

  it("fires change event on setData", () => {
    const handler = jest.fn()
    provider.onDidChangeTreeData(handler)
    provider.setData("dev100", makeGroupedData())
    expect(handler).toHaveBeenCalled()
  })
})

describe("S4HRoot", () => {
  it("has summary + item groups as children", async () => {
    const provider = new S4HProvider()
    const data = makeGroupedData()
    provider.setData("test", data)
    const roots = await provider.getChildren()
    const root = roots[0] as S4HRoot
    const children = await provider.getChildren(root)

    expect(children[0]).toBeInstanceOf(S4HSummaryNode)
    expect(children[1]).toBeInstanceOf(S4HItemNode)
  })

  it("includes ungrouped node when there are ungrouped refs", async () => {
    const provider = new S4HProvider()
    const data = makeGroupedData({
      ungrouped: [makeRef({ objName: "Z_ORPHAN" })],
      totalRefs: 2
    })
    provider.setData("test", data)
    const roots = await provider.getChildren()
    const root = roots[0] as S4HRoot
    const children = await provider.getChildren(root)

    // summary + 1 group + ungrouped
    expect(children).toHaveLength(3)
    const ungroupedNode = children[2] as S4HItemNode
    expect(ungroupedNode.contextValue).toBe("s4hUngrouped")
  })

  it("does not include ungrouped node when no ungrouped refs", async () => {
    const provider = new S4HProvider()
    provider.setData("test", makeGroupedData({ ungrouped: [] }))
    const roots = await provider.getChildren()
    const root = roots[0] as S4HRoot
    const children = await provider.getChildren(root)

    // summary + 1 group only
    expect(children).toHaveLength(2)
  })
})

describe("S4HItemNode", () => {
  it("deduplicates refs by objType:objName:refObjName", () => {
    const group: ItemGroup = {
      item: { id: "I1", version: "R", title: "TEST", note: 1, replacementId: "" },
      refs: [
        makeRef({ objName: "ZCL_A", refObjName: "T1", hash: "H1" }),
        makeRef({ objName: "ZCL_A", refObjName: "T1", hash: "H2" }), // duplicate
        makeRef({ objName: "ZCL_A", refObjName: "T2", hash: "H3" })  // different refObjName
      ]
    }

    const root = new S4HRoot("test", { groups: [group], ungrouped: [], totalRefs: 3 })
    const itemNode = root.children[1] as S4HItemNode // [0] is summary

    expect(itemNode.children).toHaveLength(2) // deduped
  })

  it("shows note number in description", () => {
    const group: ItemGroup = {
      item: { id: "I1", version: "R", title: "TEST ITEM", note: 2198647, replacementId: "" },
      refs: [makeRef()]
    }
    const root = new S4HRoot("test", { groups: [group], ungrouped: [], totalRefs: 1 })
    const itemNode = root.children[1] as S4HItemNode

    expect(itemNode.description).toContain("2198647")
  })
})

describe("S4HRefNode", () => {
  it("shows object name as label and reference info as description", () => {
    const group: ItemGroup = {
      item: { id: "I1", version: "R", title: "T", note: 1, replacementId: "" },
      refs: [makeRef({ objName: "ZCL_MY_CLASS", objType: "CLAS", refObjName: "KONV", refObjType: "TABL" })]
    }
    const root = new S4HRoot("dev100", { groups: [group], ungrouped: [], totalRefs: 1 })
    const itemNode = root.children[1] as S4HItemNode
    const refNode = itemNode.children[0]

    expect(refNode.label).toBe("ZCL_MY_CLASS")
    expect(refNode.description).toBe("CLAS → KONV (TABL)")
    expect(refNode.connectionId).toBe("dev100")
  })

  it("includes package and component in tooltip", () => {
    const group: ItemGroup = {
      item: { id: "I1", version: "R", title: "T", note: 1, replacementId: "" },
      refs: [makeRef({ devclass: "Z_SD_PKG", refApplComponent: "SD-BIL" })]
    }
    const root = new S4HRoot("sys", { groups: [group], ungrouped: [], totalRefs: 1 })
    const itemNode = root.children[1] as S4HItemNode
    const refNode = itemNode.children[0]

    expect(refNode.tooltip).toContain("Z_SD_PKG")
    expect(refNode.tooltip).toContain("SD-BIL")
  })
})

describe("S4HSummaryNode", () => {
  it("shows total count and item count", () => {
    const data = makeGroupedData({ totalRefs: 42, groups: [
      { item: { id: "1", version: "R", title: "A", note: 1, replacementId: "" }, refs: Array(20).fill(makeRef()) },
      { item: { id: "2", version: "R", title: "B", note: 2, replacementId: "" }, refs: Array(22).fill(makeRef()) }
    ]})
    const root = new S4HRoot("x", data)
    const summary = root.children[0] as S4HSummaryNode

    expect(summary.label).toContain("42 references")
    expect(summary.label).toContain("2 simplification items")
  })

  it("shows type breakdown in description", () => {
    const data: GroupedData = {
      groups: [{
        item: { id: "1", version: "R", title: "A", note: 1, replacementId: "" },
        refs: [
          makeRef({ refObjType: "TABL" }),
          makeRef({ refObjType: "TABL", hash: "2" }),
          makeRef({ refObjType: "INTF", hash: "3" })
        ]
      }],
      ungrouped: [],
      totalRefs: 3
    }
    const root = new S4HRoot("x", data)
    const summary = root.children[0] as S4HSummaryNode

    expect(summary.description).toContain("2 TABL")
    expect(summary.description).toContain("1 INTF")
  })
})
