jest.mock("../adt/conections", () => ({
  getClient: jest.fn()
}))
jest.mock("../config", () => ({
  RemoteManager: {
    get: jest.fn()
  }
}))

import {
  clearSystemInfoCache,
  getSAPSystemInfo,
  formatSAPSystemInfoAsText,
  SAPSystemInfo,
  SAPSystemType
} from "./sapSystemInfo"
import { getClient } from "../adt/conections"
import { RemoteManager } from "../config"

const mockGetClient = getClient as jest.Mock
const mockRemoteManagerGet = RemoteManager.get as jest.Mock

function makeClient(queryResults: Record<string, any>) {
  return {
    runQuery: jest.fn(async (sql: string) => {
      if (sql.includes("T000")) return queryResults.t000 ?? null
      if (sql.includes("CVERS")) return queryResults.cvers ?? null
      if (sql.includes("SVERS")) return queryResults.svers ?? null
      if (sql.includes("ttzcu")) return queryResults.ttz ?? null
      return null
    })
  }
}

function makeRemoteManager(url = "https://my-sap.example.com", client = "100") {
  return {
    byId: jest.fn().mockReturnValue({ url, client })
  }
}

beforeEach(() => {
  clearSystemInfoCache()
  jest.clearAllMocks()
})

// ─── getSAPSystemInfo ────────────────────────────────────────────────────────

