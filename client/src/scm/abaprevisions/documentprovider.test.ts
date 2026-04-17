const mockEmitterFire = jest.fn()
const mockEmitterEvent = jest.fn()

jest.mock("vscode", () => {
  class EventEmitter {
    event = mockEmitterEvent
    fire = mockEmitterFire
  }
  return {
    EventEmitter,
    Uri: {
      parse: jest.fn((s: string) => ({ toString: () => s }))
    }
  }
}, { virtual: true })

jest.mock("../../lib", () => ({
  atob: jest.fn((s: string) => Buffer.from(s, "base64").toString()),
  btoa: jest.fn((s: string) => Buffer.from(s).toString("base64"))
}))

const mockGetObjectSource = jest.fn()
const mockRead = jest.fn()
jest.mock("../../adt/conections", () => ({
  abapUri: jest.fn(),
  ADTSCHEME: "adt",
  getClient: jest.fn(),
  getOrCreateClient: jest.fn().mockResolvedValue({ getObjectSource: mockGetObjectSource }),
  uriRoot: jest.fn(() => ({
    getNode: jest.fn(() => ({
      object: { read: mockRead }
    }))
  }))
}))

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn(() => true)
}))

const mockPrettyPrint = jest.fn()
jest.mock("./prettyprint", () => ({
  prettyPrint: mockPrettyPrint
}))

const mockGetCurrentRevQD = jest.fn()
jest.mock("./quickdiff", () => ({
  AbapQuickDiff: { get: jest.fn(() => ({ getCurrentRev: mockGetCurrentRevQD })) }
}))

import { abapUri } from "../../adt/conections"
import { btoa } from "../../lib"
import {
  AbapRevision,
  ADTREVISIONSCHEME,
  revisionUri,
  decodeRevisioUrl,
  quickDiffUri
} from "./documentprovider"

beforeEach(() => {
  jest.clearAllMocks()
  ;(AbapRevision as any).instance = undefined
})

const makeUri = (scheme: string, authority: string, path: string, fragment: string) => ({
  scheme,
  authority,
  path,
  fragment,
  with: jest.fn(function (this: any, changes: any) {
    return { ...this, ...changes, with: this.with }
  })
})

describe("ADTREVISIONSCHEME", () => {
  it("is adt_revision", () => {
    expect(ADTREVISIONSCHEME).toBe("adt_revision")
  })
})

describe("revisionUri", () => {
  it("returns undefined for non-ABAP URIs", () => {
    ;(abapUri as jest.Mock).mockReturnValue(false)
    const uri = makeUri("file", "", "/path", "")
    const result = revisionUri(uri as any)
    expect(result).toBeUndefined()
  })

  it("creates a revision URI with scheme adt_revision", () => {
    ;(abapUri as jest.Mock).mockReturnValue(true)
    const uri = makeUri("adt", "dev", "/path", "origFrag")
    const revision = { uri: "/rev/1", versionTitle: "V1" }

    const result = revisionUri(uri as any, revision as any, false)

    expect(result).toBeDefined()
    expect(uri.with).toHaveBeenCalledWith(expect.objectContaining({
      scheme: ADTREVISIONSCHEME
    }))
  })

  it("encodes revision and normalized flag in fragment", () => {
    ;(abapUri as jest.Mock).mockReturnValue(true)
    const uri = makeUri("adt", "dev", "/path", "orig")
    const revision = { uri: "/rev/1", versionTitle: "V1" }

    revisionUri(uri as any, revision as any, true)

    const callArg = (uri.with as jest.Mock).mock.calls[0][0]
    const decoded = JSON.parse(Buffer.from(callArg.fragment, "base64").toString())
    expect(decoded.type).toBe("simple")
    expect(decoded.revision).toEqual(revision)
    expect(decoded.normalized).toBe(true)
    expect(decoded.origFragment).toBe("orig")
  })

  it("works without a revision (undefined)", () => {
    ;(abapUri as jest.Mock).mockReturnValue(true)
    const uri = makeUri("adt", "dev", "/path", "")

    revisionUri(uri as any, undefined, false)

    const callArg = (uri.with as jest.Mock).mock.calls[0][0]
    const decoded = JSON.parse(Buffer.from(callArg.fragment, "base64").toString())
    expect(decoded.revision).toBeUndefined()
    expect(decoded.type).toBe("simple")
  })
})

describe("decodeRevisioUrl", () => {
  it("returns undefined for non-revision scheme", () => {
    const uri = makeUri("file", "", "/path", "")
    expect(decodeRevisioUrl(uri as any)).toBeUndefined()
  })

  it("returns undefined for quickdiff-type selector", () => {
    const selector = { type: "quickdiff", origFragment: "f" }
    const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
    const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)

    expect(decodeRevisioUrl(uri as any)).toBeUndefined()
  })

  it("returns undefined when revision is missing from simple selector", () => {
    const selector = { type: "simple", normalized: false, origFragment: "f" }
    const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
    const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)

    expect(decodeRevisioUrl(uri as any)).toBeUndefined()
  })

  it("decodes a valid revision URI", () => {
    const revision = { uri: "/rev/1", versionTitle: "V1" }
    const selector = { type: "simple", revision, normalized: true, origFragment: "orig" }
    const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
    const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)

    const result = decodeRevisioUrl(uri as any)

    expect(result).toBeDefined()
    expect(result!.revision).toEqual(revision)
    expect(result!.normalized).toBe(true)
  })

  it("returns undefined for corrupted base64 fragment", () => {
    const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", "!!!invalid-base64!!!")
    expect(decodeRevisioUrl(uri as any)).toBeUndefined()
  })
})

