import { getVariant, runInspectorByAdtUrl, runInspector, findingPragmas } from "./codeinspector"

jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({ toString: () => s, scheme: "adt", authority: "sys" }))
  }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn()
}))

jest.mock("../../adt/operations/AdtObjectFinder", () => ({
  findAbapObject: jest.fn()
}))

jest.mock("../../config", () => ({
  RemoteManager: {
    get: jest.fn()
  }
}))

jest.mock("./functions", () => ({
  extractPragmas: jest.fn()
}))

import { getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { RemoteManager } from "../../config"
import { extractPragmas } from "./functions"

const mockGetClient = getClient as jest.MockedFunction<typeof getClient>
const mockFindAbapObject = findAbapObject as jest.MockedFunction<typeof findAbapObject>
const mockRemoteManager = RemoteManager.get as jest.MockedFunction<typeof RemoteManager.get>
const mockExtractPragmas = extractPragmas as jest.MockedFunction<typeof extractPragmas>

describe("getVariant", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns variant from connection config when atcVariant is set", async () => {
    const mockCheckVariant = { id: "myvariant" }
    const mockClient = {
      atcCheckVariant: jest.fn().mockResolvedValue(mockCheckVariant),
      atcCustomizing: jest.fn()
    }
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({ atcVariant: "MYVARIANT" })
    } as any)

    const result = await getVariant(mockClient as any, "myconn")

    expect(mockClient.atcCheckVariant).toHaveBeenCalledWith("MYVARIANT")
    expect(result).toEqual({ variant: "MYVARIANT", checkVariant: mockCheckVariant })
  })

  it("throws when atcVariant is configured but checkVariant is falsy", async () => {
    const mockClient = {
      atcCheckVariant: jest.fn().mockResolvedValue(null),
      atcCustomizing: jest.fn()
    }
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({ atcVariant: "BADVARIANT" })
    } as any)

    await expect(getVariant(mockClient as any, "myconn")).rejects.toThrow(
      "No ATC variant found for system myconn"
    )
  })

  it("falls back to system customizing when no atcVariant in config", async () => {
    const mockCheckVariant = { id: "system_variant" }
    const mockClient = {
      atcCheckVariant: jest.fn().mockResolvedValue(mockCheckVariant),
      atcCustomizing: jest.fn().mockResolvedValue({
        properties: [{ name: "systemCheckVariant", value: "DEFAULT" }]
      })
    }
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({})
    } as any)

    const result = await getVariant(mockClient as any, "myconn")

    expect(mockClient.atcCustomizing).toHaveBeenCalled()
    expect(mockClient.atcCheckVariant).toHaveBeenCalledWith("DEFAULT")
    expect(result).toEqual({ variant: "DEFAULT", checkVariant: mockCheckVariant })
  })

  it("throws when no connection found", async () => {
    const mockClient = {
      atcCheckVariant: jest.fn().mockResolvedValue(null),
      atcCustomizing: jest.fn().mockResolvedValue({
        properties: [{ name: "systemCheckVariant", value: "DEFAULT" }]
      })
    }
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue(null)
    } as any)

    await expect(getVariant(mockClient as any, "myconn")).rejects.toThrow(
      "No ATC variant found for system myconn"
    )
  })

  it("throws when systemCheckVariant not in customizing properties", async () => {
    const mockClient = {
      atcCheckVariant: jest.fn().mockResolvedValue(null),
      atcCustomizing: jest.fn().mockResolvedValue({
        properties: []
      })
    }
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({})
    } as any)

    await expect(getVariant(mockClient as any, "myconn")).rejects.toThrow(
      "No ATC variant found for system myconn"
    )
  })
})

