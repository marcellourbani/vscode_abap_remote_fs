jest.mock("abap-adt-api", () => ({
  debugMetaIsComplex: jest.fn((meta: string) =>
    ["structure", "table", "object", "class", "objectref"].includes(meta)
  )
}))
jest.mock("@vscode/debugadapter", () => ({
  Handles: jest.fn().mockImplementation((base: number) => {
    const store = new Map<number, any>()
    let counter = base || 1000
    return {
      create: jest.fn((val: any) => {
        const id = counter++
        store.set(id, val)
        return id
      }),
      get: jest.fn((id: number) => store.get(id)),
      reset: jest.fn(() => { store.clear(); counter = base || 1000 })
    }
  }),
  Scope: jest.fn().mockImplementation((name: string, ref: number, expensive: boolean) => ({
    name, variablesReference: ref, expensive
  }))
}))

import { ReplayVariableManager } from "./replayVariableManager"
import type { DebugSnapshot, CapturedVariable, CapturedScope } from "./types"

function makeVar(overrides: Partial<CapturedVariable> = {}): CapturedVariable {
  return {
    id: "VAR1",
    name: "MyVar",
    value: "hello",
    type: "C",
    metaType: "simple",
    ...overrides
  }
}

function makeSnapshot(scopes: CapturedScope[] = []): DebugSnapshot {
  return {
    stepNumber: 0,
    timestamp: Date.now(),
    threadId: 1,
    stack: [],
    scopes,
    changedVars: []
  }
}

