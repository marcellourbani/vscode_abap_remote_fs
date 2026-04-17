jest.mock("vscode", () => ({}), { virtual: true })
jest.mock("../../../lib", () => ({
  log: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e))
}))

import { captureScopesBatched } from "./variableCapture"
import { CaptureOptions } from "./types"

function makeVar(id: string, name: string, value: string, metaType = "simple", tableLines?: number) {
  return {
    ID: id,
    NAME: name,
    VALUE: value,
    TECHNICAL_TYPE: "C",
    META_TYPE: metaType,
    TABLE_LINES: tableLines
  }
}

function makeHierarchy(parentId: string, childId: string, childName?: string) {
  return {
    PARENT_ID: parentId,
    CHILD_ID: childId,
    CHILD_NAME: childName || childId
  }
}

describe("captureScopesBatched", () => {
  const defaultOpts: CaptureOptions = { tableRowThreshold: 10000, maxSteps: 5000, maxDepth: 4 }

  it("returns scopes from hierarchies with simple variables", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        // Round 1: @ROOT → scope IDs
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("@ROOT", "LOCAL", "Local Variables"),
            makeHierarchy("@ROOT", "GLOBAL", "Global Variables")
          ],
          variables: []
        })
        // Round 2: all scope variables
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("LOCAL", "LV_NAME"),
            makeHierarchy("GLOBAL", "GV_COUNT"),
            makeHierarchy("SY", "SY-SUBRC")
          ],
          variables: [
            makeVar("LV_NAME", "LV_NAME", "Test"),
            makeVar("GV_COUNT", "GV_COUNT", "42"),
            makeVar("SY-SUBRC", "SY-SUBRC", "0")
          ]
        })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    expect(result).toHaveLength(3) // LOCAL, GLOBAL, SY
    const localScope = result.find(s => s.name === "Local Variables")
    expect(localScope).toBeDefined()
    expect(localScope!.variables).toHaveLength(1)
    expect(localScope!.variables[0].name).toBe("LV_NAME")
    expect(localScope!.variables[0].value).toBe("Test")

    const globalScope = result.find(s => s.name === "Global Variables")
    expect(globalScope!.variables[0].value).toBe("42")

    const syScope = result.find(s => s.name === "SY")
    expect(syScope).toBeDefined()
    expect(syScope!.variables[0].name).toBe("SY-SUBRC")
  })

  it("adds SY scope if missing from root hierarchies", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("LOCAL", "LV_X"),
            makeHierarchy("SY", "SY-SUBRC")
          ],
          variables: [
            makeVar("LV_X", "LV_X", "A"),
            makeVar("SY-SUBRC", "SY-SUBRC", "0")
          ]
        })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    const scopeNames = result.map(s => s.name)
    expect(scopeNames).toContain("SY")
    expect(scopeNames).toContain("Local")
  })

  it("does not duplicate SY scope if already present", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("@ROOT", "LOCAL", "Local"),
            makeHierarchy("@ROOT", "SY", "SY")
          ],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("LOCAL", "LV_X"),
            makeHierarchy("SY", "SY-SUBRC")
          ],
          variables: [
            makeVar("LV_X", "LV_X", "A"),
            makeVar("SY-SUBRC", "SY-SUBRC", "0")
          ]
        })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    const syScopes = result.filter(s => s.name === "SY")
    expect(syScopes).toHaveLength(1)
  })

  it("expands structures to maxDepth", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        // Round 1: root
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        // Round 2: scope vars — one structure
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("LOCAL", "LS_DATA"),
            makeHierarchy("SY", "SY-SUBRC")
          ],
          variables: [
            makeVar("LS_DATA", "LS_DATA", "", "structure"),
            makeVar("SY-SUBRC", "SY-SUBRC", "0")
          ]
        })
        // Round 3: depth=1 expand LS_DATA
        .mockResolvedValueOnce({
          hierarchies: [
            makeHierarchy("LS_DATA", "LS_DATA-FIELD1"),
            makeHierarchy("LS_DATA", "LS_DATA-NESTED")
          ],
          variables: [
            makeVar("LS_DATA-FIELD1", "FIELD1", "val1"),
            makeVar("LS_DATA-NESTED", "NESTED", "", "structure")
          ]
        })
        // Round 4: depth=2 expand LS_DATA-NESTED
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LS_DATA-NESTED", "LS_DATA-NESTED-DEEP")],
          variables: [makeVar("LS_DATA-NESTED-DEEP", "DEEP", "deepval")]
        })
    } as any

    const result = await captureScopesBatched(client, { ...defaultOpts, maxDepth: 4 })

    const local = result.find(s => s.name === "Local")!
    const lsData = local.variables.find(v => v.name === "LS_DATA")!
    expect(lsData.children).toBeDefined()
    expect(lsData.children).toHaveLength(2)
    const nested = lsData.children!.find(c => c.name === "NESTED")!
    expect(nested.children).toHaveLength(1)
    expect(nested.children![0].name).toBe("DEEP")
    expect(nested.children![0].value).toBe("deepval")
  })

  it("stops expanding at maxDepth", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LS_A")],
          variables: [makeVar("LS_A", "LS_A", "", "structure")]
        })
        // depth=1: expand LS_A → child is also structure
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LS_A", "LS_A-B")],
          variables: [makeVar("LS_A-B", "B", "", "structure")]
        })
        // maxDepth=2 → no more expansion
    } as any

    const result = await captureScopesBatched(client, { ...defaultOpts, maxDepth: 2 })

    const lsA = result.find(s => s.name === "Local")!.variables[0]
    expect(lsA.children).toHaveLength(1)
    expect(lsA.children![0].name).toBe("B")
    // B should NOT have been expanded (only 2 rounds of BFS: depth 1 and depth would be 2 but maxDepth=2 stops)
    expect(lsA.children![0].children).toBeUndefined()
    // Only 3 calls: root, scopes, depth=1
    expect(client.debuggerChildVariables).toHaveBeenCalledTimes(3)
  })

  it("limits table rows to RECORDING_MAX_TABLE_ROWS", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LT_BIG[]")],
          variables: [makeVar("LT_BIG[]", "LT_BIG", "", "table", 5000)]
        }),
      debuggerVariables: jest.fn().mockResolvedValue([])
    } as any

    await captureScopesBatched(client, defaultOpts)

    // Should request at most 2000 rows (RECORDING_MAX_TABLE_ROWS)
    const allKeys = client.debuggerVariables.mock.calls.flat().flat()
    expect(allKeys.length).toBeLessThanOrEqual(2000)
    // Should request row 1 through 2000, not 5000
    if (allKeys.length > 0) {
      expect(allKeys).toContain("LT_BIG[1]")
      expect(allKeys).not.toContain("LT_BIG[2001]")
    }
  })

  it("handles empty hierarchies", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({ hierarchies: [], variables: [] })
        .mockResolvedValueOnce({ hierarchies: [], variables: [] })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    // Should still have SY scope (added if missing)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("SY")
  })

  it("batches IDs correctly when exceeding MAX_IDS_PER_CALL (200)", async () => {
    // Create 250 scope IDs to force batching
    const scopeHierarchies = Array.from({ length: 250 }, (_, i) =>
      makeHierarchy("@ROOT", `SCOPE_${i}`, `Scope ${i}`)
    )
    const allScopeIds = scopeHierarchies.map(h => h.CHILD_ID)
    // +1 for SY = 251 total

    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({ hierarchies: scopeHierarchies, variables: [] })
        // Batched calls for scope vars (251 IDs > 200)
        .mockResolvedValueOnce({ hierarchies: [], variables: [] })
        .mockResolvedValueOnce({ hierarchies: [], variables: [] })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    // 1 call for root + 2 calls for batched scope vars (251 > 200)
    expect(client.debuggerChildVariables).toHaveBeenCalledTimes(3)
    // First batch should be 200 IDs
    const secondCall = client.debuggerChildVariables.mock.calls[1][0]
    expect(secondCall).toHaveLength(200)
    // Second batch should be remaining 51
    const thirdCall = client.debuggerChildVariables.mock.calls[2][0]
    expect(thirdCall).toHaveLength(51)
  })

  it("table rows are assigned to correct parent table", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LT_TAB[]")],
          variables: [makeVar("LT_TAB[]", "LT_TAB", "", "table", 2)]
        }),
      debuggerVariables: jest.fn().mockResolvedValue([
        makeVar("LT_TAB[1]", "LT_TAB[1]", "row1"),
        makeVar("LT_TAB[2]", "LT_TAB[2]", "row2")
      ])
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    const local = result.find(s => s.name === "Local")!
    const table = local.variables.find(v => v.name === "LT_TAB")!
    expect(table.children).toHaveLength(2)
    expect(table.children![0].value).toBe("row1")
    expect(table.children![1].value).toBe("row2")
  })

  it("adds skipReason when table is truncated", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LT_HUGE[]")],
          variables: [makeVar("LT_HUGE[]", "LT_HUGE", "", "table", 3000)]
        }),
      debuggerVariables: jest.fn().mockImplementation((ids: string[]) => {
        return Promise.resolve(ids.map((id: string) => makeVar(id, id, "data")))
      })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    const table = result.find(s => s.name === "Local")!.variables[0]
    expect(table.children!.length).toBe(2000) // capped at RECORDING_MAX_TABLE_ROWS
    expect(table.skipReason).toContain("Captured 2000 of 3000 rows")
  })

  it("handles table with 0 lines", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LT_EMPTY[]")],
          variables: [makeVar("LT_EMPTY[]", "LT_EMPTY", "", "table", 0)]
        })
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    const table = result.find(s => s.name === "Local")!.variables[0]
    expect(table.metaType).toBe("table")
    // No expansion should happen for 0-line tables
    expect(table.children).toBeUndefined()
  })

  it("uses DEFAULT_CAPTURE_OPTIONS when no options provided", async () => {
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({ hierarchies: [], variables: [] })
        .mockResolvedValueOnce({ hierarchies: [], variables: [] })
    } as any

    // Call without options - should not throw
    const result = await captureScopesBatched(client)
    expect(result).toBeDefined()
  })

  it("batchedVariables logs error and breaks on failure when batching", async () => {
    const { log } = require("../../../lib")
    // Need >200 rows to trigger batching path where try/catch exists
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LT_ERR[]")],
          variables: [makeVar("LT_ERR[]", "LT_ERR", "", "table", 250)]
        }),
      debuggerVariables: jest.fn().mockImplementation(() => Promise.reject(new Error("API failure")))
    } as any

    const result = await captureScopesBatched(client, defaultOpts)

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed batch variables"))
    // Table should still exist but with no children expanded
    const table = result.find(s => s.name === "Local")!.variables[0]
    expect(table.metaType).toBe("table")
  })

  it("batchedVariables propagates error when not batching (<=200 IDs)", async () => {
    // With <=200 IDs, debuggerVariables is called directly without try/catch
    const client = {
      debuggerChildVariables: jest.fn()
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("@ROOT", "LOCAL", "Local")],
          variables: []
        })
        .mockResolvedValueOnce({
          hierarchies: [makeHierarchy("LOCAL", "LT_ERR[]")],
          variables: [makeVar("LT_ERR[]", "LT_ERR", "", "table", 5)]
        }),
      debuggerVariables: jest.fn().mockImplementation(() => Promise.reject(new Error("API failure")))
    } as any

    // This reveals a bug: errors are only caught in the batching path (>200 IDs)
    await expect(captureScopesBatched(client, defaultOpts)).rejects.toThrow("API failure")
  })
})
