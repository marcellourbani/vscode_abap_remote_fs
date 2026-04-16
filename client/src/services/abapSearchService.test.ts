jest.mock("../adt/conections", () => ({
  getClient: jest.fn()
}))

jest.mock("./abapCopilotLogger", () => ({
  logSearch: {
    error: jest.fn(),
    info: jest.fn()
  }
}))

import { searchService, getSearchService, ABAPObjectInfo } from "./abapSearchService"
import { getClient } from "../adt/conections"
import { logSearch } from "./abapCopilotLogger"

const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockLogError = logSearch.error as jest.MockedFunction<typeof logSearch.error>

const makeSearchResult = (name: string, type: string, overrides: any = {}) => ({
  "adtcore:name": name,
  "adtcore:type": type,
  "adtcore:description": `Description of ${name}`,
  "adtcore:packageName": "ZPACKAGE",
  "adtcore:uri": `/sap/bc/adt/${type}/${name}`,
  ...overrides
})

describe("searchService constructor", () => {
  it("creates instance with connectionId", () => {
    const svc = new searchService("myconn")
    expect(svc).toBeInstanceOf(searchService)
  })
})

describe("searchService.searchObjects", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns results from client.searchObject", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([
        makeSearchResult("ZCL_TEST", "CLAS/OC")
      ])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("ZCLAS", ["CLAS"])

    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe("ZCL_TEST")
    expect(results[0]!.type).toBe("CLAS/OC")
  })

  it("searches specified types only", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([makeSearchResult("ZFM_TEST", "FUNC/FF")])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    await svc.searchObjects("ZFM*", ["FUNC"])

    expect(mockClient.searchObject).toHaveBeenCalledWith("ZFM*", "FUNC")
  })

  it("converts pattern to uppercase", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    await svc.searchObjects("zcl_test", ["CLAS"])

    expect(mockClient.searchObject).toHaveBeenCalledWith("ZCL_TEST", "CLAS")
  })

  it("classifies Z-objects as CUSTOM", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([makeSearchResult("ZTEST_PROG", "PROG/P")])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("ZTEST*", ["PROG"])
    expect(results[0]!.systemType).toBe("CUSTOM")
  })

  it("classifies Y-objects as CUSTOM", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([makeSearchResult("YTEST_PROG", "PROG/P")])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("YTEST*", ["PROG"])
    expect(results[0]!.systemType).toBe("CUSTOM")
  })

  it("classifies non-Z/Y objects as STANDARD", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([makeSearchResult("CL_ABAP_DEMO", "CLAS/OC")])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("CL_ABAP*", ["CLAS"])
    expect(results[0]!.systemType).toBe("STANDARD")
  })

  it("respects maxResults limit", async () => {
    const manyResults = Array.from({ length: 20 }, (_, i) =>
      makeSearchResult(`ZCL_${i}`, "CLAS/OC")
    )
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue(manyResults)
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("ZCL*", ["CLAS"], 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it("returns empty array on error", async () => {
    mockGetClient.mockImplementation(() => { throw new Error("No client") })

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("ZCL*", ["CLAS"])
    expect(results).toEqual([])
  })

  it("logs errors when outer try-catch fires", async () => {
    mockGetClient.mockImplementation(() => { throw new Error("Connection failed") })

    const svc = new searchService("myconn")
    await svc.searchObjects("ZCL*", ["CLAS"])
    expect(mockLogError).toHaveBeenCalled()
  })

  it("skips type when searchObject throws for that type", async () => {
    const mockClient = {
      searchObject: jest
        .fn()
        .mockRejectedValueOnce(new Error("Type not supported"))
        .mockResolvedValueOnce([makeSearchResult("ZTABLE", "TABL/DT")])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("Z*", ["FUNC", "TABL"])
    // Should still return results from the second type
    expect(results.some(r => r.name === "ZTABLE")).toBe(true)
  })

  it("searches all default types when no types provided", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    await svc.searchObjects("ZCL*")

    // Should be called many times (for each default type)
    expect(mockClient.searchObject.mock.calls.length).toBeGreaterThan(5)
  })

  it("includes description from search result", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([
        makeSearchResult("ZTEST", "CLAS/OC", { "adtcore:description": "My custom class" })
      ])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("ZTEST", ["CLAS"])
    expect(results[0]!.description).toBe("My custom class")
  })

  it("falls back to empty string when description is missing", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([
        { "adtcore:name": "ZTEST", "adtcore:type": "CLAS/OC" }
      ])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("ZTEST", ["CLAS"])
    expect(results[0]!.description).toBe("")
  })

  it("skips results with no name", async () => {
    const mockClient = {
      searchObject: jest.fn().mockResolvedValue([
        { "adtcore:type": "CLAS/OC" },
        makeSearchResult("ZVALID", "CLAS/OC")
      ])
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("Z*", ["CLAS"])
    expect(results.every(r => r.name)).toBe(true)
  })

  it("stops searching types when maxResults is reached across types", async () => {
    const mockClient = {
      searchObject: jest.fn().mockImplementation((pattern: string, type: string) => {
        return Promise.resolve([
          makeSearchResult(`Z${type}_1`, `${type}/OC`),
          makeSearchResult(`Z${type}_2`, `${type}/OC`)
        ])
      })
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const svc = new searchService("myconn")
    const results = await svc.searchObjects("Z*", ["CLAS", "INTF", "TABL"], 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })
})

describe("ABAPObjectInfo interface", () => {
  it("can hold all required fields", () => {
    const info: ABAPObjectInfo = {
      name: "ZTEST",
      type: "CLAS/OC",
      description: "Test class",
      package: "ZPACKAGE",
      systemType: "CUSTOM"
    }
    expect(info.name).toBe("ZTEST")
    expect(info.systemType).toBe("CUSTOM")
  })

  it("can hold optional fields", () => {
    const info: ABAPObjectInfo = {
      name: "ZTEST",
      type: "CLAS/OC",
      description: "",
      package: "",
      systemType: "STANDARD",
      lastModified: new Date("2024-01-01"),
      uri: "/sap/bc/adt/classes/ZTEST",
      details: { extra: true }
    }
    expect(info.lastModified).toBeInstanceOf(Date)
    expect(info.uri).toBe("/sap/bc/adt/classes/ZTEST")
  })
})

describe("getSearchService", () => {
  it("returns same instance for same connectionId", () => {
    const svc1 = getSearchService("conn1")
    const svc2 = getSearchService("conn1")
    expect(svc1).toBe(svc2)
  })

  it("returns different instances for different connectionIds", () => {
    const svc1 = getSearchService("connA")
    const svc2 = getSearchService("connB")
    expect(svc1).not.toBe(svc2)
  })

  it("returns a searchService instance", () => {
    const svc = getSearchService("connTest")
    expect(svc).toBeInstanceOf(searchService)
  })
})