describe("runInspectorByAdtUrl", () => {
  beforeEach(() => jest.clearAllMocks())

  it("creates ATC run and returns worklist", async () => {
    const mockWorklist = { objects: [] }
    const mockRun = { id: "run1", timestamp: "2024-01-01" }
    const mockClient = {
      createAtcRun: jest.fn().mockResolvedValue(mockRun),
      atcWorklists: jest.fn().mockReturnValue(mockWorklist)
    }

    const result = await runInspectorByAdtUrl("/some/uri", "MYVARIANT", mockClient as any)

    expect(mockClient.createAtcRun).toHaveBeenCalledWith("MYVARIANT", "/some/uri")
    expect(mockClient.atcWorklists).toHaveBeenCalledWith(
      "run1",
      "2024-01-01",
      "99999999999999999999999999999999"
    )
    expect(result).toBe(mockWorklist)
  })
})

describe("runInspector", () => {
  beforeEach(() => jest.clearAllMocks())

  it("loads structure if not present and delegates to runInspectorByAdtUrl", async () => {
    const mockWorklist = { objects: [] }
    const mockRun = { id: "run1", timestamp: "ts" }
    const mockClient = {
      createAtcRun: jest.fn().mockResolvedValue(mockRun),
      atcWorklists: jest.fn().mockReturnValue(mockWorklist)
    }
    const mockObject = {
      structure: null,
      loadStructure: jest.fn().mockResolvedValue(undefined),
      contentsPath: jest.fn().mockReturnValue("/some/path")
    }
    mockFindAbapObject.mockResolvedValue(mockObject as any)

    const mockUri = { toString: () => "adt://sys/path" } as any
    const result = await runInspector(mockUri, "MYVARIANT", mockClient as any)

    expect(mockFindAbapObject).toHaveBeenCalledWith(mockUri)
    expect(mockObject.loadStructure).toHaveBeenCalled()
    expect(mockObject.contentsPath).toHaveBeenCalled()
    expect(result).toBe(mockWorklist)
  })

  it("skips loadStructure when structure already present", async () => {
    const mockWorklist = { objects: [] }
    const mockRun = { id: "run1", timestamp: "ts" }
    const mockClient = {
      createAtcRun: jest.fn().mockResolvedValue(mockRun),
      atcWorklists: jest.fn().mockReturnValue(mockWorklist)
    }
    const mockObject = {
      structure: { name: "already loaded" },
      loadStructure: jest.fn(),
      contentsPath: jest.fn().mockReturnValue("/some/path")
    }
    mockFindAbapObject.mockResolvedValue(mockObject as any)

    await runInspector({} as any, "MYVARIANT", mockClient as any)

    expect(mockObject.loadStructure).not.toHaveBeenCalled()
  })
})

describe("findingPragmas", () => {
  beforeEach(() => jest.clearAllMocks())

  it("fetches pragma from finding link and extracts pragmas", async () => {
    const mockPragmas = ["##NO_TEXT"]
    mockExtractPragmas.mockReturnValue(mockPragmas)
    const mockClient = {
      httpClient: {
        request: jest.fn().mockResolvedValue({ body: "<html>pragma content</html>" })
      }
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const mockFinding = {
      link: { href: "/sap/bc/adt/atc/issues/docs/1" }
    } as any

    const result = await findingPragmas("myconn", mockFinding)

    expect(mockGetClient).toHaveBeenCalledWith("myconn")
    expect(mockClient.httpClient.request).toHaveBeenCalledWith("/sap/bc/adt/atc/issues/docs/1")
    expect(mockExtractPragmas).toHaveBeenCalledWith("<html>pragma content</html>")
    expect(result).toEqual(mockPragmas)
  })

  it("returns empty array when no pragmas found", async () => {
    mockExtractPragmas.mockReturnValue([])
    const mockClient = {
      httpClient: {
        request: jest.fn().mockResolvedValue({ body: "<html>no pragma</html>" })
      }
    }
    mockGetClient.mockReturnValue(mockClient as any)

    const result = await findingPragmas("conn", { link: { href: "/doc" } } as any)
    expect(result).toEqual([])
  })
})
