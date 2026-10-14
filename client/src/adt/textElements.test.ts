vi.mock("vscode", () => ({}))
vi.mock("../lib", () => ({ log: vi.fn() }))
vi.mock("./AdtTransports", () => ({ selectTransport: vi.fn() }))
vi.mock("abap-adt-api", () => ({
  ADTClient: {
    textElementsUrl: (objectType: string, objectName: string) => {
      const normalized = objectName.replace(/∕/g, "/")
      const encoded = normalized.includes("/")
        ? encodeURIComponent(normalized.toLowerCase())
        : normalized.toLowerCase()
      const upperType = objectType.toUpperCase()
      if (upperType.startsWith("CLAS")) return `/sap/bc/adt/textelements/classes/${encoded}`
      if (upperType.startsWith("FUGR")) return `/sap/bc/adt/textelements/functiongroups/${encoded}`
      return `/sap/bc/adt/textelements/programs/${encoded}`
    },
    lock: vi.fn(),
    unLock: vi.fn(),
    getTextElements: vi.fn()
  }
}))
vi.mock("../services/abapCopilotLogger", () => ({
  logCommands: { info: vi.fn() }
}))

import {
  parseObjectName,
  ObjectType,
  getTextElementsUrlFromObjectInfo,
  getTextElementsLockUrlFromObjectInfo,
  getTransportObjectPathFromObjectInfo,
  getTextElements,
  getTextElementsSafe,
  lockTextElements,
  type ObjectInfo,
  type TextElement,
  updateTextElementsWithTransport
} from "./textElements"
import { selectTransport } from "./AdtTransports"

// We also need to test the exported async functions - need to mock ADTClient
const makeClient = (overrides: Record<string, any> = {}) => ({
  httpClient: {
    request: vi.fn().mockResolvedValue({ body: "" })
  },
  ...overrides
})

describe("parseObjectName", () => {
  describe("explicit type override", () => {
    it("returns CLASS type for explicit 'CLASS'", () => {
      const result = parseObjectName("ZCL_MYCLASS", "CLASS")
      expect(result.type).toBe(ObjectType.CLASS)
      expect(result.cleanName).toBe("ZCL_MYCLASS")
    })

    it("returns CLASS type for explicit 'CLAS/OC'", () => {
      const result = parseObjectName("ZCL_FOO", "CLAS/OC")
      expect(result.type).toBe(ObjectType.CLASS)
    })

    it("strips .clas.abap extension with CLASS type", () => {
      const result = parseObjectName("zcl_foo.clas.abap", "CLASS")
      expect(result.type).toBe(ObjectType.CLASS)
      expect(result.cleanName).toBe("zcl_foo")
    })

    it("returns FUNCTION_GROUP type for explicit 'FUNCTION_GROUP'", () => {
      const result = parseObjectName("ZFG_GROUP", "FUNCTION_GROUP")
      expect(result.type).toBe(ObjectType.FUNCTION_GROUP)
      expect(result.cleanName).toBe("ZFG_GROUP")
    })

    it("returns FUNCTION_GROUP type for 'FUGR'", () => {
      const result = parseObjectName("ZFG_GROUP", "FUGR")
      expect(result.type).toBe(ObjectType.FUNCTION_GROUP)
    })

    it("returns PROGRAM type for explicit 'PROG'", () => {
      const result = parseObjectName("ZMYREPORT", "PROG")
      expect(result.type).toBe(ObjectType.PROGRAM)
      expect(result.cleanName).toBe("ZMYREPORT")
    })

    it("strips .prog.abap extension with PROG type", () => {
      const result = parseObjectName("zmyreport.prog.abap", "PROG/P")
      expect(result.type).toBe(ObjectType.PROGRAM)
      expect(result.cleanName).toBe("zmyreport")
    })

    it("preserves original name in result.name", () => {
      const result = parseObjectName("ZCL_FOO", "CLASS")
      expect(result.name).toBe("ZCL_FOO")
    })
  })

  describe("auto-detection from extension", () => {
    it("detects CLASS from .clas.abap extension", () => {
      const result = parseObjectName("zcl_foo.clas.abap")
      expect(result.type).toBe(ObjectType.CLASS)
      expect(result.cleanName).toBe("zcl_foo")
    })

    it("detects FUNCTION_GROUP from .fugr.abap extension", () => {
      const result = parseObjectName("zfg_group.fugr.abap")
      expect(result.type).toBe(ObjectType.FUNCTION_GROUP)
      expect(result.cleanName).toBe("zfg_group")
    })

    it("detects FUNCTION_MODULE from .func.abap extension", () => {
      const result = parseObjectName("z_function.func.abap")
      expect(result.type).toBe(ObjectType.FUNCTION_MODULE)
      expect(result.cleanName).toBe("z_function")
    })

    it("detects PROGRAM from .prog.abap extension", () => {
      const result = parseObjectName("zmyreport.prog.abap")
      expect(result.type).toBe(ObjectType.PROGRAM)
      expect(result.cleanName).toBe("zmyreport")
    })

    it("defaults to PROGRAM for plain name with no extension", () => {
      const result = parseObjectName("ZMYREPORT")
      expect(result.type).toBe(ObjectType.PROGRAM)
      expect(result.cleanName).toBe("ZMYREPORT")
    })
  })

  describe("namespace handling", () => {
    it("decodes URL-encoded namespace characters", () => {
      const result = parseObjectName("%2FNAMESPACE%2FOBJECT")
      expect(result.cleanName).toContain("/NAMESPACE/OBJECT")
    })

    it("normalizes division slash (∕) to forward slash (/)", () => {
      const result = parseObjectName("∕NAMESPACE∕OBJECT", "PROG")
      expect(result.cleanName).toContain("/NAMESPACE/OBJECT")
    })

    it("handles namespace class with division slash", () => {
      const result = parseObjectName("∕NAMESPACE∕ZCL_CLASS", "CLASS")
      expect(result.type).toBe(ObjectType.CLASS)
      expect(result.cleanName).toContain("/NAMESPACE/ZCL_CLASS")
    })

    it("handles invalid URL encoding gracefully", () => {
      // Should not throw - falls back to original
      const result = parseObjectName("%ZZ_INVALID", "PROG")
      expect(result).toBeDefined()
    })
  })
})

