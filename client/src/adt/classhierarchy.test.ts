jest.mock("vscode", () => ({
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: jest.fn(),
    fire: jest.fn()
  })),
  ProgressLocation: { Notification: 15 },
  Position: jest.fn().mockImplementation((line: number, char: number) => ({ line, character: char })),
  Range: jest.fn().mockImplementation((start: any, end: any) => ({ start, end })),
  CodeLens: jest.fn().mockImplementation((range: any, cmd: any) => ({ range, command: cmd }))
}), { virtual: true })

jest.mock("../commands", () => ({
  AbapFsCommands: {
    refreshHierarchy: "abapfs.refreshHierarchy",
    pickObject: "abapfs.pickObject"
  },
  command: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc,
  openObject: jest.fn()
}))

jest.mock("../lib", () => ({
  asyncCache: jest.fn((fn: any) => {
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
  cache: jest.fn((fn: any) => {
    const map = new Map()
    return { get: (k: string) => { if (!map.has(k)) map.set(k, fn(k)); return map.get(k) } }
  })
}))

jest.mock("./conections", () => ({
  getClient: jest.fn().mockReturnValue({
    typeHierarchy: jest.fn().mockResolvedValue([])
  }),
  ADTSCHEME: "adt"
}))

jest.mock("./operations/AdtObjectFinder", () => ({
  findAbapObject: jest.fn()
}))

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    withProgress: jest.fn()
  }
}))

import { ClassHierarchyLensProvider } from "./classhierarchy"

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
      getText: jest.fn().mockReturnValue("")
    }
    const token: any = { isCancellationRequested: false }
    const lenses = await provider.provideCodeLenses(doc, token)
    expect(lenses).toEqual([])
  })

  it("provideCodeLenses returns empty array when no ABAP object found", async () => {
    const { findAbapObject } = await import("./operations/AdtObjectFinder")
    ;(findAbapObject as jest.Mock).mockResolvedValueOnce(null)

    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/SomeObject.clas.abap" },
      getText: jest.fn().mockReturnValue("CLASS ZCL_TEST DEFINITION.\nENDCLASS.")
    }
    const token: any = { isCancellationRequested: false, onCancellationRequested: jest.fn() }
    const lenses = await provider.provideCodeLenses(doc, token)
    expect(lenses).toEqual([])
  })

  it("provideCodeLenses returns code lenses for class declarations", async () => {
    const { findAbapObject } = await import("./operations/AdtObjectFinder")
    ;(findAbapObject as jest.Mock).mockResolvedValueOnce({
      structure: { adtcore: {} },
      loadStructure: jest.fn(),
      contentsPath: jest.fn().mockReturnValue("/sap/bc/adt/classes/zcl_test/source/main")
    })

    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/ZCL_TEST.clas.abap" },
      getText: jest.fn().mockReturnValue("CLASS ZCL_TEST DEFINITION.\nENDCLASS.")
    }
    const token: any = { isCancellationRequested: false, onCancellationRequested: jest.fn() }
    const lenses = await provider.provideCodeLenses(doc, token)
    // Should have at least a "Refresh Parents" lens
    expect(Array.isArray(lenses)).toBe(true)
    expect(lenses.length).toBeGreaterThan(0)
  })

  it("provideCodeLenses handles INTERFACE declarations", async () => {
    const { findAbapObject } = await import("./operations/AdtObjectFinder")
    ;(findAbapObject as jest.Mock).mockResolvedValueOnce({
      structure: {},
      loadStructure: jest.fn(),
      contentsPath: jest.fn().mockReturnValue("/sap/bc/adt/interfaces/zif_test/source/main")
    })

    const provider = ClassHierarchyLensProvider.get()
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/ZIF_TEST.intf.abap" },
      getText: jest.fn().mockReturnValue("INTERFACE ZIF_TEST PUBLIC.\nENDINTERFACE.")
    }
    const token: any = { isCancellationRequested: false, onCancellationRequested: jest.fn() }
    const lenses = await provider.provideCodeLenses(doc, token)
    expect(Array.isArray(lenses)).toBe(true)
  })

  it("CLASSREGEX skips comment lines", async () => {
    const { findAbapObject } = await import("./operations/AdtObjectFinder")
    ;(findAbapObject as jest.Mock).mockResolvedValueOnce({
      structure: {},
      loadStructure: jest.fn(),
      contentsPath: jest.fn().mockReturnValue("/path")
    })

    const provider = ClassHierarchyLensProvider.get()
    // Line with a comment before CLASS keyword - the regex strips comments
    const doc: any = {
      uri: { scheme: "adt", authority: "myconn", path: "/ZCL_X.clas.abap" },
      getText: jest.fn().mockReturnValue('  " CLASS FAKE_CLASS.\n  CLASS REAL_CLASS DEFINITION.\n')
    }
    const lenses = await provider.provideCodeLenses(doc, { isCancellationRequested: false, onCancellationRequested: jest.fn() } as any)
    // Only REAL_CLASS line should generate lenses
    const labels = lenses.map((l: any) => l.command?.arguments?.[0]?.key)
    expect(labels.every((k: string) => !k?.includes("FAKE_CLASS"))).toBe(true)
  })
})
