jest.mock("vscode", () => ({}), { virtual: true })
jest.mock("../lib", () => ({ log: jest.fn() }))
jest.mock("./AdtTransports", () => ({ selectTransport: jest.fn() }))
jest.mock("abap-adt-api", () => ({}))
jest.mock("abap-adt-api/build/utilities", () => ({
  fullParse: jest.fn()
}))
jest.mock("../services/abapCopilotLogger", () => ({
  logCommands: { info: jest.fn() }
}))

import {
  parseObjectName,
  ObjectType,
  getTextElementsUrlFromObjectInfo,
  getTextElementsLockUrlFromObjectInfo,
  getTransportObjectPathFromObjectInfo,
  ObjectInfo,
  TextElement
} from "./textElements"
import { fullParse } from "abap-adt-api/build/utilities"

// We also need to test the exported async functions - need to mock ADTClient
const makeClient = (overrides: Record<string, any> = {}) => ({
  httpClient: {
    request: jest.fn().mockResolvedValue({ body: "" })
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
    expect(url).toBe("/sap/bc/adt/textelements/programs/ZMYREPORT/source/symbols")
  })

  it("returns correct URL for CLASS", () => {
    const info: ObjectInfo = { name: "ZCL_FOO", type: ObjectType.CLASS, cleanName: "ZCL_FOO" }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/classes/ZCL_FOO/source/symbols")
  })

  it("returns correct URL for FUNCTION_GROUP", () => {
    const info: ObjectInfo = { name: "ZFG", type: ObjectType.FUNCTION_GROUP, cleanName: "ZFG" }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/functiongroups/ZFG/source/symbols")
  })

  it("URL-encodes namespace characters", () => {
    const info: ObjectInfo = {
      name: "/NS/CLASS",
      type: ObjectType.CLASS,
      cleanName: "/NS/CLASS"
    }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toContain(encodeURIComponent("/NS/CLASS"))
  })

  it("normalizes division slash before encoding", () => {
    const info: ObjectInfo = {
      name: "∕NS∕PROG",
      type: ObjectType.PROGRAM,
      cleanName: "∕NS∕PROG"
    }
    const url = getTextElementsUrlFromObjectInfo(info)
    expect(url).toContain(encodeURIComponent("/NS/PROG"))
  })
})

describe("getTextElementsLockUrlFromObjectInfo", () => {
  it("returns correct lock URL for PROGRAM (no /source/symbols)", () => {
    const info: ObjectInfo = { name: "ZMYREPORT", type: ObjectType.PROGRAM, cleanName: "ZMYREPORT" }
    const url = getTextElementsLockUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/programs/ZMYREPORT")
    expect(url).not.toContain("/source/symbols")
  })

  it("returns correct lock URL for CLASS", () => {
    const info: ObjectInfo = { name: "ZCL_FOO", type: ObjectType.CLASS, cleanName: "ZCL_FOO" }
    const url = getTextElementsLockUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/classes/ZCL_FOO")
  })

  it("returns correct lock URL for FUNCTION_GROUP", () => {
    const info: ObjectInfo = { name: "ZFG", type: ObjectType.FUNCTION_GROUP, cleanName: "ZFG" }
    const url = getTextElementsLockUrlFromObjectInfo(info)
    expect(url).toBe("/sap/bc/adt/textelements/functiongroups/ZFG")
  })
})

describe("getTransportObjectPathFromObjectInfo", () => {
  it("returns path without /source/symbols suffix", () => {
    const info: ObjectInfo = { name: "ZCL_FOO", type: ObjectType.CLASS, cleanName: "ZCL_FOO" }
    const path = getTransportObjectPathFromObjectInfo(info)
    expect(path).toBe("/sap/bc/adt/textelements/classes/ZCL_FOO")
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
  it("calls the correct URL with correct accept header", async () => {
    // Dynamically import to get around module-level hoisting
    const { getTextElements } = await import("./textElements")
    const requestFn = jest.fn().mockResolvedValue({ body: "001=Hello\n002=World\n" })
    const client: any = { httpClient: { request: requestFn } }
    const result = await getTextElements(client, "ZPROG")
    expect(requestFn).toHaveBeenCalledWith(
      expect.stringContaining("/sap/bc/adt/textelements/programs/ZPROG"),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.any(String) }) })
    )
    expect(result.programName).toBe("ZPROG")
  })

  it("returns empty array on 404", async () => {
    const { getTextElements } = await import("./textElements")
    const requestFn = jest.fn().mockRejectedValue({ response: { status: 404 } })
    const client: any = { httpClient: { request: requestFn } }
    const result = await getTextElements(client, "ZMISSING")
    expect(result.textElements).toEqual([])
  })

  it("re-throws non-404 errors", async () => {
    const { getTextElements } = await import("./textElements")
    const requestFn = jest.fn().mockRejectedValue({ response: { status: 500 }, message: "Server error" })
    const client: any = { httpClient: { request: requestFn } }
    await expect(getTextElements(client, "ZPROG")).rejects.toThrow("Failed to get text elements")
  })

  it("parses text elements from response body", async () => {
    const { getTextElements } = await import("./textElements")
    const body = "@MaxLength:27\n001=Article Selection\n@MaxLength:21\n002=Output Mode\n"
    const requestFn = jest.fn().mockResolvedValue({ body })
    const client: any = { httpClient: { request: requestFn } }
    const result = await getTextElements(client, "ZPROG")
    expect(result.textElements).toHaveLength(2)
    expect(result.textElements[0]).toMatchObject({ id: "001", text: "Article Selection", maxLength: 27 })
    expect(result.textElements[1]).toMatchObject({ id: "002", text: "Output Mode", maxLength: 21 })
  })
})

describe("getTextElementsSafe", () => {
  it("throws on empty object name", async () => {
    const { getTextElementsSafe } = await import("./textElements")
    const client: any = { httpClient: { request: jest.fn() } }
    await expect(getTextElementsSafe(client, "")).rejects.toThrow("Object name is required")
  })

  it("throws on whitespace-only object name", async () => {
    const { getTextElementsSafe } = await import("./textElements")
    const client: any = { httpClient: { request: jest.fn() } }
    await expect(getTextElementsSafe(client, "   ")).rejects.toThrow("Object name is required")
  })
})

describe("lockTextElements (async)", () => {
  it("calls POST with LOCK action", async () => {
    const { lockTextElements } = await import("./textElements")
    const mockXml = `<asx:abap><asx:values><DATA><LOCK_HANDLE>HANDLE123</LOCK_HANDLE></DATA></asx:values></asx:abap>`
    const mockFullParse = fullParse as jest.Mock
    mockFullParse.mockReturnValue({
      "asx:abap": { "asx:values": { DATA: { LOCK_HANDLE: "HANDLE123" } } }
    })
    const requestFn = jest.fn().mockResolvedValue({ body: mockXml })
    const client: any = { httpClient: { request: requestFn } }
    const result = await lockTextElements(client, "ZPROG")
    expect(requestFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        qs: expect.objectContaining({ _action: "LOCK", accessMode: "MODIFY" })
      })
    )
    expect(result.lockHandle).toBe("HANDLE123")
  })

  it("re-throws on request failure", async () => {
    const { lockTextElements } = await import("./textElements")
    const requestFn = jest.fn().mockRejectedValue(new Error("Connection refused"))
    const client: any = { httpClient: { request: requestFn } }
    await expect(lockTextElements(client, "ZPROG")).rejects.toThrow("Failed to lock text elements")
  })
})