describe("getTextElementsUrlFromObjectInfo", () => {
  it("returns correct URL for PROGRAM", () => {
    const info: ObjectInfo = { name: "ZMYREPORT", type: ObjectType.PROGRAM, cleanName: "ZMYREPORT" }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/programs/zmyreport")
  })

  it("returns correct URL for CLASS", () => {
    const info: ObjectInfo = { name: "ZCL_FOO", type: ObjectType.CLASS, cleanName: "ZCL_FOO" }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/classes/zcl_foo")
  })

  it("returns correct URL for FUNCTION_GROUP", () => {
    const info: ObjectInfo = { name: "ZFG", type: ObjectType.FUNCTION_GROUP, cleanName: "ZFG" }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/functiongroups/zfg")
  })

  it("URL-encodes namespace characters", () => {
    const info: ObjectInfo = {
      name: "/NS/CLASS",
      type: ObjectType.CLASS,
      cleanName: "/NS/CLASS"
    }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toContain(encodeURIComponent("/ns/class"))
  })

  it("normalizes division slash before encoding", () => {
    const info: ObjectInfo = {
      name: "∕NS∕PROG",
      type: ObjectType.PROGRAM,
      cleanName: "∕NS∕PROG"
    }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toContain(encodeURIComponent("/ns/prog"))
  })
})

describe("getTextElementsLockUrlFromObjectInfo", () => {
  it("returns correct lock URL for PROGRAM (no /source/symbols)", () => {
    const info: ObjectInfo = { name: "ZMYREPORT", type: ObjectType.PROGRAM, cleanName: "ZMYREPORT" }
    const url = getTextElementsLockUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/programs/zmyreport")
    expect(url).not.toContain("/source/symbols")
  })

  it("returns correct lock URL for CLASS", () => {
    const info: ObjectInfo = { name: "ZCL_FOO", type: ObjectType.CLASS, cleanName: "ZCL_FOO" }
    const url = getTextElementsLockUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/classes/zcl_foo")
  })

  it("returns correct lock URL for FUNCTION_GROUP", () => {
    const info: ObjectInfo = { name: "ZFG", type: ObjectType.FUNCTION_GROUP, cleanName: "ZFG" }
    const url = getTextElementsLockUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/functiongroups/zfg")
  })
})

