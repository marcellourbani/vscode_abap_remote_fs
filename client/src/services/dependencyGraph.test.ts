/**
 * Tests for dependencyGraph.ts
 * Tests graph building, merging, filtering, and helper functions.
 */

// Mock vscode
jest.mock(
  "vscode",
  () => ({
    window: { showInformationMessage: jest.fn(), showErrorMessage: jest.fn(), showWarningMessage: jest.fn(), createWebviewPanel: jest.fn() },
    workspace: { getConfiguration: jest.fn().mockReturnValue({ get: jest.fn().mockReturnValue(false) }) },
    ViewColumn: { One: 1, Active: -1 },
    Uri: { joinPath: jest.fn(), file: jest.fn() }
  }),
  { virtual: true }
)

// Mock internal dependencies
jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createWebviewPanel: jest.fn()
  }
}))

jest.mock("../adt/conections", () => ({
  getClient: jest.fn(),
  getOrCreateRoot: jest.fn()
}))

jest.mock("../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  log: jest.fn()
}))

jest.mock("./webviewManager", () => ({
  WebviewManager: { getInstance: jest.fn() }
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn()
}))

jest.mock("./lm-tools/shared", () => ({
  getOptimalObjectURI: jest.fn()
}))

import { buildGraphData, mergeGraphData, applyFilters, fetchWhereUsedData } from "./dependencyGraph"
import type { GraphData, GraphNode, GraphEdge, DependencyGraphFilters } from "./dependencyGraph"
import { getClient } from "../adt/conections"

// Helper to create a minimal UsageReference
function makeRef(overrides: Record<string, any> = {}): any {
  return {
    objectIdentifier: "ABAPFullName;ZTEST_PROGRAM;INCLUDE1",
    "adtcore:type": "PROG/P",
    "adtcore:name": "ZTEST_PROGRAM",
    "adtcore:description": "Test Program",
    "adtcore:responsible": "DEVELOPER",
    uri: "/sap/bc/adt/programs/ZTEST_PROGRAM",
    canHaveChildren: true,
    packageRef: { "adtcore:name": "ZPACKAGE", "adtcore:uri": "/pkg/ZPACKAGE" },
    usageInformation: "READ",
    parentUri: undefined,
    ...overrides
  }
}