describe("ReplayVariableManager", () => {
  let manager: ReplayVariableManager

  beforeEach(() => {
    jest.clearAllMocks()
    manager = new ReplayVariableManager()
  })

  describe("reset", () => {
    test("resets internal handles", () => {
      const snapshot = makeSnapshot([{ name: "LOCAL", variables: [makeVar()] }])
      manager.getScopes(snapshot) // populate handles
      manager.reset()
      // After reset, previously created references should be invalid
      const vars = manager.getVariables(1000) // first ref created
      expect(vars).toEqual([])
    })
  })

  describe("getScopes", () => {
    test("returns empty array for snapshot with no scopes", () => {
      const snap = makeSnapshot([])
      const scopes = manager.getScopes(snap)
      expect(scopes).toEqual([])
    })

    test("returns one scope per captured scope", () => {
      const snap = makeSnapshot([
        { name: "LOCAL", variables: [makeVar({ name: "X", value: "1" })] },
        { name: "SY", variables: [] }
      ])
      const scopes = manager.getScopes(snap)
      expect(scopes).toHaveLength(2)
      expect(scopes[0].name).toBe("LOCAL")
      expect(scopes[1].name).toBe("SY")
    })

    test("creates variable reference for each scope", () => {
      const snap = makeSnapshot([{ name: "LOCAL", variables: [makeVar()] }])
      const scopes = manager.getScopes(snap)
      expect(typeof scopes[0].variablesReference).toBe("number")
      expect(scopes[0].variablesReference).toBeGreaterThan(0)
    })
  })

  describe("getVariables", () => {
    test("returns empty array for unknown reference", () => {
      expect(manager.getVariables(9999)).toEqual([])
    })

    test("returns variables for known scope reference", () => {
      const vars = [
        makeVar({ id: "V1", name: "VAR_A", value: "42", metaType: "simple" }),
        makeVar({ id: "V2", name: "VAR_B", value: "hello", metaType: "simple" })
      ]
      const snap = makeSnapshot([{ name: "LOCAL", variables: vars }])
      const scopes = manager.getScopes(snap)
      const scopeRef = scopes[0].variablesReference
      const result = manager.getVariables(scopeRef)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe("VAR_A")
      expect(result[1].name).toBe("VAR_B")
    })

    test("sets variablesReference=0 for simple types", () => {
      const vars = [makeVar({ metaType: "simple" })]
      const snap = makeSnapshot([{ name: "LOCAL", variables: vars }])
      const scopes = manager.getScopes(snap)
      const result = manager.getVariables(scopes[0].variablesReference)
      expect(result[0].variablesReference).toBe(0)
    })

    test("creates nested reference for variables with children", () => {
      const child = makeVar({ id: "CHILD1", name: "COMP_A", value: "X" })
      const parent = makeVar({ id: "STRUCT1", name: "MY_STRUCT", metaType: "structure", children: [child] })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [parent] }])
      const scopes = manager.getScopes(snap)
      const result = manager.getVariables(scopes[0].variablesReference)
      expect(result[0].variablesReference).toBeGreaterThan(0)
    })

    test("returns 0 reference for skipped variables even with children", () => {
      const child = makeVar({ id: "R1", name: "R_1" })
      const skipped = makeVar({
        id: "TBL1", name: "MY_TABLE", metaType: "table",
        children: [child], skipped: true, skipReason: "too large"
      })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [skipped] }])
      const scopes = manager.getScopes(snap)
      const result = manager.getVariables(scopes[0].variablesReference)
      expect(result[0].variablesReference).toBe(0)
    })

    test("formats table value as 'type N lines'", () => {
      const tbl = makeVar({ id: "TBL1", name: "MY_TBL", metaType: "table", type: "ITAB", tableLines: 5 })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [tbl] }])
      const scopes = manager.getScopes(snap)
      const result = manager.getVariables(scopes[0].variablesReference)
      expect(result[0].value).toContain("5 lines")
    })

    test("formats skipped value with skipReason", () => {
      const v = makeVar({ skipped: true, skipReason: "size limit" })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [v] }])
      const scopes = manager.getScopes(snap)
      const result = manager.getVariables(scopes[0].variablesReference)
      expect(result[0].value).toContain("size limit")
    })
  })

  describe("evaluate", () => {
    test("returns undefined for unknown expression", () => {
      const snap = makeSnapshot([{ name: "LOCAL", variables: [makeVar({ name: "X" })] }])
      expect(manager.evaluate("UNKNOWN_VAR", snap)).toBeUndefined()
    })

    test("finds variable by name (case insensitive)", () => {
      const v = makeVar({ id: "V1", name: "MY_VAR", value: "42" })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [v] }])
      const result = manager.evaluate("my_var", snap)
      expect(result).toBeDefined()
      expect(result!.result).toBe("42")
    })

    test("finds variable by id", () => {
      const v = makeVar({ id: "SY-SUBRC", name: "SUBRC", value: "0" })
      const snap = makeSnapshot([{ name: "SY", variables: [v] }])
      const result = manager.evaluate("sy-subrc", snap)
      expect(result).toBeDefined()
    })

    test("finds nested variable in children", () => {
      const child = makeVar({ id: "STRUCT-COMP", name: "COMP", value: "nested" })
      const parent = makeVar({ id: "STRUCT1", name: "STRUCT", metaType: "structure", children: [child] })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [parent] }])
      const result = manager.evaluate("comp", snap)
      expect(result).toBeDefined()
      expect(result!.result).toBe("nested")
    })

    test("returns variablesReference > 0 for child with children", () => {
      const grandchild = makeVar({ id: "G", name: "GC", value: "deep" })
      const child = makeVar({
        id: "C1", name: "C_VAR", metaType: "structure",
        children: [grandchild]
      })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [child] }])
      const result = manager.evaluate("c_var", snap)
      expect(result).toBeDefined()
      expect(result!.variablesReference).toBeGreaterThan(0)
    })

    test("returns 0 variablesReference for skipped variable", () => {
      const v = makeVar({
        id: "TBL1", name: "MY_TBL", metaType: "table",
        children: [makeVar()], skipped: true
      })
      const snap = makeSnapshot([{ name: "LOCAL", variables: [v] }])
      const result = manager.evaluate("my_tbl", snap)
      expect(result!.variablesReference).toBe(0)
    })
  })
})
