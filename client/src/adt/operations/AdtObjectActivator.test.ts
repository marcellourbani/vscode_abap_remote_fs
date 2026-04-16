jest.mock("vscode", () => ({
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: "mockEvent",
    fire: jest.fn()
  })),
  Uri: {
    parse: jest.fn((s: string) => ({ scheme: "adt", authority: "conn", path: s, toString: () => s }))
  }
}), { virtual: true })

jest.mock("../conections", () => ({
  getClient: jest.fn()
}))

jest.mock("../includes", () => ({
  IncludeService: {
    get: jest.fn().mockReturnValue({
      needMain: jest.fn().mockReturnValue(false),
      current: jest.fn().mockReturnValue(null)
    })
  },
  IncludeProvider: {
    get: jest.fn().mockReturnValue({
      switchIncludeIfMissing: jest.fn().mockResolvedValue(null)
    })
  }
}))

jest.mock("../../lib", () => ({
  isDefined: jest.fn((x: any) => x !== undefined && x !== null),
  channel: { appendLine: jest.fn() }
}))

jest.mock("abap-adt-api", () => ({
  isAdtError: jest.fn(),
  inactiveObjectsInResults: jest.fn(),
  session_types: { stateful: "stateful" }
}))

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    withProgress: jest.fn()
  }
}))

jest.mock("abapobject", () => ({}))

import { AdtObjectActivator, ActivationEvent } from "./AdtObjectActivator"
import { getClient } from "../conections"

const mockGetClient = getClient as jest.Mock

describe("AdtObjectActivator", () => {
  let mockStatelessClient: any
  let mockClient: any

  beforeEach(() => {
    jest.clearAllMocks()
    AdtObjectActivator["instances"].clear()

    mockStatelessClient = {
      activate: jest.fn(),
      inactiveObjects: jest.fn().mockResolvedValue([]),
      statelessClone: { nodeContents: jest.fn().mockResolvedValue({ nodes: [] }), login: jest.fn() },
      nodeContents: jest.fn().mockResolvedValue({ nodes: [] }),
      httpClient: {
        request: jest.fn().mockResolvedValue({ body: "" })
      }
    }
    mockClient = {
      ...mockStatelessClient,
      statelessClone: mockStatelessClient
    }
    mockGetClient.mockReturnValue(mockClient)
  })

  it("creates an instance via get()", () => {
    const instance = AdtObjectActivator.get("testconn")
    expect(instance).toBeDefined()
    expect(instance).toBeInstanceOf(AdtObjectActivator)
  })

  it("get() returns the same instance for same connId", () => {
    const a = AdtObjectActivator.get("conn1")
    const b = AdtObjectActivator.get("conn1")
    expect(a).toBe(b)
  })

  it("get() returns different instances for different connIds", () => {
    const a = AdtObjectActivator.get("conn1")
    const b = AdtObjectActivator.get("conn2")
    expect(a).not.toBe(b)
  })

  it("onActivate returns an event", () => {
    const instance = AdtObjectActivator.get("conn3")
    expect(instance.onActivate).toBeDefined()
  })

  it("constructor uses stateless client", () => {
    AdtObjectActivator.get("conn4")
    expect(mockGetClient).toHaveBeenCalledWith("conn4", false)
  })

  describe("getFallbackInactiveObjects", () => {
    it("returns empty array when httpClient has no request method", async () => {
      mockGetClient.mockReturnValue({
        ...mockStatelessClient,
        httpClient: {}
      })
      const instance = new (AdtObjectActivator as any)(mockGetClient("testconn"))
      const result = await instance.getFallbackInactiveObjects()
      expect(result).toEqual([])
    })

    it("returns parsed objects from XML response", async () => {
      const xml = `
        <response>
          <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/zprog" adtcore:type="PROG/P" adtcore:name="ZPROG" />
        </response>
      `
      mockGetClient.mockReturnValue({
        ...mockStatelessClient,
        httpClient: {
          request: jest.fn().mockResolvedValue({ body: xml })
        }
      })
      const instance = new (AdtObjectActivator as any)(mockGetClient("testconn"))
      const result = await instance.getFallbackInactiveObjects()
      expect(result).toHaveLength(1)
      expect(result[0]["adtcore:uri"]).toBe("/sap/bc/adt/programs/programs/zprog")
      expect(result[0]["adtcore:name"]).toBe("ZPROG")
    })

    it("returns empty array when XML has no objectReference elements", async () => {
      mockGetClient.mockReturnValue({
        ...mockStatelessClient,
        httpClient: {
          request: jest.fn().mockResolvedValue({ body: "<empty/>" })
        }
      })
      const instance = new (AdtObjectActivator as any)(mockGetClient("testconn"))
      const result = await instance.getFallbackInactiveObjects()
      expect(result).toEqual([])
    })

    it("returns empty array on request failure", async () => {
      mockGetClient.mockReturnValue({
        ...mockStatelessClient,
        httpClient: {
          request: jest.fn().mockRejectedValue(new Error("Network error"))
        }
      })
      const instance = new (AdtObjectActivator as any)(mockGetClient("testconn"))
      const result = await instance.getFallbackInactiveObjects()
      expect(result).toEqual([])
    })

    it("filters out XML elements missing required fields", async () => {
      const xml = `
        <response>
          <adtcore:objectReference adtcore:uri="/path/obj" adtcore:type="PROG/P" />
          <adtcore:objectReference adtcore:type="PROG/P" adtcore:name="ZPROG2" />
        </response>
      `
      // First: no name (valid since no name), second: no uri
      mockGetClient.mockReturnValue({
        ...mockStatelessClient,
        httpClient: {
          request: jest.fn().mockResolvedValue({ body: xml })
        }
      })
      const instance = new (AdtObjectActivator as any)(mockGetClient("testconn"))
      const result = await instance.getFallbackInactiveObjects()
      // Only entries with both uri and name pass the filter
      result.forEach((r: any) => {
        expect(r["adtcore:uri"]).toBeTruthy()
        expect(r["adtcore:name"]).toBeTruthy()
      })
    })
  })
})