describe("getTransportObjectPathFromObjectInfo", () => {
  it("returns path without /source/symbols suffix", () => {
    const info: ObjectInfo = { name: "ZCL_FOO", type: ObjectType.CLASS, cleanName: "ZCL_FOO" }
    const path = getTransportObjectPathFromObjectInfo(info)
    expect(path).toBe("/sap/bc/adt/textelements/classes/zcl_foo")
    expect(path).not.toContain("/source/symbols")
  })

  it("returns same as lock URL", () => {
    const info: ObjectInfo = { name: "ZPROG", type: ObjectType.PROGRAM, cleanName: "ZPROG" }
    expect(getTransportObjectPathFromObjectInfo(info)).toBe(
      getTextElementsLockUrlFromObjectInfo(info)
    )
  })
})

describe("getTextElements (async)", () => {
  it("calls getTextElements with the correct URL and section", async () => {
    const getTextElementsFn = vi.fn().mockResolvedValue({ textElements: [], programName: "ZPROG" })
    const client: any = { getTextElements: getTextElementsFn }
    const result = await getTextElements(client, "ZPROG")
    expect(getTextElementsFn).toHaveBeenCalledWith(
      expect.stringContaining("/sap/bc/adt/textelements/programs/zprog"),
      "symbols"
    )
    expect(result.programName).toBe("ZPROG")
  })

  it("passes non-symbol categories through to the ADT client", async () => {
    const getTextElementsFn = vi.fn().mockResolvedValue({ textElements: [], programName: "ZPROG" })
    const client: any = { getTextElements: getTextElementsFn }

    await getTextElements(client, "ZPROG", undefined, "selections")

    expect(getTextElementsFn).toHaveBeenCalledWith(
      expect.stringContaining("/sap/bc/adt/textelements/programs/zprog"),
      "selections"
    )
  })

  it("returns empty array on 404", async () => {
    const getTextElementsFn = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const client: any = { getTextElements: getTextElementsFn }
    const result = await getTextElements(client, "ZMISSING")
    expect(result.textElements).toEqual([])
  })

  it("re-throws non-404 errors", async () => {
    const getTextElementsFn = vi
      .fn()
      .mockRejectedValue({ response: { status: 500 }, message: "Server error" })
    const client: any = { getTextElements: getTextElementsFn }
    await expect(getTextElements(client, "ZPROG")).rejects.toThrow("Failed to get text elements")
  })

  it("returns text elements result from API", async () => {
    const expected = {
      programName: "ZPROG",
      textElements: [
        { id: "001", text: "Article Selection", maxLength: 27 },
        { id: "002", text: "Output Mode", maxLength: 21 }
      ]
    }
    const getTextElementsFn = vi.fn().mockResolvedValue(expected)
    const client: any = { getTextElements: getTextElementsFn }
    const result = await getTextElements(client, "ZPROG")
    expect(result.textElements).toHaveLength(2)
    expect(result.textElements[0]).toMatchObject({
      id: "001",
      text: "Article Selection",
      maxLength: 27
    })
    expect(result.textElements[1]).toMatchObject({ id: "002", text: "Output Mode", maxLength: 21 })
  })
})

describe("getTextElementsSafe", () => {
  it("throws on empty object name", async () => {
    const client: any = { httpClient: { request: vi.fn() } }
    await expect(getTextElementsSafe(client, "")).rejects.toThrow("Object name is required")
  })

  it("throws on whitespace-only object name", async () => {
    const client: any = { httpClient: { request: vi.fn() } }
    await expect(getTextElementsSafe(client, "   ")).rejects.toThrow("Object name is required")
  })
})

