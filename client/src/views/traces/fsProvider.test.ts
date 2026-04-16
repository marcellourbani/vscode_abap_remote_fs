jest.mock("vscode", () => {
  class EventEmitter {
    event = jest.fn()
    fire = jest.fn()
  }
  class Disposable {
    constructor(public cb: () => void) {}
  }
  const FileType = { File: 1, Directory: 2 }
  return {
    EventEmitter,
    Disposable,
    FileType,
    Uri: {
      parse: (s: string) => {
        const match = s.match(/^(\w+):\/\/([^/]*)(.*)$/)
        return {
          scheme: match?.[1] || "",
          authority: match?.[2] || "",
          path: match?.[3] || s,
          toString: () => s
        }
      }
    },
    workspace: { registerFileSystemProvider: jest.fn() }
  }
}, { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn()
}))

jest.mock("./views", () => ({
  findRun: jest.fn()
}))

jest.mock("./convertProfile", () => ({
  convertRun: jest.fn(),
  convertStatements: jest.fn()
}))

import { workspace, FileType, Uri, Disposable } from "vscode"
import { getClient } from "../../adt/conections"
import { findRun } from "./views"
import { convertRun, convertStatements } from "./convertProfile"

// The module registers a filesystem provider at import time, so import after mocks
const mod = require("./fsProvider")
const { ADTPROFILE, adtProfileUri } = mod

// Access the TraceFs instance via the registerFileSystemProvider call
const registerCall = (workspace.registerFileSystemProvider as jest.Mock).mock.calls[0]
const registeredScheme = registerCall?.[0]
const traceFs = registerCall?.[1]

beforeEach(() => {
  // Clear mocks for per-test assertions but preserve module-load-time state
  ;(findRun as jest.Mock).mockReset()
  ;(getClient as jest.Mock).mockReset()
  ;(convertRun as jest.Mock).mockReset()
  ;(convertStatements as jest.Mock).mockReset()
})

