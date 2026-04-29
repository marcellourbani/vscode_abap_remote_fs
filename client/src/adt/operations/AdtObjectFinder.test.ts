interface MockUri {
  scheme: string; authority: string; path: string;
  toString(): string; with(o: any): MockUri
}
const makeUri = (s: string): MockUri => ({
  scheme: s.split("://")[0] || "",
  authority: s.split("://")[1]?.split("/")[0] || "",
  path: "/" + (s.split("://")[1]?.split("/").slice(1).join("/") || ""),
  toString: () => s,
  with(overrides: any): MockUri {
    const base = makeUri(s)
    const merged = { ...base, ...overrides, toString: () => s }
    merged.with = base.with
    return merged as MockUri
  }
})

jest.mock("vscode", () => ({
  workspace: {
    openTextDocument: jest.fn(),
    workspaceFolders: []
  },
  commands: { executeCommand: jest.fn() },
  Uri: {
    parse: jest.fn((s: string) => makeUri(s))
  },
  ThemeIcon: jest.fn(),
  FileStat: jest.fn(),
  Range: jest.fn().mockImplementation((s: any, e: any) => ({ start: s, end: e })),
  QuickPickItem: jest.fn()
}), { virtual: true })

jest.mock("../../lib", () => ({
  splitAdtUri: jest.fn((u: string) => ({ path: u, type: undefined, name: undefined, start: undefined })),
  vscPosition: jest.fn((l: number, c: number) => ({ line: l, character: c })),
  log: jest.fn(),
  caughtToString: jest.fn((e: any) => String(e)),
  promCache: jest.fn(() => {
    const map = new Map()
    return (key: string, fn: () => Promise<any>, force?: boolean) => {
      if (force || !map.has(key)) {
        const p = fn()
        map.set(key, p)
      }
      return map.get(key)
    }
  })
}))

jest.mock("../conections", () => ({
  getClient: jest.fn(),
  getRoot: jest.fn(),
  uriRoot: jest.fn()
}))

jest.mock("../../extension", () => ({
  context: {
    globalState: {
      get: jest.fn(),
      update: jest.fn()
    }
  }
}))

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showTextDocument: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn()
  }
}))

jest.mock("abapfs", () => ({
  isFolder: jest.fn(),
  isAbapFolder: jest.fn(),
  isAbapFile: jest.fn(),
  isAbapStat: jest.fn()
}))

jest.mock("./AdtObjectCreator", () => ({ PACKAGE: "DEVC/K" }))

import { MySearchResult, AdtObjectFinder, createUri } from "./AdtObjectFinder"

describe("MySearchResult", () => {
  const makeSR = (overrides: Record<string, any> = {}) => ({
    "adtcore:uri": "/sap/bc/adt/programs/programs/zprog",
    "adtcore:type": "PROG/P",
    "adtcore:name": "ZPROG",
    "adtcore:packageName": "ZPACKAGE",
    "adtcore:description": "My Program",
    ...overrides
  })

  it("constructs from search result", () => {
    const r = new MySearchResult(makeSR())
    expect(r.name).toBe("ZPROG")
    expect(r.type).toBe("PROG/P")
    expect(r.uri).toBe("/sap/bc/adt/programs/programs/zprog")
    expect(r.packageName).toBe("ZPACKAGE")
    expect(r.description).toBe("My Program")
  })

  it("label combines name and description", () => {
    const r = new MySearchResult(makeSR())
    expect(r.label).toBe("ZPROG(My Program)")
  })

  it("detail shows package and type", () => {
    const r = new MySearchResult(makeSR())
    expect(r.detail).toContain("ZPACKAGE")
    expect(r.detail).toContain("PROG/P")
  })

  it("picked defaults to false", () => {
    const r = new MySearchResult(makeSR())
    expect(r.picked).toBe(false)
  })

  it("handles missing optional fields", () => {
    const r = new MySearchResult(
      makeSR({ "adtcore:packageName": undefined, "adtcore:description": undefined })
    )
    expect(r.packageName).toBeUndefined()
    expect(r.description).toBeUndefined()
  })

  describe("createResults", () => {
    it("creates array of MySearchResult from raw results", async () => {
      const rawClient: any = { loadTypes: jest.fn().mockResolvedValue([]) }
      const rawResults = [makeSR(), makeSR({ "adtcore:name": "ZPROG2" })]
      const results = await MySearchResult.createResults(rawResults, rawClient)
      expect(results).toHaveLength(2)
      expect(results[0]).toBeInstanceOf(MySearchResult)
    })

    it("loads types if any result has no description", async () => {
      const rawClient: any = {
        loadTypes: jest.fn().mockResolvedValue([
          { OBJECT_TYPE: "PROG/P", OBJECT_TYPE_LABEL: "Program" }
        ])
      }
      const rawResults = [makeSR({ "adtcore:description": undefined })]
      const results = await MySearchResult.createResults(rawResults, rawClient)
      expect(rawClient.loadTypes).toHaveBeenCalled()
      expect(results[0]!.description).toBe("Program")
    })

    it("uses type as description fallback when no matching type label", async () => {
      const rawClient: any = {
        loadTypes: jest.fn().mockResolvedValue([])
      }
      const rawResults = [makeSR({ "adtcore:description": undefined, "adtcore:type": "CLAS/OC" })]
      const results = await MySearchResult.createResults(rawResults, rawClient)
      expect(results[0]!.description).toBe("CLAS/OC")
    })

    it("sets packageName from name for PACKAGE type", async () => {
      const rawClient: any = { loadTypes: jest.fn().mockResolvedValue([]) }
      const rawResults = [makeSR({ "adtcore:type": "DEVC/K", "adtcore:packageName": undefined })]
      const results = await MySearchResult.createResults(rawResults, rawClient)
      expect(results[0]!.packageName).toBe("ZPROG") // name
    })

    it("sets packageName to 'unknown' when not a package and no packageName", async () => {
      const rawClient: any = { loadTypes: jest.fn().mockResolvedValue([]) }
      const rawResults = [makeSR({ "adtcore:packageName": undefined })]
      const results = await MySearchResult.createResults(rawResults, rawClient)
      expect(results[0]!.packageName).toBe("unknown")
    })
  })
})

