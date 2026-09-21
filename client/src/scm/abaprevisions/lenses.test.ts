const { mockFire, mockEvent } = vi.hoisted(() => {
  const mockFire = vi.fn()
  const mockEvent = vi.fn()
  return { mockFire, mockEvent }
})
vi.mock("vscode", () => {
  class EventEmitter {
    event = mockEvent
    fire = mockFire
  }
  class Range {
    constructor(
      public sl: number,
      public sc: number,
      public el: number,
      public ec: number
    ) {}
  }
  class CodeLens {
    constructor(
      public range: any,
      public command?: any
    ) {}
  }
  return { CodeLensProvider: class {}, EventEmitter, Range, CodeLens, Uri: {} }
})

const { mockGetCurrentRev, mockSetCurrentRev } = vi.hoisted(() => {
  const mockGetCurrentRev = vi.fn()
  const mockSetCurrentRev = vi.fn()
  return { mockGetCurrentRev, mockSetCurrentRev }
})
vi.mock("../../adt/conections", () => ({ abapUri: vi.fn() }))
vi.mock("./quickdiff", () => ({
  AbapQuickDiff: {
    get: vi.fn(function () {
      return {
        getCurrentRev: mockGetCurrentRev,
        setCurrentRev: mockSetCurrentRev
      }
    })
  }
}))

const { mockUriRevisions, mockRevLabel } = vi.hoisted(() => {
  const mockUriRevisions = vi.fn()
  const mockRevLabel = vi.fn(function (rev: any, def: string) {
    return rev?.versionTitle || def
  })
  return { mockUriRevisions, mockRevLabel }
})
vi.mock("./abaprevisionservice", () => ({
  AbapRevisionService: {
    get: vi.fn(function () {
      return { uriRevisions: mockUriRevisions }
    })
  },
  revLabel: mockRevLabel
}))
vi.mock("../../commands", () => ({
  AbapFsCommands: {
    changequickdiff: "cmd1",
    comparediff: "cmd2",
    remotediff: "cmd3",
    mergeEditor: "cmd4"
  }
}))

import { AbapRevisionLens } from "./lenses"
import { abapUri } from "../../adt/conections"
import type { Mock } from "vitest"

beforeEach(() => {
  vi.clearAllMocks()
  // Reset singleton
  ;(AbapRevisionLens as any).instance = undefined
})

describe("AbapRevisionLens.get()", () => {
  it("returns a singleton instance", () => {
    const a = AbapRevisionLens.get()
    const b = AbapRevisionLens.get()
    expect(a).toBe(b)
  })

  it("returns an instance of AbapRevisionLens", () => {
    const instance = AbapRevisionLens.get()
    expect(instance).toBeInstanceOf(AbapRevisionLens)
  })
})

describe("provideCodeLenses", () => {
  it("returns undefined for non-ABAP URIs", async () => {
    ;(abapUri as Mock).mockReturnValue(false)
    const lens = AbapRevisionLens.get()
    const doc = { uri: { scheme: "file", authority: "local" } } as any
    const result = await lens.provideCodeLenses(doc)
    expect(result).toBeUndefined()
  })

  it("returns undefined when no revisions are available", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    mockUriRevisions.mockResolvedValue([])
    const lens = AbapRevisionLens.get()
    const doc = { uri: { scheme: "adt", authority: "dev" } } as any
    const result = await lens.provideCodeLenses(doc)
    expect(result).toBeUndefined()
  })

  it("returns undefined when revisions is null", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    mockUriRevisions.mockResolvedValue(null)
    const lens = AbapRevisionLens.get()
    const doc = { uri: { scheme: "adt", authority: "dev" } } as any
    const result = await lens.provideCodeLenses(doc)
    expect(result).toBeUndefined()
  })

  it("returns 4 CodeLens entries with correct commands", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    const revisions = [
      { versionTitle: "Rev 1", uri: "/rev1" },
      { versionTitle: "Rev 2", uri: "/rev2" }
    ]
    mockUriRevisions.mockResolvedValue(revisions)
    mockGetCurrentRev.mockReturnValue(revisions[0])

    const lens = AbapRevisionLens.get()
    const docUri = { scheme: "adt", authority: "dev" }
    const doc = { uri: docUri } as any

    const result = await lens.provideCodeLenses(doc)

    expect(result).toHaveLength(4)
    expect(result![0].command!.command).toBe("cmd1") // changequickdiff
    expect(result![1].command!.command).toBe("cmd2") // comparediff
    expect(result![2].command!.command).toBe("cmd3") // remotediff
    expect(result![3].command!.command).toBe("cmd4") // mergeEditor
  })

  it("quickdiff lens title includes current revision label", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    const revisions = [{ versionTitle: "Version 5", uri: "/rev5" }]
    mockUriRevisions.mockResolvedValue(revisions)
    mockGetCurrentRev.mockReturnValue(revisions[0])

    const lens = AbapRevisionLens.get()
    const result = await lens.provideCodeLenses({ uri: { scheme: "adt", authority: "dev" } } as any)

    expect(result![0].command!.title).toBe("showing quickdiff with:Version 5")
    expect(result![0].command!.tooltip).toBe("Version 5")
  })

  it("sets current revision to first if none selected", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    const revisions = [{ versionTitle: "First", uri: "/r1" }]
    mockUriRevisions.mockResolvedValue(revisions)
    mockGetCurrentRev.mockReturnValue(null) // no current rev

    const lens = AbapRevisionLens.get()
    const docUri = { scheme: "adt", authority: "dev" }
    await lens.provideCodeLenses({ uri: docUri } as any)

    expect(mockSetCurrentRev).toHaveBeenCalledWith(docUri, revisions[0])
  })

  it("all lenses include document URI in arguments", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    const revisions = [{ versionTitle: "V1", uri: "/r" }]
    mockUriRevisions.mockResolvedValue(revisions)
    mockGetCurrentRev.mockReturnValue(revisions[0])

    const lens = AbapRevisionLens.get()
    const docUri = { scheme: "adt", authority: "dev" }
    const result = await lens.provideCodeLenses({ uri: docUri } as any)

    for (const l of result!) {
      expect(l.command!.arguments).toEqual([docUri])
    }
  })

  it("compare lens has correct title", async () => {
    ;(abapUri as Mock).mockReturnValue(true)
    mockUriRevisions.mockResolvedValue([{ versionTitle: "V", uri: "/r" }])
    mockGetCurrentRev.mockReturnValue({ versionTitle: "V", uri: "/r" })

    const lens = AbapRevisionLens.get()
    const result = await lens.provideCodeLenses({ uri: { scheme: "adt", authority: "d" } } as any)

    expect(result![1].command!.title).toBe("compare versions")
    expect(result![2].command!.title).toBe("compare with remote")
    expect(result![3].command!.title).toBe("merge conflicts with remote")
  })
})

describe("notify()", () => {
  it("fires the onDidChangeCodeLenses event", () => {
    const lens = AbapRevisionLens.get()
    lens.notify()
    expect(mockFire).toHaveBeenCalled()
  })
})

describe("onDidChangeCodeLenses", () => {
  it("exposes the emitter event", () => {
    const lens = AbapRevisionLens.get()
    const ev = lens.onDidChangeCodeLenses
    expect(ev).toBe(mockEvent)
  })
})