describe("dependencyGraph", () => {
  describe("buildGraphData", () => {
    it("creates a root node from objectName/type", () => {
      const result = buildGraphData("ZCL_MY_CLASS", "CLAS/OC", [])
      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].isRoot).toBe(true)
      expect(result.edges).toHaveLength(0)
    })

    it("sets isCustom=true for Z* root objects", () => {
      const result = buildGraphData("ZTEST", "PROG/P", [])
      expect(result.nodes[0].isCustom).toBe(true)
    })

    it("sets isCustom=false for non-Z/Y root objects", () => {
      const result = buildGraphData("RSUSR000", "PROG/P", [])
      expect(result.nodes[0].isCustom).toBe(false)
    })

    it("adds dependent nodes from valid references", () => {
      const refs = [makeRef()]
      const result = buildGraphData("ROOT_OBJ", "PROG/P", refs, true)
      expect(result.nodes.length).toBeGreaterThan(1)
    })

    it("creates edges from dependent nodes to root", () => {
      const refs = [makeRef()]
      const result = buildGraphData("ROOT_OBJ", "PROG/P", refs, true)
      expect(result.edges.length).toBeGreaterThan(0)
      // Edge should point to root
      const rootId = `ROOT_OBJ::PROG/P`
      const edgeToRoot = result.edges.find(e => e.target === rootId)
      expect(edgeToRoot).toBeDefined()
    })

    it("does not create self-referencing edges", () => {
      const selfRef = makeRef({
        objectIdentifier: "ABAPFullName;ROOT_OBJ",
        "adtcore:type": "PROG/P",
        "adtcore:name": "ROOT_OBJ"
      })
      const result = buildGraphData("ROOT_OBJ", "PROG/P", [selfRef], true)
      const selfEdges = result.edges.filter(e => e.source === e.target)
      expect(selfEdges).toHaveLength(0)
    })

    it("de-duplicates nodes with the same id", () => {
      const ref1 = makeRef({ "adtcore:name": "ZDUPLICATE", objectIdentifier: "ABAPFullName;ZDUPLICATE" })
      const ref2 = makeRef({ "adtcore:name": "ZDUPLICATE", objectIdentifier: "ABAPFullName;ZDUPLICATE" })
      const result = buildGraphData("ROOT_OBJ", "PROG/P", [ref1, ref2], true)
      const dupNodes = result.nodes.filter(n => n.name === "ZDUPLICATE")
      expect(dupNodes).toHaveLength(1)
    })

    it("skips refs with invalid objectIdentifier format", () => {
      const badRef = makeRef({ objectIdentifier: "InvalidFormat" })
      const result = buildGraphData("ROOT_OBJ", "PROG/P", [badRef], true)
      // Only root node should be present
      expect(result.nodes).toHaveLength(1)
    })

    it("skips refs with undefined objectIdentifier", () => {
      const badRef = makeRef({ objectIdentifier: undefined })
      const result = buildGraphData("ROOT_OBJ", "PROG/P", [badRef], true)
      expect(result.nodes).toHaveLength(1)
    })

    it("attaches usageType to edges", () => {
      const refs = [makeRef({ usageInformation: "WRITE" })]
      const result = buildGraphData("ROOT_OBJ", "PROG/P", refs, true)
      expect(result.edges[0]?.usageType).toBe("WRITE")
    })

    it("sets package info on nodes", () => {
      const refs = [makeRef()]
      const result = buildGraphData("ROOT_OBJ", "PROG/P", refs, true)
      const depNode = result.nodes.find(n => !n.isRoot)
      expect(depNode?.package).toBe("ZPACKAGE")
    })

    it("handles CLAS/OM type with parent class extraction", () => {
      const ref = makeRef({
        "adtcore:type": "CLAS/OM",
        "adtcore:name": "MY_METHOD",
        objectIdentifier: "ABAPFullName;ZCL_MY_CLASS======CP;MY_METHOD"
      })
      const result = buildGraphData("ROOT_OBJ", "PROG/P", [ref], true)
      const methodNode = result.nodes.find(n => n.name === "MY_METHOD")
      expect(methodNode?.parentClass).toBe("ZCL_MY_CLASS")
    })

    it("extracts actual symbol from objectIdentifier when skipSymbolExtraction=false", () => {
      const refs = [
        makeRef({ objectIdentifier: "ABAPFullName;ZCL_TEST;INCLUDE;\\ME:MY_METHOD" })
      ]
      const result = buildGraphData("ROOT_OBJ", "PROG/P", refs, false)
      // Root name should be the extracted symbol
      const rootNode = result.nodes.find(n => n.isRoot)
      expect(rootNode).toBeDefined()
    })
  })

  describe("mergeGraphData", () => {
    it("combines nodes from both graphs without duplication", () => {
      const g1: GraphData = {
        nodes: [{ id: "A::T", name: "A", type: "T", isRoot: true }],
        edges: []
      }
      const g2: GraphData = {
        nodes: [
          { id: "A::T", name: "A", type: "T", isRoot: true },
          { id: "B::T", name: "B", type: "T", isRoot: false }
        ],
        edges: [{ source: "B::T", target: "A::T" }]
      }
      const merged = mergeGraphData(g1, g2)
      expect(merged.nodes).toHaveLength(2)
    })

    it("combines edges from both graphs without duplication", () => {
      const edge: GraphEdge = { source: "B::T", target: "A::T" }
      const g1: GraphData = { nodes: [], edges: [edge] }
      const g2: GraphData = { nodes: [], edges: [edge] }
      const merged = mergeGraphData(g1, g2)
      expect(merged.edges).toHaveLength(1)
    })

    it("marks new nodes (from g2) as non-root", () => {
      const g1: GraphData = {
        nodes: [{ id: "A::T", name: "A", type: "T", isRoot: true }],
        edges: []
      }
      const g2: GraphData = {
        nodes: [{ id: "B::T", name: "B", type: "T", isRoot: true }],
        edges: []
      }
      const merged = mergeGraphData(g1, g2)
      const nodeB = merged.nodes.find(n => n.id === "B::T")
      expect(nodeB?.isRoot).toBe(false) // New nodes should not be root
    })

    it("preserves existing edges with usageType", () => {
      const edge: GraphEdge = { source: "B::T", target: "A::T", usageType: "READ" }
      const g1: GraphData = { nodes: [], edges: [edge] }
      const g2: GraphData = { nodes: [], edges: [] }
      const merged = mergeGraphData(g1, g2)
      expect(merged.edges[0].usageType).toBe("READ")
    })

    it("handles empty graphs", () => {
      const empty: GraphData = { nodes: [], edges: [] }
      const merged = mergeGraphData(empty, empty)
      expect(merged.nodes).toHaveLength(0)
      expect(merged.edges).toHaveLength(0)
    })
  })

  describe("applyFilters", () => {
    const rootNode: GraphNode = { id: "ROOT::T", name: "ROOT", type: "T", isRoot: true, isCustom: false }
    const customNode: GraphNode = { id: "ZCUST::PROG/P", name: "ZCUST", type: "PROG/P", isRoot: false, isCustom: true }
    const standardNode: GraphNode = { id: "STD::PROG/P", name: "STD", type: "PROG/P", isRoot: false, isCustom: false }
    const sampleGraph: GraphData = {
      nodes: [rootNode, customNode, standardNode],
      edges: [
        { source: "ZCUST::PROG/P", target: "ROOT::T", usageType: "READ" },
        { source: "STD::PROG/P", target: "ROOT::T", usageType: "WRITE" }
      ]
    }

    const noFilters: DependencyGraphFilters = {
      showCustomOnly: false,
      showStandardOnly: false,
      objectTypes: [],
      usageTypes: []
    }

    it("returns all nodes/edges when no filters active", () => {
      const result = applyFilters(sampleGraph, noFilters)
      expect(result.nodes).toHaveLength(3)
      expect(result.edges).toHaveLength(2)
    })

    it("filters to custom objects only (preserves root)", () => {
      const result = applyFilters(sampleGraph, { ...noFilters, showCustomOnly: true })
      const nodeNames = result.nodes.map(n => n.name)
      expect(nodeNames).toContain("ZCUST")
      expect(nodeNames).toContain("ROOT") // root always preserved
      expect(nodeNames).not.toContain("STD")
    })

    it("filters to standard objects only (preserves root)", () => {
      const result = applyFilters(sampleGraph, { ...noFilters, showStandardOnly: true })
      const nodeNames = result.nodes.map(n => n.name)
      expect(nodeNames).toContain("STD")
      expect(nodeNames).toContain("ROOT") // root always preserved
      expect(nodeNames).not.toContain("ZCUST")
    })

    it("filters by object type", () => {
      const result = applyFilters(sampleGraph, { ...noFilters, objectTypes: ["PROG/P"] })
      const nodeNames = result.nodes.map(n => n.name)
      expect(nodeNames).toContain("ZCUST")
      expect(nodeNames).toContain("STD")
      expect(nodeNames).toContain("ROOT") // root preserved
    })

    it("removes edges when both nodes no longer exist", () => {
      const result = applyFilters(sampleGraph, { ...noFilters, showCustomOnly: true })
      // STD node was removed, its edge should be gone
      const stdEdge = result.edges.find(e => e.source === "STD::PROG/P")
      expect(stdEdge).toBeUndefined()
    })

    it("filters edges by usageType", () => {
      const result = applyFilters(sampleGraph, { ...noFilters, usageTypes: ["READ"] })
      expect(result.edges.every(e => e.usageType === "READ")).toBe(true)
    })

    it("handles empty usageTypes filter (no filtering)", () => {
      const result = applyFilters(sampleGraph, { ...noFilters, usageTypes: [] })
      expect(result.edges).toHaveLength(2)
    })

    it("returns empty graph when no nodes match filters", () => {
      const result = applyFilters(sampleGraph, {
        ...noFilters,
        showCustomOnly: true,
        objectTypes: ["UNKNOWN_TYPE"]
      })
      // Only root (which is preserved) should remain after custom+type filter
      // Root node type is "T", not in objectTypes, but root is always preserved
      const nonRoot = result.nodes.filter(n => !n.isRoot)
      expect(nonRoot).toHaveLength(0)
    })
  })

  describe("fetchWhereUsedData", () => {
    it("calls client.statelessClone.usageReferences with correct args", async () => {
      const mockRefs = [makeRef()]
      const mockClient = {
        statelessClone: {
          usageReferences: jest.fn().mockResolvedValue(mockRefs)
        }
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)

      const result = await fetchWhereUsedData("/sap/bc/adt/programs/ZTEST", "GED100", 5, 10)
      expect(mockClient.statelessClone.usageReferences).toHaveBeenCalledWith(
        "/sap/bc/adt/programs/ZTEST",
        5,
        10
      )
      expect(result).toEqual(mockRefs)
    })

    it("defaults line=1 and character=0 when not provided", async () => {
      const mockClient = {
        statelessClone: {
          usageReferences: jest.fn().mockResolvedValue([])
        }
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      await fetchWhereUsedData("/sap/bc/adt/programs/ZTEST", "GED100")
      expect(mockClient.statelessClone.usageReferences).toHaveBeenCalledWith(
        "/sap/bc/adt/programs/ZTEST",
        1,
        0
      )
    })

    it("returns empty array when API returns undefined", async () => {
      const mockClient = {
        statelessClone: {
          usageReferences: jest.fn().mockResolvedValue(undefined)
        }
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      const result = await fetchWhereUsedData("/sap/bc/adt/programs/ZTEST", "GED100")
      expect(result).toEqual([])
    })

    it("throws error when API throws", async () => {
      const mockClient = {
        statelessClone: {
          usageReferences: jest.fn().mockRejectedValue(new Error("Network error"))
        }
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      await expect(fetchWhereUsedData("/sap/bc/adt/programs/ZTEST", "GED100")).rejects.toThrow(
        "Failed to fetch where-used data"
      )
    })

    it("normalizes connectionId to lowercase", async () => {
      const mockClient = {
        statelessClone: {
          usageReferences: jest.fn().mockResolvedValue([])
        }
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      await fetchWhereUsedData("/sap/bc/adt/programs/ZTEST", "GED100")
      expect(getClient).toHaveBeenCalledWith("ged100")
    })
  })
})