describe("lockTextElements (async)", () => {
  it("calls connection.lock with the correct URL and MODIFY access mode", async () => {
    const lockFn = vi.fn().mockResolvedValue({ LOCK_HANDLE: "HANDLE123" })
    const client: any = { lock: lockFn }
    const result = await lockTextElements(client, "ZPROG")
    expect(lockFn).toHaveBeenCalledWith(
      expect.stringContaining("/sap/bc/adt/textelements/programs/zprog"),
      "MODIFY"
    )
    expect(result.lockHandle).toBe("HANDLE123")
  })

  it("maps AdtLock fields to LockResult", async () => {
    const lockFn = vi.fn().mockResolvedValue({
      LOCK_HANDLE: "HANDLE456",
      CORRUSER: "DEVUSER",
      CORRNR: "TR123456",
      CORRTEXT: "My transport",
      IS_LOCAL: " ",
      MODIFICATION_SUPPORT: "X"
    })
    const client: any = { lock: lockFn }
    const result = await lockTextElements(client, "ZPROG")
    expect(result.lockHandle).toBe("HANDLE456")
    expect(result.corrUserId).toBe("DEVUSER")
    expect(result.corrUser).toBe("DEVUSER")
    expect(result.isLocal).toBe(false)
    expect(result.modificationSupport).toBe(true)
    expect(result.transportInfo).toEqual({ corrNr: "TR123456", corrText: "My transport" })
  })

  it("re-throws on lock failure", async () => {
    const lockFn = vi.fn().mockRejectedValue(new Error("Connection refused"))
    const client: any = { lock: lockFn }
    await expect(lockTextElements(client, "ZPROG")).rejects.toThrow("Failed to lock text elements")
  })
})

