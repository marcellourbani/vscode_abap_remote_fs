vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        scheme: "adt",
        authority: s.split("://")[1]?.split("/")[0] || "conn",
        path: s,
        toString: () => s
      }
    })
  }
}))

vi.mock("../../lib", () => ({
  cache: vi.fn(function (fn: any) {
    const map = new Map()
    const accessor = (k: string) => {
      if (!map.has(k)) map.set(k, fn(k))
      return map.get(k)
    }
    accessor.get = (k: string) => {
      if (!map.has(k)) map.set(k, fn(k))
      return map.get(k)
    }
    return accessor
  })
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn(),
  abapUri: vi.fn(),
  getRoot: vi.fn()
}))

vi.mock("abapobject", () => ({
  isAbapClassInclude: vi.fn().mockReturnValue(false)
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn()
}))

vi.mock("abap-adt-api", () => ({
  classIncludes: {},
  Revision: {}
}))

import { AbapRevisionService, revLabel } from "./abaprevisionservice"
import { getClient, abapUri, getRoot } from "../../adt/conections"
import { isAbapClassInclude } from "abapobject"
import { isAbapFile } from "abapfs"
import * as __$mock_lib from "../../lib"
import type { Mock } from "vitest"

const mockIsAbapClassInclude = isAbapClassInclude as unknown as Mock
const mockIsAbapFile = isAbapFile as unknown as Mock

describe("revLabel", () => {
  it("returns version when revision has version", () => {
    const rev: any = { version: "000010", date: "20240101" }
    expect(revLabel(rev, "default")).toBe("000010")
  })

  it("returns date when revision has no version but has date", () => {
    const rev: any = { version: undefined, date: "20240101" }
    expect(revLabel(rev, "default")).toBe("20240101")
  })

  it("returns fallback when revision is undefined", () => {
    expect(revLabel(undefined, "fallback")).toBe("fallback")
  })

  it("returns fallback when revision has neither version nor date", () => {
    const rev: any = { version: undefined, date: undefined }
    expect(revLabel(rev, "nothing")).toBe("nothing")
  })

  it("prefers version over date", () => {
    const rev: any = { version: "v1", date: "20240101" }
    expect(revLabel(rev, "fallback")).toBe("v1")
  })
})