describe("quickDiffUri", () => {
  it("returns undefined for non-ABAP URIs", () => {
    ;(abapUri as jest.Mock).mockReturnValue(false)
    const uri = makeUri("file", "", "/path", "")
    expect(quickDiffUri(uri as any)).toBeUndefined()
  })

  it("creates quickdiff URI with type quickdiff in fragment", () => {
    ;(abapUri as jest.Mock).mockReturnValue(true)
    const uri = makeUri("adt", "dev", "/path", "origFrag")

    quickDiffUri(uri as any)

    const callArg = (uri.with as jest.Mock).mock.calls[0][0]
    expect(callArg.scheme).toBe(ADTREVISIONSCHEME)
    const decoded = JSON.parse(Buffer.from(callArg.fragment, "base64").toString())
    expect(decoded.type).toBe("quickdiff")
    expect(decoded.origFragment).toBe("origFrag")
  })
})

describe("AbapRevision", () => {
  describe("get()", () => {
    it("returns a singleton", () => {
      const a = AbapRevision.get()
      const b = AbapRevision.get()
      expect(a).toBe(b)
    })
  })

  describe("onDidChange", () => {
    it("exposes emitter event", () => {
      const provider = AbapRevision.get()
      expect(provider.onDidChange).toBe(mockEmitterEvent)
    })
  })

  describe("notifyChanged", () => {
    it("fires emitter with the URI", () => {
      const provider = AbapRevision.get()
      const uri = { scheme: "adt" } as any
      provider.notifyChanged(uri)
      expect(mockEmitterFire).toHaveBeenCalledWith(uri)
    })
  })

  describe("provideTextDocumentContent", () => {
    it("returns undefined for non-revision URIs", async () => {
      const provider = AbapRevision.get()
      const uri = makeUri("file", "dev", "/path", "")
      const result = await provider.provideTextDocumentContent(uri as any)
      expect(result).toBeUndefined()
    })

    it("fetches source for simple revision", async () => {
      const revision = { uri: "/src/rev1", versionTitle: "V1" }
      const selector = { type: "simple", revision, normalized: false, origFragment: "" }
      const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
      const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)
      mockGetObjectSource.mockResolvedValue("REPORT ztest.")

      const provider = AbapRevision.get()
      const result = await provider.provideTextDocumentContent(uri as any)

      expect(mockGetObjectSource).toHaveBeenCalledWith("/src/rev1")
      expect(result).toBe("REPORT ztest.")
    })

    it("applies prettyPrint when normalized is true", async () => {
      const revision = { uri: "/src/rev1", versionTitle: "V1" }
      const selector = { type: "simple", revision, normalized: true, origFragment: "" }
      const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
      const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)
      mockGetObjectSource.mockResolvedValue("REPORT ztest.")
      mockPrettyPrint.mockResolvedValue("report ztest.")

      const provider = AbapRevision.get()
      const result = await provider.provideTextDocumentContent(uri as any)

      expect(mockPrettyPrint).toHaveBeenCalled()
      expect(result).toBe("report ztest.")
    })

    it("returns empty string when prettyPrint returns falsy for normalized", async () => {
      const revision = { uri: "/src/rev1", versionTitle: "V1" }
      const selector = { type: "simple", revision, normalized: true, origFragment: "" }
      const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
      const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)
      mockGetObjectSource.mockResolvedValue("REPORT ztest.")
      mockPrettyPrint.mockResolvedValue(undefined)

      const provider = AbapRevision.get()
      const result = await provider.provideTextDocumentContent(uri as any)

      expect(result).toBe("")
    })

    it("fetches quickdiff source using current revision", async () => {
      const revision = { uri: "/src/qd", versionTitle: "QD Rev" }
      const selector = { type: "quickdiff", origFragment: "" }
      const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
      const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)
      mockGetCurrentRevQD.mockReturnValue(revision)
      mockGetObjectSource.mockResolvedValue("quickdiff source")

      const provider = AbapRevision.get()
      const result = await provider.provideTextDocumentContent(uri as any)

      expect(mockGetObjectSource).toHaveBeenCalledWith("/src/qd")
      expect(result).toBe("quickdiff source")
    })

    it("returns empty string for quickdiff when no current revision", async () => {
      const selector = { type: "quickdiff", origFragment: "" }
      const fragment = Buffer.from(JSON.stringify(selector)).toString("base64")
      const uri = makeUri(ADTREVISIONSCHEME, "dev", "/path", fragment)
      mockGetCurrentRevQD.mockReturnValue(undefined)

      const provider = AbapRevision.get()
      const result = await provider.provideTextDocumentContent(uri as any)

      expect(result).toBe("")
    })
  })
})