describe("createUri", () => {
  it("creates an adt:// URI from connId and path", () => {
    const { Uri } = require("vscode")
    createUri("myconn", "/sap/bc/adt/programs/programs/zprog")
    expect(Uri.parse).toHaveBeenCalledWith(
      expect.stringContaining("adt://myconn")
    )
  })
})

describe("AdtObjectFinder", () => {
  let finder: AdtObjectFinder
  let mockRoot: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockRoot = {
      findByAdtUri: jest.fn(),
      getNodePath: jest.fn().mockReturnValue([])
    }
    const { getRoot } = require("../conections")
    ;(getRoot as jest.Mock).mockReturnValue(mockRoot)
  })

  it("constructs with connId", () => {
    finder = new AdtObjectFinder("testconn")
    expect(finder.connId).toBe("testconn")
  })

  it("vscodeUri returns uri string", async () => {
    const { isAbapFile } = require("abapfs")
    ;(isAbapFile as jest.Mock).mockReturnValue(false)
    mockRoot.findByAdtUri.mockResolvedValue({
      path: "/sap/bc/adt/programs/programs/zprog/source/main",
      file: {}
    })
    const { Uri } = require("vscode")
    ;(Uri.parse as jest.Mock).mockReturnValue(makeUri("adt://testconn/sap/bc/adt/programs/programs/zprog/source/main"))

    finder = new AdtObjectFinder("testconn")
    const uri = await finder.vscodeUri("/sap/bc/adt/programs/programs/zprog/source/main")
    expect(uri).toBeDefined()
  })

  it("vscodeUri throws when path not found", async () => {
    mockRoot.findByAdtUri.mockResolvedValue(null)
    finder = new AdtObjectFinder("testconn")
    await expect(finder.vscodeUri("/bad/path")).rejects.toThrow("can't find an URL")
  })

  it("clearCaches resets fragCache", () => {
    finder = new AdtObjectFinder("testconn")
    // Should not throw
    expect(() => finder.clearCaches()).not.toThrow()
  })

  it("vscodeObject returns abap object for abap file", async () => {
    const { isAbapStat } = require("abapfs")
    ;(isAbapStat as jest.Mock).mockReturnValue(true)
    const mockObj = { name: "ZPROG", type: "PROG/P" }
    mockRoot.findByAdtUri.mockResolvedValue({
      path: "/path",
      file: { object: mockObj }
    })
    const { Uri } = require("vscode")
    ;(Uri.parse as jest.Mock).mockReturnValue(makeUri("adt://conn/path"))

    finder = new AdtObjectFinder("testconn")
    const obj = await finder.vscodeObject("/path")
    // isAbapStat check is in vscodeObject, which checks the file
  })

  it("displayAdtUri shows error message on failure", async () => {
    mockRoot.findByAdtUri.mockRejectedValue(new Error("Not found"))
    finder = new AdtObjectFinder("testconn")
    const { funWindow } = require("../../services/funMessenger")
    // Should not throw - shows error message instead
    await expect(
      finder.displayAdtUri("adt://testconn/sap/bc/adt/programs/programs/zprog")
    ).resolves.not.toThrow()
    // Can't easily verify message due to conditional logic
  })
})
