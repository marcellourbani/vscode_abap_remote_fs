vi.mock("vscode", () => ({
  EventEmitter: vi.fn().mockImplementation(function () {
    return {
      event: vi.fn(),
      fire: vi.fn()
    }
  }),
  ProgressLocation: { Notification: 15 },
  Position: vi.fn().mockImplementation(function (line: number, char: number) {
    return { line, character: char }
  }),
  Range: vi.fn().mockImplementation(function (start: any, end: any) {
    return { start, end }
  }),
  CodeLens: vi.fn().mockImplementation(function (range: any, cmd: any) {
    return { range, command: cmd }
  })
}))

vi.mock("../commands", () => ({
  AbapFsCommands: {
    refreshHierarchy: "abapfs.refreshHierarchy",
    pickObject: "abapfs.pickObject"
  },
  command: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc,
  openObject: vi.fn()
}))

vi.mock("../lib", () => ({
  asyncCache: vi.fn(function (fn: any) {
    const cache = new Map()
    const getter = async (key: string, force?: boolean) => {
      if (!force && cache.has(key)) return cache.get(key)
      const val = await fn(key)
      cache.set(key, val)
      return val
    }
    getter.getSync = (key: string) => cache.get(key) || []
    getter.get = getter
    return getter
  }),
  cache: vi.fn(function (fn: any) {
    const map = new Map()
    return {
      get: (k: string) => {
        if (!map.has(k)) map.set(k, fn(k))
        return map.get(k)
      }
    }
  })
}))

vi.mock("./conections", () => ({
  getClient: vi.fn().mockReturnValue({
    typeHierarchy: vi.fn().mockResolvedValue([])
  }),
  ADTSCHEME: "adt"
}))

vi.mock("./operations/AdtObjectFinder", () => ({
  findAbapObject: vi.fn()
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    withProgress: vi.fn()
  }
}))

import { ClassHierarchyLensProvider } from "./classhierarchy"
import { findAbapObject } from "./operations/AdtObjectFinder"
import type { Mock } from "vitest"

describe("ClassHierarchyLensProvider", () => {
  it("is a singleton - get() returns same instance", () => {
    const a = ClassHierarchyLensProvider.get()
    const b = ClassHierarchyLensProvider.get()
    expect(a).toBe(b)
  })

  it("has onDidChangeCodeLenses event", () => {
    const provider = ClassHierarchyLensProvider.get()
    expect(provider.onDidChangeCodeLenses).toBeDefined()
  })

  it("provideCodeLenses returns empty array for non-ADT scheme", async () => {
    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "file", authority: "myconn", path: "/somefile.abap" },
      getText: vi.fn().mockReturnValue("")
    }
    const token: any = { isCancellationRequested: false }
    const lenses = await provider.provideCodeLenses(doc, token)
    expect(lenses).toEqual([])
  })

  it("provideCodeLenses returns empty array when no ABAP object found", async () => {
    ;(findAbapObject as Mock).mockResolvedValueOnce(null)

    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/SomeObject.clas.abap" },
      getText: vi.fn().mockReturnValue("CLASS ZCL_TEST DEFINITION.\nENDCLASS.")
    }
    const token: any = { isCancellationRequested: false, onCancellationRequested: vi.fn() }
    const lenses = await provider.provideCodeLenses(doc, token)
    expect(lenses).toEqual([])
  })

  it("provideCodeLenses returns code lenses for class declarations", async () => {
    ;(findAbapObject as Mock).mockResolvedValueOnce({
      structure: { adtcore: {} },
      loadStructure: vi.fn(),
      contentsPath: vi.fn().mockReturnValue("/sap/bc/adt/classes/zcl_test/source/main")
    })

    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/ZCL_TEST.clas.abap" },
      getText: vi.fn().mockReturnValue("CLASS ZCL_TEST DEFINITION.\nENDCLASS.")
    }
    const token: any = { isCancellationRequested: false, onCancellationRequested: vi.fn() }
    const lenses = await provider.provideCodeLenses(doc, token)
    // Should have at least a "Refresh Parents" lens
    expect(Array.isArray(lenses)).toBe(true)
    expect(lenses.length).toBeGreaterThan(0)
  })

  it("provideCodeLenses handles INTERFACE declarations", async () => {
    ;(findAbapObject as Mock).mockResolvedValueOnce({
      structure: {},
      loadStructure: vi.fn(),
      contentsPath: vi.fn().mockReturnValue("/sap/bc/adt/interfaces/zif_test/source/main")
    })

    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/ZIF_TEST.intf.abap" },
      getText: vi.fn().mockReturnValue("INTERFACE ZIF_TEST PUBLIC.\nENDINTERFACE.")
    }
    const token: any = { isCancellationRequested: false, onCancellationRequested: vi.fn() }
    const lenses = await provider.provideCodeLenses(doc, token)
    expect(Array.isArray(lenses)).toBe(true)
  })

  it("CLASSREGEX skips comment lines", async () => {
    ;(findAbapObject as Mock).mockResolvedValueOnce({
      structure: {},
      loadStructure: vi.fn(),
      contentsPath: vi.fn().mockReturnValue("/path")
    })

    const provider = ClassHierarchyLensProvider.get()
    // Line with a comment before CLASS keyword - the regex strips comments
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/ZCL_X.clas.abap" },
      getText: vi.fn().mockReturnValue('  " CLASS FAKE_CLASS.\n  CLASS REAL_CLASS DEFINITION.\n')
    }
    const lenses = await provider.provideCodeLenses(doc, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn()
    } as any)
    // Only REAL_CLASS line should generate lenses
    const labels = lenses.map((l: any) => l.command?.arguments?.[0]?.key)
    expect(labels.every((k: string) => !k?.includes("FAKE_CLASS"))).toBe(true)
  })
})