describe("getSAPSystemInfo", () => {
  test("throws when no client found", async () => {
    mockGetClient.mockReturnValue(null)
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    await expect(getSAPSystemInfo("dev100")).rejects.toThrow(
      "No client found for connection: dev100"
    )
  })

  test("throws when connection config not found", async () => {
    mockGetClient.mockReturnValue(makeClient({}))
    mockRemoteManagerGet.mockReturnValue({ byId: jest.fn().mockReturnValue(null) })

    await expect(getSAPSystemInfo("dev100")).rejects.toThrow(
      "Connection configuration not found for: dev100"
    )
  })

  test("returns system info with T000 data", async () => {
    const t000 = {
      values: [
        { MANDT: "100", MTEXT: "Test Client", CCCATEGORY: "T", LOGSYS: "DEVCLNT100", CCNOCLIIND: "0" }
      ]
    }
    mockGetClient.mockReturnValue(makeClient({ t000 }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")

    expect(info.currentClient).not.toBeNull()
    expect(info.currentClient!.clientNumber).toBe("100")
    expect(info.currentClient!.clientName).toBe("Test Client")
    expect(info.currentClient!.category).toBe("Test")
    expect(info.currentClient!.logicalSystem).toBe("DEVCLNT100")
    expect(info.currentClient!.changeProtection).toBe("Changes allowed (no protection)")
  })

  test("detects S/4HANA system type from S4CORE component", async () => {
    const cvers = {
      values: [
        { COMPONENT: "S4CORE", RELEASE: "107", EXTRELEASE: "", COMP_TYPE: "R" },
        { COMPONENT: "SAP_BASIS", RELEASE: "757", EXTRELEASE: "", COMP_TYPE: "R" }
      ]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.systemType).toBe("S/4HANA")
  })

  test("detects S/4HANA via S4COREOP component", async () => {
    const cvers = {
      values: [{ COMPONENT: "S4COREOP", RELEASE: "107", EXTRELEASE: "", COMP_TYPE: "R" }]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.systemType).toBe("S/4HANA")
  })

  test("detects ECC system type from SAP_APPL component", async () => {
    const cvers = {
      values: [{ COMPONENT: "SAP_APPL", RELEASE: "617", EXTRELEASE: "", COMP_TYPE: "R" }]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.systemType).toBe("ECC")
  })

  test("detects ECC system type from SAP_BASIS component alone", async () => {
    const cvers = {
      values: [{ COMPONENT: "SAP_BASIS", RELEASE: "750", EXTRELEASE: "", COMP_TYPE: "R" }]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.systemType).toBe("ECC")
  })

  test("returns Unknown system type when no recognizable components", async () => {
    const cvers = {
      values: [{ COMPONENT: "SOME_CUSTOM", RELEASE: "100", EXTRELEASE: "", COMP_TYPE: "R" }]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.systemType).toBe("Unknown")
  })

  test("populates SAP release from SVERS", async () => {
    const svers = { values: [{ VERSION: "757" }] }
    mockGetClient.mockReturnValue(makeClient({ svers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.sapRelease).toBe("757")
  })

  test("parses timezone with positive UTC offset (P prefix)", async () => {
    const ttz = {
      values: [
        { TZONESYS: "CAT", ZONERULE: "P0200", DSTRULE: "NONE", DESCRIPT: "Central Africa" }
      ]
    }
    mockGetClient.mockReturnValue(makeClient({ ttz }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.timezone).not.toBeNull()
    expect(info.timezone!.timezone).toBe("CAT")
    expect(info.timezone!.utcOffset).toBe("UTC+2")
    expect(info.timezone!.dstRule).toBe("NONE")
    expect(info.timezone!.description).toBe("Central Africa")
  })

  test("parses timezone with negative UTC offset (M prefix)", async () => {
    const ttz = {
      values: [
        { TZONESYS: "EST", ZONERULE: "M0500", DSTRULE: "US", DESCRIPT: "Eastern Time" }
      ]
    }
    mockGetClient.mockReturnValue(makeClient({ ttz }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.timezone!.utcOffset).toBe("UTC-5")
  })

  test("parses timezone with minutes in offset (e.g. UTC+5:30)", async () => {
    const ttz = {
      values: [
        { TZONESYS: "IST", ZONERULE: "P0530", DSTRULE: "NONE", DESCRIPT: "India Standard Time" }
      ]
    }
    mockGetClient.mockReturnValue(makeClient({ ttz }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.timezone!.utcOffset).toBe("UTC+5:30")
  })

  test("handles null/empty T000 query result gracefully", async () => {
    mockGetClient.mockReturnValue(makeClient({ t000: null }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.currentClient).toBeNull()
  })

  test("handles T000 query with empty values array", async () => {
    mockGetClient.mockReturnValue(makeClient({ t000: { values: [] } }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info.currentClient).toBeNull()
  })

  test("excludes softwareComponents when includeComponents=false", async () => {
    const cvers = {
      values: [{ COMPONENT: "SAP_BASIS", RELEASE: "750", EXTRELEASE: "", COMP_TYPE: "R" }]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100", false)
    expect(info.softwareComponents).toEqual([])
  })

  test("includes softwareComponents when includeComponents=true", async () => {
    const cvers = {
      values: [{ COMPONENT: "SAP_BASIS", RELEASE: "750", EXTRELEASE: "", COMP_TYPE: "R" }]
    }
    mockGetClient.mockReturnValue(makeClient({ cvers }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100", true)
    expect(info.softwareComponents).toHaveLength(1)
    expect(info.softwareComponents[0].component).toBe("SAP_BASIS")
  })

  test("caches result on second call (client.runQuery not called again)", async () => {
    const mockClient = makeClient({ svers: { values: [{ VERSION: "757" }] } })
    mockGetClient.mockReturnValue(mockClient)
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    await getSAPSystemInfo("dev100")
    const callCount = (mockClient.runQuery as jest.Mock).mock.calls.length

    await getSAPSystemInfo("dev100")
    expect((mockClient.runQuery as jest.Mock).mock.calls.length).toBe(callCount)
  })

  test("different URL produces different cache keys (no cross-contamination)", async () => {
    const clientA = makeClient({ svers: { values: [{ VERSION: "757" }] } })
    const clientB = makeClient({ svers: { values: [{ VERSION: "750" }] } })

    mockGetClient.mockReturnValueOnce(clientA).mockReturnValueOnce(clientB)
    mockRemoteManagerGet
      .mockReturnValueOnce(makeRemoteManager("https://sap-a.example.com"))
      .mockReturnValueOnce(makeRemoteManager("https://sap-b.example.com"))

    const infoA = await getSAPSystemInfo("devA")
    const infoB = await getSAPSystemInfo("devB")

    expect(infoA.sapRelease).toBe("757")
    expect(infoB.sapRelease).toBe("750")
  })

  test("cache is invalidated after clearSystemInfoCache", async () => {
    const mockClient = makeClient({ svers: { values: [{ VERSION: "757" }] } })
    mockGetClient.mockReturnValue(mockClient)
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    await getSAPSystemInfo("dev100")
    const firstCallCount = (mockClient.runQuery as jest.Mock).mock.calls.length

    clearSystemInfoCache()
    await getSAPSystemInfo("dev100")
    expect((mockClient.runQuery as jest.Mock).mock.calls.length).toBeGreaterThan(firstCallCount)
  })

  test("query errors are handled gracefully — result still returned", async () => {
    const faultyClient = {
      runQuery: jest.fn().mockRejectedValue(new Error("DB error"))
    }
    mockGetClient.mockReturnValue(faultyClient)
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(info).toBeDefined()
    expect(info.systemType).toBe("Unknown")
    expect(info.currentClient).toBeNull()
  })

  test("queryTimestamp is a valid ISO string", async () => {
    mockGetClient.mockReturnValue(makeClient({}))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager())

    const info = await getSAPSystemInfo("dev100")
    expect(() => new Date(info.queryTimestamp)).not.toThrow()
    expect(isNaN(new Date(info.queryTimestamp).getTime())).toBe(false)
  })

  test("client number is padded to 3 digits in T000 query", async () => {
    const mockClient = makeClient({ t000: { values: [] } })
    mockGetClient.mockReturnValue(mockClient)
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager("https://sap.example.com", "1"))

    await getSAPSystemInfo("dev100")

    const t000Call = (mockClient.runQuery as jest.Mock).mock.calls.find((c: any[]) =>
      c[0].includes("T000")
    )
    expect(t000Call![0]).toContain("'001'")
  })
})

// ─── formatSAPSystemInfoAsText ───────────────────────────────────────────────

describe("formatSAPSystemInfoAsText", () => {
  const baseInfo: SAPSystemInfo = {
    sapRelease: "757",
    systemType: "ECC",
    currentClient: null,
    softwareComponents: [],
    timezone: null,
    queryTimestamp: "2024-01-01T00:00:00.000Z"
  }

  test("includes system type", () => {
    const text = formatSAPSystemInfoAsText(baseInfo)
    expect(text).toContain("ECC")
  })

  test("includes query timestamp", () => {
    const text = formatSAPSystemInfoAsText(baseInfo)
    expect(text).toContain("2024-01-01T00:00:00.000Z")
  })

  test("includes SAP release", () => {
    const text = formatSAPSystemInfoAsText({ ...baseInfo, sapRelease: "757" })
    expect(text).toContain("757")
  })

  test("shows 'No client information available' when currentClient is null", () => {
    const text = formatSAPSystemInfoAsText(baseInfo)
    expect(text).toContain("No client information available")
  })

  test("includes client info when present", () => {
    const info: SAPSystemInfo = {
      ...baseInfo,
      currentClient: {
        clientNumber: "100",
        clientName: "Production",
        category: "Production",
        logicalSystem: "PRD",
        changeProtection: "No changes allowed"
      }
    }
    const text = formatSAPSystemInfoAsText(info)
    expect(text).toContain("Production")
    expect(text).toContain("Client 100")
  })

  test("includes timezone info when present", () => {
    const info: SAPSystemInfo = {
      ...baseInfo,
      timezone: {
        timezone: "UTC",
        description: "Coordinated Universal Time",
        utcOffset: "UTC+0",
        dstRule: "NONE",
        rawOffset: "P0000"
      }
    }
    const text = formatSAPSystemInfoAsText(info)
    expect(text).toContain("UTC")
    expect(text).toContain("No daylight saving time")
  })

  test("shows DST rule name when not NONE", () => {
    const info: SAPSystemInfo = {
      ...baseInfo,
      timezone: {
        timezone: "EST",
        description: "Eastern Time",
        utcOffset: "UTC-5",
        dstRule: "US_DST",
        rawOffset: "M0500"
      }
    }
    const text = formatSAPSystemInfoAsText(info)
    expect(text).toContain("US_DST")
  })

  test("omits SAP release section when empty", () => {
    const text = formatSAPSystemInfoAsText({ ...baseInfo, sapRelease: "" })
    expect(text).not.toContain("SAP RELEASE")
  })

  test("omits timezone section when null", () => {
    const text = formatSAPSystemInfoAsText(baseInfo)
    expect(text).not.toContain("SYSTEM TIMEZONE")
  })
})

// ─── Client category descriptions ────────────────────────────────────────────

describe("client category descriptions via getSAPSystemInfo", () => {
  const categories: Array<[string, string]> = [
    ["P", "Production"],
    ["T", "Test"],
    ["C", "Customizing"],
    ["D", "Demo"],
    ["E", "Education/Training"],
    ["S", "SAP Reference"],
    ["", "Not Classified"]
  ]

  test.each(categories)("category '%s' maps to '%s'", async (code, description) => {
    clearSystemInfoCache()
    const t000 = {
      values: [{ MANDT: "100", MTEXT: "Client", CCCATEGORY: code, LOGSYS: "", CCNOCLIIND: "" }]
    }
    mockGetClient.mockReturnValue(makeClient({ t000 }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager(`https://sap-${code || "empty"}.example.com`))

    const info = await getSAPSystemInfo("dev100")
    expect(info.currentClient!.category).toBe(description)
  })
})

// ─── Change protection descriptions ─────────────────────────────────────────

describe("change protection descriptions via getSAPSystemInfo", () => {
  const protections: Array<[string, string]> = [
    ["0", "Changes allowed (no protection)"],
    ["1", "No changes allowed"],
    ["2", "No changes allowed, no transports allowed"],
    ["", "No protection"]
  ]

  test.each(protections)("indicator '%s' maps to '%s'", async (code, description) => {
    clearSystemInfoCache()
    const t000 = {
      values: [{ MANDT: "100", MTEXT: "Client", CCCATEGORY: "T", LOGSYS: "", CCNOCLIIND: code }]
    }
    mockGetClient.mockReturnValue(makeClient({ t000 }))
    mockRemoteManagerGet.mockReturnValue(makeRemoteManager(`https://sap-cp-${code || "empty"}.example.com`))

    const info = await getSAPSystemInfo("dev100")
    expect(info.currentClient!.changeProtection).toBe(description)
  })
})
