jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({
      scheme: "adt",
      authority: s.split("://")[1]?.split("/")[0] || "conn",
      path: s,
      toString: () => s
    }))
  }
}), { virtual: true })

jest.mock("./abaprevisionservice", () => ({
  AbapRevisionService: {
    get: jest.fn()
  }
}))

jest.mock("../../adt/conections", () => ({
  abapUri: jest.fn()
}))

jest.mock("./documentprovider", () => ({
  quickDiffUri: jest.fn(),
  AbapRevision: {
    get: jest.fn().mockReturnValue({
      notifyChanged: jest.fn()
    })
  }
}))

jest.mock("./lenses", () => ({
  AbapRevisionLens: {
    get: jest.fn().mockReturnValue({
      notify: jest.fn()
    })
  }
}))

jest.mock("./abapscm", () => ({
  toMs: jest.fn((date: string) => {
    if (!date) return 0
    return new Date(date).getTime()
  })
}))

import { AbapQuickDiff } from "./quickdiff"
import { abapUri } from "../../adt/conections"
import { quickDiffUri, AbapRevision } from "./documentprovider"
import { AbapRevisionLens } from "./lenses"
import { AbapRevisionService } from "./abaprevisionservice"

describe("AbapQuickDiff", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset singleton
    ;(AbapQuickDiff as any).instance = undefined
  })

  it("get() returns a singleton", () => {
    const a = AbapQuickDiff.get()
    const b = AbapQuickDiff.get()
    expect(a).toBe(b)
  })

  it("is a singleton instance", () => {
    const instance = AbapQuickDiff.get()
    expect(instance).toBeInstanceOf(AbapQuickDiff)
  })

  describe("getCurrentRev / setCurrentRev", () => {
    it("getCurrentRev returns undefined for unknown URI", () => {
      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path" }
      expect(instance.getCurrentRev(uri)).toBeUndefined()
    })

    it("setCurrentRev stores the revision", () => {
      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path1" }
      const rev: any = { version: "000001", date: "20240101" }
      instance.setCurrentRev(uri, rev)
      expect(instance.getCurrentRev(uri)).toBe(rev)
    })

    it("setCurrentRev without rev removes it from store", () => {
      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path2" }
      const rev: any = { version: "000001", date: "20240101" }
      instance.setCurrentRev(uri, rev)
      instance.setCurrentRev(uri, undefined)
      expect(instance.getCurrentRev(uri)).toBeUndefined()
    })

    it("setCurrentRev notifies AbapRevisionLens", () => {
      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path3" }
      const rev: any = { version: "v1" }
      instance.setCurrentRev(uri, rev)
      expect(AbapRevisionLens.get().notify).toHaveBeenCalled()
    })

    it("setCurrentRev notifies AbapRevision when quickDiffUri is returned", () => {
      const mockQuickDiffUri = quickDiffUri as jest.Mock
      const mockQdUri: any = { toString: () => "adt_revision://conn/path" }
      mockQuickDiffUri.mockReturnValue(mockQdUri)

      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path4" }
      instance.setCurrentRev(uri, { version: "v1" } as any)
      expect(AbapRevision.get().notifyChanged).toHaveBeenCalledWith(mockQdUri)
    })
  })

  describe("provideOriginalResource", () => {
    it("returns undefined for non-ADT URIs", async () => {
      ;(abapUri as jest.Mock).mockReturnValue(false)
      const instance = AbapQuickDiff.get()
      const uri: any = { scheme: "file", toString: () => "file:///local.abap", authority: "conn" }
      const result = await instance.provideOriginalResource!(uri)
      expect(result).toBeUndefined()
    })

    it("returns quickDiffUri when current revision is set", async () => {
      ;(abapUri as jest.Mock).mockReturnValue(true)
      const mockQdUri: any = { toString: () => "adt_revision://conn/path" }
      ;(quickDiffUri as jest.Mock).mockReturnValue(mockQdUri)

      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path5", authority: "conn5" }
      const rev: any = { version: "v1" }
      instance.setCurrentRev(uri, rev)

      const result = await instance.provideOriginalResource!(uri)
      expect(result).toBe(mockQdUri)
    })

    it("returns undefined when fewer than 2 revisions", async () => {
      ;(abapUri as jest.Mock).mockReturnValue(true)
      const mockService: any = {
        uriRevisions: jest.fn().mockResolvedValue([{ version: "v1", date: "20240101" }])
      }
      ;(AbapRevisionService.get as jest.Mock).mockReturnValue(mockService)

      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path6", authority: "conn6" }
      // No current revision set
      const result = await instance.provideOriginalResource!(uri)
      expect(result).toBeUndefined()
    })

    it("returns undefined when no revisions available", async () => {
      ;(abapUri as jest.Mock).mockReturnValue(true)
      const mockService: any = {
        uriRevisions: jest.fn().mockResolvedValue(null)
      }
      ;(AbapRevisionService.get as jest.Mock).mockReturnValue(mockService)

      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path7", authority: "conn7" }
      const result = await instance.provideOriginalResource!(uri)
      expect(result).toBeUndefined()
    })

    it("selects reference revision more than 90s older than head", async () => {
      ;(abapUri as jest.Mock).mockReturnValue(true)
      const { toMs } = require("./abapscm")
      const now = Date.now()
      // toMs mocked to parse date strings as timestamps
      ;(toMs as jest.Mock).mockImplementation((date: string) => new Date(date).getTime())

      const newerDate = new Date(now).toISOString()
      const olderDate = new Date(now - 200000).toISOString() // 200s older

      const revisions: any[] = [
        { version: "v1", date: newerDate },
        { version: "v2", date: olderDate }
      ]
      const mockService: any = {
        uriRevisions: jest.fn().mockResolvedValue(revisions)
      }
      ;(AbapRevisionService.get as jest.Mock).mockReturnValue(mockService)
      const mockQdUri: any = { toString: () => "adt_revision://conn/path" }
      ;(quickDiffUri as jest.Mock).mockReturnValue(mockQdUri)

      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path8", authority: "conn8" }
      const result = await instance.provideOriginalResource!(uri)
      expect(result).toBe(mockQdUri)
      // Should have stored reference revision
      const stored = instance.getCurrentRev(uri)
      expect(stored?.version).toBe("v2")
    })

    it("falls back to revisions[1] when no revision is > 90s older", async () => {
      ;(abapUri as jest.Mock).mockReturnValue(true)
      const { toMs } = require("./abapscm")
      const now = Date.now()
      ;(toMs as jest.Mock).mockImplementation((date: string) => new Date(date).getTime())

      const newerDate = new Date(now).toISOString()
      const almostSameDate = new Date(now - 50000).toISOString() // 50s - less than 90s

      const revisions: any[] = [
        { version: "v1", date: newerDate },
        { version: "v2", date: almostSameDate }
      ]
      const mockService: any = {
        uriRevisions: jest.fn().mockResolvedValue(revisions)
      }
      ;(AbapRevisionService.get as jest.Mock).mockReturnValue(mockService)
      const mockQdUri: any = {}
      ;(quickDiffUri as jest.Mock).mockReturnValue(mockQdUri)

      const instance = AbapQuickDiff.get()
      const uri: any = { toString: () => "adt://conn/path9", authority: "conn9" }
      await instance.provideOriginalResource!(uri)
      // Should fall back to revisions[1]
      const stored = instance.getCurrentRev(uri)
      expect(stored?.version).toBe("v2")
    })
  })
})