describe("AbapRevisionService", () => {
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear the services cache between tests
    ;(AbapRevisionService as any).services = (__$mock_lib.cache as Mock)(
      (connId: string) => new (AbapRevisionService as any)(connId)
    )
    mockClient = {
      revisions: vi.fn().mockResolvedValue([
        { version: "000001", date: "20240101" },
        { version: "000002", date: "20231201" }
      ])
    }
    ;(getClient as Mock).mockReturnValue(mockClient)
  })

  it("get() returns an instance for connId", () => {
    const service = AbapRevisionService.get("conn1")
    expect(service).toBeDefined()
  })

  it("get() returns the same instance for same connId", () => {
    const s1 = AbapRevisionService.get("conn2")
    const s2 = AbapRevisionService.get("conn2")
    expect(s1).toBe(s2)
  })

  describe("objRevisions", () => {
    it("fetches revisions for an object", async () => {
      const service = AbapRevisionService.get("conn3")
      const mockObj: any = {
        key: "CLAS ZCL_TEST",
        structure: { "adtcore:name": "ZCL_TEST" },
        loadStructure: vi.fn()
      }
      mockIsAbapClassInclude.mockReturnValue(false)
      const revisions = await service.objRevisions(mockObj)
      expect(mockClient.revisions).toHaveBeenCalledWith(mockObj.structure, undefined)
      expect(revisions).toHaveLength(2)
    })

    it("returns cached revisions on second call without refresh", async () => {
      const service = AbapRevisionService.get("conn4")
      const mockObj: any = {
        key: "PROG ZPROG",
        structure: { uri: "/path" },
        loadStructure: vi.fn()
      }
      mockIsAbapClassInclude.mockReturnValue(false)
      await service.objRevisions(mockObj)
      await service.objRevisions(mockObj, false)
      // Should only call revisions once (cached on second call)
      expect(mockClient.revisions).toHaveBeenCalledTimes(1)
    })

    it("refreshes revisions when refresh=true", async () => {
      const service = AbapRevisionService.get("conn5")
      const mockObj: any = {
        key: "PROG ZPROG2",
        structure: { uri: "/path2" },
        loadStructure: vi.fn()
      }
      mockIsAbapClassInclude.mockReturnValue(false)
      await service.objRevisions(mockObj)
      await service.objRevisions(mockObj, true)
      expect(mockClient.revisions).toHaveBeenCalledTimes(2)
    })

    it("loads structure if not present", async () => {
      const service = AbapRevisionService.get("conn6")
      const loadStructureFn = vi.fn()
      const mockObj: any = {
        key: "PROG ZPROG3",
        structure: undefined,
        loadStructure: loadStructureFn
      }
      // loadStructure sets structure
      loadStructureFn.mockImplementation(function () {
        mockObj.structure = { uri: "/p" }
      })
      mockIsAbapClassInclude.mockReturnValue(false)
      await service.objRevisions(mockObj)
      expect(loadStructureFn).toHaveBeenCalled()
    })

    it("returns empty array when structure is undefined after load", async () => {
      const service = AbapRevisionService.get("conn7")
      const mockObj: any = {
        key: "PROG ZPROG4",
        structure: undefined,
        loadStructure: vi.fn() // doesn't set structure
      }
      mockIsAbapClassInclude.mockReturnValue(false)
      const revisions = await service.objRevisions(mockObj)
      expect(revisions).toEqual([])
    })

    it("handles class include - uses include and parent structure", async () => {
      const service = AbapRevisionService.get("conn8")
      const parentStructure = { uri: "/parent/path" }
      const mockObj: any = {
        key: "CLAS_INCL ZCL_TEST.main",
        structure: {},
        techName: "main",
        parent: { structure: parentStructure },
        loadStructure: vi.fn()
      }
      mockIsAbapClassInclude.mockReturnValue(true)
      await service.objRevisions(mockObj)
      expect(mockClient.revisions).toHaveBeenCalledWith(parentStructure, "main")
    })
  })

  describe("uriRevisions", () => {
    it("returns undefined for non-ABAP URIs", async () => {
      ;(abapUri as Mock).mockReturnValue(false)
      const service = AbapRevisionService.get("conn9")
      const uri: any = { scheme: "file", path: "/local/file.abap", authority: "conn9" }
      const result = await service.uriRevisions(uri, false)
      expect(result).toBeUndefined()
    })

    it("returns undefined for non-.abap paths", async () => {
      ;(abapUri as Mock).mockReturnValue(true)
      const service = AbapRevisionService.get("conn10")
      const uri: any = { scheme: "adt", path: "/sap/bc/adt/programs", authority: "conn10" }
      const result = await service.uriRevisions(uri, false)
      expect(result).toBeUndefined()
    })

    it("returns revisions for valid abap URI", async () => {
      ;(abapUri as Mock).mockReturnValue(true)
      const mockFile: any = { object: { key: "PROG ZPROG", structure: { uri: "/p" } } }
      mockIsAbapFile.mockReturnValue(true)
      const mockRoot: any = { getNodeAsync: vi.fn().mockResolvedValue(mockFile) }
      ;(getRoot as Mock).mockReturnValue(mockRoot)

      const service = AbapRevisionService.get("conn11")
      const uri: any = { scheme: "adt", path: "/sap/bc/adt/source.abap", authority: "conn11" }
      mockIsAbapClassInclude.mockReturnValue(false)
      mockFile.object.loadStructure = vi.fn()
      const revisions = await service.uriRevisions(uri, false)
      expect(revisions).toBeDefined()
    })
  })
})