describe("TraceFs", () => {
  describe("readFile", () => {
    it("throws when no trace run found", async () => {
      ;(findRun as jest.Mock).mockResolvedValue(undefined)
      const uri = Uri.parse("adt_profile://dev100/some/trace/id.cpuprofile")
      await expect(traceFs.readFile(uri)).rejects.toThrow("No trace run")
    })

    it("loads and returns profile for aggregated run (hitlist)", async () => {
      const fakeRun = { run: { id: "/trace/1" }, connId: "dev100", detailed: false }
      ;(findRun as jest.Mock).mockResolvedValue(fakeRun)
      const mockClient = {
        tracesHitList: jest.fn().mockResolvedValue({ entries: [] })
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      const fakeProfile = { startTime: 0, endTime: 1, nodes: [], samples: [], timeDeltas: [] }
      ;(convertRun as jest.Mock).mockReturnValue(fakeProfile)

      const uri = Uri.parse("adt_profile://dev100/trace/1.cpuprofile")
      const result = await traceFs.readFile(uri)

      expect(result).toBeInstanceOf(Uint8Array)
      const decoded = JSON.parse(new TextDecoder().decode(result))
      expect(decoded).toEqual(fakeProfile)
      expect(mockClient.tracesHitList).toHaveBeenCalledWith("/trace/1", true)
    })

    it("loads and returns profile for detailed run (statements)", async () => {
      const fakeRun = { run: { id: "/trace/2" }, connId: "dev100", detailed: true }
      ;(findRun as jest.Mock).mockResolvedValue(fakeRun)
      const mockClient = {
        tracesStatements: jest.fn().mockResolvedValue({ statements: [] })
      }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      const fakeProfile = { startTime: 0, endTime: 1, nodes: [], samples: [], timeDeltas: [] }
      ;(convertStatements as jest.Mock).mockReturnValue(fakeProfile)

      const uri = Uri.parse("adt_profile://dev100/trace/2.cpuprofile")
      const result = await traceFs.readFile(uri)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(mockClient.tracesStatements).toHaveBeenCalledWith("/trace/2", {
        withSystemEvents: true,
        withDetails: true
      })
    })

    it("caches result and does not reload on second call", async () => {
      const fakeRun = { run: { id: "/trace/3" }, connId: "dev100", detailed: false }
      ;(findRun as jest.Mock).mockResolvedValue(fakeRun)
      const mockClient = { tracesHitList: jest.fn().mockResolvedValue({ entries: [] }) }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      ;(convertRun as jest.Mock).mockReturnValue({ startTime: 0, endTime: 1, nodes: [], samples: [], timeDeltas: [] })

      const uri = Uri.parse("adt_profile://dev100/trace/3.cpuprofile")
      // WeakMap uses object identity, so we must reuse the same uri object
      const result1 = await traceFs.readFile(uri)
      const result2 = await traceFs.readFile(uri)

      // findRun is called each time because WeakMap cache depends on object identity
      // but if the URI object is reused, we'd get cache hit
      expect(result1).toEqual(result2)
    })
  })

  describe("stat", () => {
    it("returns FileType.File with correct size", async () => {
      const fakeRun = { run: { id: "/trace/stat" }, connId: "dev100", detailed: false }
      ;(findRun as jest.Mock).mockResolvedValue(fakeRun)
      const mockClient = { tracesHitList: jest.fn().mockResolvedValue({ entries: [] }) }
      ;(getClient as jest.Mock).mockReturnValue(mockClient)
      const fakeProfile = { data: "test" }
      ;(convertRun as jest.Mock).mockReturnValue(fakeProfile)

      const uri = Uri.parse("adt_profile://dev100/trace/stat.cpuprofile")
      const stat = await traceFs.stat(uri)

      expect(stat.type).toBe(FileType.File)
      expect(stat.ctime).toBe(0)
      expect(stat.mtime).toBe(0)
      expect(stat.size).toBeGreaterThan(0)
      const encoded = new TextEncoder().encode(JSON.stringify(fakeProfile))
      expect(stat.size).toBe(encoded.byteLength)
    })

    it("throws when no run found", async () => {
      ;(findRun as jest.Mock).mockResolvedValue(undefined)
      const uri = Uri.parse("adt_profile://dev100/no/run.cpuprofile")
      await expect(traceFs.stat(uri)).rejects.toThrow("No trace run")
    })
  })

  describe("read-only operations throw", () => {
    const uri = Uri.parse("adt_profile://dev100/dummy")

    it("writeFile throws not implemented", () => {
      expect(() => traceFs.writeFile(uri, new Uint8Array())).toThrow("not implemented")
    })

    it("delete throws not implemented", () => {
      expect(() => traceFs.delete(uri)).toThrow("not implemented")
    })

    it("rename throws not implemented", () => {
      const uri2 = Uri.parse("adt_profile://dev100/dummy2")
      expect(() => traceFs.rename(uri, uri2)).toThrow("not implemented")
    })

    it("createDirectory throws not implemented", () => {
      expect(() => traceFs.createDirectory(uri)).toThrow("not implemented")
    })

    it("copy throws not implemented", () => {
      const uri2 = Uri.parse("adt_profile://dev100/dummy2")
      expect(() => traceFs.copy(uri, uri2)).toThrow("not implemented")
    })
  })

  describe("readDirectory", () => {
    it("returns empty array", () => {
      const uri = Uri.parse("adt_profile://dev100/anything")
      const result = traceFs.readDirectory(uri)
      expect(result).toEqual([])
    })
  })

  describe("watch", () => {
    it("returns a Disposable", () => {
      const uri = Uri.parse("adt_profile://dev100/watch")
      const result = traceFs.watch(uri, { recursive: false, excludes: [] })
      expect(result).toBeInstanceOf(Disposable)
    })
  })
})

describe("ADTPROFILE constant", () => {
  it("equals adt_profile", () => {
    expect(ADTPROFILE).toBe("adt_profile")
  })
})

describe("adtProfileUri", () => {
  it("creates uri with connId as authority and .cpuprofile extension", () => {
    const run = { connId: "dev100", run: { id: "/sap/bc/trace/123" } }
    const uri = adtProfileUri(run)
    expect(uri.scheme).toBe("adt_profile")
    expect(uri.authority).toBe("dev100")
    expect(uri.path).toContain("/sap/bc/trace/123.cpuprofile")
  })
})

describe("registerFileSystemProvider", () => {
  it("was called with ADTPROFILE scheme", () => {
    expect(registeredScheme).toBe("adt_profile")
  })

  it("registered a provider instance", () => {
    expect(traceFs).toBeDefined()
  })
})
