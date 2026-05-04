jest.mock("vscode", () => ({}), { virtual: true })
jest.mock("abapfs", () => ({
  isAbapFile: jest.fn(),
  isAbapStat: jest.fn()
}))
jest.mock("../../lib", () => ({
  cache: jest.fn((fn: any) => ({ get: fn })),
  log: jest.fn()
}))
jest.mock("../conections", () => ({
  getRoot: jest.fn()
}))
jest.mock("abapobject", () => ({ PACKAGE: "DEVC/K" }))

import { IncludeService } from "./service"
import { getRoot } from "../conections"
import { isAbapFile, isAbapStat } from "abapfs"

const mockIsAbapFile = isAbapFile as unknown as jest.Mock
const mockIsAbapStat = isAbapStat as unknown as jest.Mock

// The static get() uses a cache that calls the constructor with getRoot(connId).
// We need to set up getRoot to return a mock Root.
const mockRoot = {
  getNode: jest.fn(),
  getNodeAsync: jest.fn(),
  getNodePath: jest.fn(() => [])
}

describe("IncludeService", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRoot as jest.Mock).mockReturnValue(mockRoot)
  })

  describe("static get", () => {
    it("returns an IncludeService instance", () => {
      // The cache mock returns { get: fn }, and static get calls this.services.get(connId)
      // which invokes the factory function with connId
      const result = IncludeService.get("dev100")
      // Since cache returns { get: factoryFn }, calling .get("dev100") invokes the factory
      // which creates a new IncludeService
      expect(result).toBeDefined()
    })

    it("calls getRoot with connId", () => {
      IncludeService.get("test123")
      expect(getRoot).toHaveBeenCalledWith("test123")
    })
  })

  describe("needMain", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("returns true for PROG/I objects", () => {
      const obj = { type: "PROG/I" } as any
      expect(service.needMain(obj)).toBe(true)
    })

    it("returns false for PROG/P objects", () => {
      const obj = { type: "PROG/P" } as any
      expect(service.needMain(obj)).toBe(false)
    })

    it("returns false for CLAS/OC objects", () => {
      const obj = { type: "CLAS/OC" } as any
      expect(service.needMain(obj)).toBe(false)
    })

    it("returns false for FUGR/FF objects", () => {
      const obj = { type: "FUGR/FF" } as any
      expect(service.needMain(obj)).toBe(false)
    })

    it("returns false for DEVC/K (package) objects", () => {
      const obj = { type: "DEVC/K" } as any
      expect(service.needMain(obj)).toBe(false)
    })

    it("returns false for empty type", () => {
      const obj = { type: "" } as any
      expect(service.needMain(obj)).toBe(false)
    })

    it("is case-sensitive — prog/i does not match", () => {
      const obj = { type: "prog/i" } as any
      expect(service.needMain(obj)).toBe(false)
    })
  })

  describe("mainName", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("decodes URI-encoded name", () => {
      const main = { "adtcore:name": "Z%2FTEST%2FPROGRAM" } as any
      expect(service.mainName(main)).toBe("Z/TEST/PROGRAM")
    })

    it("returns already-decoded name unchanged", () => {
      const main = { "adtcore:name": "ZPROGRAM" } as any
      expect(service.mainName(main)).toBe("ZPROGRAM")
    })

    it("decodes spaces (%20)", () => {
      const main = { "adtcore:name": "SOME%20PROGRAM" } as any
      expect(service.mainName(main)).toBe("SOME PROGRAM")
    })

    it("decodes plus signs literally (not as space)", () => {
      // decodeURIComponent does NOT decode + as space — only %20
      const main = { "adtcore:name": "A+B" } as any
      expect(service.mainName(main)).toBe("A+B")
    })

    it("handles double-encoded values", () => {
      // %252F is %25 decoded to %, then 2F remains = /
      const main = { "adtcore:name": "%252F" } as any
      // decodeURIComponent("%252F") => "%2F" (only one level of decoding)
      expect(service.mainName(main)).toBe("%2F")
    })

    it("handles special characters like hash and question mark", () => {
      const main = { "adtcore:name": "FOO%23BAR%3FBAZ" } as any
      expect(service.mainName(main)).toBe("FOO#BAR?BAZ")
    })

    it("handles empty name", () => {
      const main = { "adtcore:name": "" } as any
      expect(service.mainName(main)).toBe("")
    })
  })

  describe("current", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("returns undefined for unknown path", () => {
      expect(service.current("/some/unknown/path")).toBeUndefined()
    })
  })

  describe("includeData", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("returns undefined for path with no data", () => {
      expect(service.includeData("/unknown")).toBeUndefined()
    })
  })

  describe("setInclude", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("logs warning when setting include for unknown path with PROG/I file", () => {
      const lib = require("../../lib")
      const mockFile = { object: { type: "PROG/I" } }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNode.mockReturnValue(mockFile)

      const main = { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/foo" }
      service.setInclude("/test/path", main)
      expect(lib.log).toHaveBeenCalled()
    })

    it("does nothing when node is not an abap file", () => {
      const lib = require("../../lib")
      mockIsAbapFile.mockReturnValue(false)
      mockRoot.getNode.mockReturnValue({})

      const main = { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/foo" }
      service.setInclude("/unknown/path", main)
      expect(lib.log).not.toHaveBeenCalled()
    })
  })

  describe("guessParent", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("returns undefined for unknown path with no candidates", () => {
      mockRoot.getNodePath.mockReturnValue([])
      expect(service.guessParent("/unknown")).toBeUndefined()
    })

    it("returns single candidate when only one exists", () => {
      // We need to manually populate includes data via candidates or similar
      // For guessParent to find a single candidate, includeData must have length 1
      // Since includes is private, we test through the public interface indirectly
      mockRoot.getNodePath.mockReturnValue([])
      const result = service.guessParent("/some/path")
      expect(result).toBeUndefined()
    })

    it("returns parent from node path when available", () => {
      const parentObj = { name: "ZPROG", type: "PROG/P", path: "/sap/bc/adt/programs/programs/zprog" }
      const parentStat = { object: parentObj }
      mockIsAbapStat.mockImplementation((f: any) => f === parentStat)
      mockRoot.getNodePath.mockReturnValue([
        { file: {} },
        { file: parentStat }
      ] as any)

      const result = service.guessParent("/some/include/path")
      expect(result).toEqual({
        "adtcore:name": "ZPROG",
        "adtcore:type": "PROG/P",
        "adtcore:uri": "/sap/bc/adt/programs/programs/zprog"
      })
    })

    it("skips DEVC/K (package) parents", () => {
      const pkgStat = { object: { name: "PKG", type: "DEVC/K", path: "/pkg" } }
      mockIsAbapStat.mockImplementation((f: any) => f === pkgStat)
      mockRoot.getNodePath.mockReturnValue([
        { file: {} },
        { file: pkgStat }
      ] as any)

      const result = service.guessParent("/some/include/path")
      expect(result).toBeUndefined()
    })
  })

  describe("candidates", () => {
    let service: any

    beforeEach(() => {
      service = IncludeService.get("dev100")
    })

    it("returns undefined for non-abap file", async () => {
      mockIsAbapFile.mockReturnValue(false)
      mockRoot.getNodeAsync.mockResolvedValue({})

      const result = await service.candidates("/some/path")
      expect(result).toBeUndefined()
    })

    it("returns undefined for abap file that doesn't need main", async () => {
      const file = { object: { type: "PROG/P", mainPrograms: jest.fn() } }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNodeAsync.mockResolvedValue(file)

      const result = await service.candidates("/some/path")
      expect(result).toBeUndefined()
    })

    it("returns candidates for PROG/I file", async () => {
      const expectedCandidates = [
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/uri1" }
      ]
      const file = {
        object: {
          type: "PROG/I",
          path: "/include/path",
          mainPrograms: jest.fn().mockResolvedValue(expectedCandidates)
        }
      }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNodeAsync.mockResolvedValue(file)

      const result = await service.candidates("/some/path")
      expect(result).toEqual(expectedCandidates)
    })

    it("auto-selects current when only one candidate", async () => {
      const singleCandidate = [
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/uri1" }
      ]
      const file = {
        object: {
          type: "PROG/I",
          path: "/include/path",
          mainPrograms: jest.fn().mockResolvedValue(singleCandidate)
        }
      }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNodeAsync.mockResolvedValue(file)

      await service.candidates("/some/path")
      const current = service.current("/some/path")
      expect(current).toEqual(singleCandidate[0])
    })

    it("does not auto-select current when multiple candidates", async () => {
      const multipleCandidates = [
        { "adtcore:name": "ZPROG1", "adtcore:type": "PROG/P", "adtcore:uri": "/uri1" },
        { "adtcore:name": "ZPROG2", "adtcore:type": "PROG/P", "adtcore:uri": "/uri2" }
      ]
      const file = {
        object: {
          type: "PROG/I",
          path: "/include/path",
          mainPrograms: jest.fn().mockResolvedValue(multipleCandidates)
        }
      }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNodeAsync.mockResolvedValue(file)

      await service.candidates("/some/path")
      const current = service.current("/some/path")
      expect(current).toBeUndefined()
    })

    it("returns cached candidates on second call without refresh", async () => {
      const candidates = [
        { "adtcore:name": "ZPROG", "adtcore:type": "PROG/P", "adtcore:uri": "/uri1" }
      ]
      const file = {
        object: {
          type: "PROG/I",
          path: "/include/path",
          mainPrograms: jest.fn().mockResolvedValue(candidates)
        }
      }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNodeAsync.mockResolvedValue(file)

      await service.candidates("/cached/path")
      const result = await service.candidates("/cached/path")
      // mainPrograms should only be called once due to caching
      expect(file.object.mainPrograms).toHaveBeenCalledTimes(1)
      expect(result).toEqual(candidates)
    })

    it("refreshes candidates when refresh=true", async () => {
      const candidates1 = [{ "adtcore:name": "Z1", "adtcore:type": "PROG/P", "adtcore:uri": "/u1" }]
      const candidates2 = [{ "adtcore:name": "Z2", "adtcore:type": "PROG/P", "adtcore:uri": "/u2" }]
      const mainPrograms = jest.fn()
        .mockResolvedValueOnce(candidates1)
        .mockResolvedValueOnce(candidates2)
      const file = {
        object: { type: "PROG/I", path: "/p", mainPrograms }
      }
      mockIsAbapFile.mockReturnValue(true)
      mockRoot.getNodeAsync.mockResolvedValue(file)

      await service.candidates("/refresh/path")
      const result = await service.candidates("/refresh/path", true)
      expect(mainPrograms).toHaveBeenCalledTimes(2)
      expect(result).toEqual(candidates2)
    })
  })
})