describe("updateTextElementsWithTransport", () => {
  const url = "/sap/bc/adt/textelements/programs/zreport"
  const makeWriteClient = (lockOverrides: Record<string, any> = {}): any => ({
    lock: vi.fn().mockResolvedValue({
      LOCK_HANDLE: "LOCK1",
      IS_LOCAL: "",
      CORRNR: "TR100",
      ...lockOverrides
    }),
    unLock: vi.fn().mockResolvedValue(undefined),
    setTextElements: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes elements with the lock transport, then unlocks and activates", async () => {
    const client = makeWriteClient()
    await updateTextElementsWithTransport(
      client,
      "ZREPORT",
      [{ id: "001", text: "Hello" }],
      "PROGRAM",
      "symbols"
    )

    expect(client.setTextElements).toHaveBeenCalledWith(
      url,
      "symbols",
      [expect.objectContaining({ id: "001", text: "Hello" })],
      "LOCK1",
      "TR100"
    )
    expect(client.unLock).toHaveBeenCalledWith(url, "LOCK1")
    expect(client.activate).toHaveBeenCalledWith("ZREPORT", url)
    expect(selectTransport).not.toHaveBeenCalled()
  })

  it("writes selection texts without adding a symbol maxLength", async () => {
    const client = makeWriteClient()
    await updateTextElementsWithTransport(
      client,
      "ZREPORT",
      [{ id: "P_NAME", text: "Name" }],
      "PROGRAM",
      "selections"
    )

    expect(client.setTextElements).toHaveBeenCalledWith(
      url,
      "selections",
      [{ id: "P_NAME", text: "Name" }],
      "LOCK1",
      "TR100"
    )
  })

  it("accepts blank text on existing elements so unrelated writes are not blocked", async () => {
    const client = makeWriteClient()
    await updateTextElementsWithTransport(
      client,
      "ZREPORT",
      [
        { id: "001", text: "" },
        { id: "002", text: "Keep" }
      ],
      "PROGRAM",
      "symbols"
    )

    expect(client.setTextElements).toHaveBeenCalledWith(
      url,
      "symbols",
      [
        expect.objectContaining({ id: "001", text: "" }),
        expect.objectContaining({ id: "002", text: "Keep" })
      ],
      "LOCK1",
      "TR100"
    )
  })

  it("accepts an empty list so deleting every element writes an empty set", async () => {
    const client = makeWriteClient()
    await updateTextElementsWithTransport(client, "ZREPORT", [], "PROGRAM", "symbols")

    expect(client.setTextElements).toHaveBeenCalledWith(url, "symbols", [], "LOCK1", "TR100")
  })

  it("derives symbol maxLength from text length when not provided", async () => {
    const client = makeWriteClient()
    await updateTextElementsWithTransport(
      client,
      "ZREPORT",
      [{ id: "001", text: "x".repeat(50) }],
      "PROGRAM",
      "symbols"
    )

    expect(client.setTextElements).toHaveBeenCalledWith(
      url,
      "symbols",
      [expect.objectContaining({ id: "001", maxLength: 50 })],
      "LOCK1",
      "TR100"
    )
  })

  it("rejects non-string text before locking", async () => {
    const client = makeWriteClient()
    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [{ id: "001", text: undefined as any }],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Each text element must have valid text")

    expect(client.lock).not.toHaveBeenCalled()
  })

  it("rejects duplicate IDs ignoring case before locking", async () => {
    const client = makeWriteClient()
    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [
          { id: "a", text: "x" },
          { id: "A", text: "y" }
        ],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Duplicate text element ID: A")

    expect(client.lock).not.toHaveBeenCalled()
  })

  it("rejects symbol text longer than its maxLength", async () => {
    const client = makeWriteClient()
    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [{ id: "001", text: "abcdef", maxLength: 3 }],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Text length exceeds maxLength for element 001: 6 > 3")
  })

  it("rejects symbol maxLength outside 1 to 255", async () => {
    const client = makeWriteClient()
    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [{ id: "001", text: "abc", maxLength: 300 }],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Invalid maxLength for element 001")
  })

  it("asks for a transport when the lock has none and the object is not local", async () => {
    vi.mocked(selectTransport).mockResolvedValue({ cancelled: false, transport: "TR200" } as any)
    const client = makeWriteClient({ CORRNR: undefined })

    await updateTextElementsWithTransport(
      client,
      "ZREPORT",
      [{ id: "001", text: "Hello" }],
      "PROGRAM",
      "symbols"
    )

    expect(selectTransport).toHaveBeenCalledWith(url, "", client, false, "", "")
    expect(client.setTextElements).toHaveBeenCalledWith(
      url,
      "symbols",
      [expect.objectContaining({ id: "001" })],
      "LOCK1",
      "TR200"
    )
  })

  it("does not ask for a transport for local objects", async () => {
    const client = makeWriteClient({ CORRNR: undefined, IS_LOCAL: "X" })

    await updateTextElementsWithTransport(
      client,
      "ZREPORT",
      [{ id: "001", text: "Hello" }],
      "PROGRAM",
      "symbols"
    )

    expect(selectTransport).not.toHaveBeenCalled()
    expect(client.setTextElements).toHaveBeenCalledWith(
      url,
      "symbols",
      [expect.objectContaining({ id: "001" })],
      "LOCK1",
      undefined
    )
  })

  it("aborts and unlocks when transport selection is cancelled", async () => {
    vi.mocked(selectTransport).mockResolvedValue({ cancelled: true } as any)
    const client = makeWriteClient({ CORRNR: undefined })

    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [{ id: "001", text: "Hello" }],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Transport selection was cancelled")

    expect(client.setTextElements).not.toHaveBeenCalled()
    expect(client.unLock).toHaveBeenCalledWith(url, "LOCK1")
  })

  it("unlocks when the write fails", async () => {
    const client = makeWriteClient()
    client.setTextElements = vi.fn().mockRejectedValue(new Error("boom"))

    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [{ id: "001", text: "Hello" }],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Failed to set text elements for ZREPORT: boom")

    expect(client.unLock).toHaveBeenCalledWith(url, "LOCK1")
    expect(client.activate).not.toHaveBeenCalled()
  })

  it("does not unlock when the lock itself fails", async () => {
    const client = makeWriteClient()
    client.lock = vi.fn().mockRejectedValue(new Error("Locked by another user"))

    await expect(
      updateTextElementsWithTransport(
        client,
        "ZREPORT",
        [{ id: "001", text: "Hello" }],
        "PROGRAM",
        "symbols"
      )
    ).rejects.toThrow("Failed to lock text elements")

    expect(client.unLock).not.toHaveBeenCalled()
  })

  it("rejects an empty object name before locking", async () => {
    const client = makeWriteClient()
    await expect(
      updateTextElementsWithTransport(client, "  ", [{ id: "001", text: "x" }], "PROGRAM")
    ).rejects.toThrow("Object name is required")

    expect(client.lock).not.toHaveBeenCalled()
  })
})
