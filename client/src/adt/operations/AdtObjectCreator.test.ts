jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({ scheme: "adt", path: "/path", toString: () => s }))
  },
  FileStat: jest.fn()
}), { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showInputBox: jest.fn()
  }
}))

jest.mock("../AdtTransports", () => ({ selectTransport: jest.fn() }))

jest.mock("../../lib", () => ({
  fieldOrder: () => () => 0,
  quickPick: jest.fn(),
  rfsExtract: jest.fn(),
  rfsTaskEither: jest.fn(),
  rfsTryCatch: jest.fn(),
  log: jest.fn()
}))

jest.mock("./AdtObjectFinder", () => ({
  MySearchResult: jest.fn(),
  AdtObjectFinder: jest.fn().mockImplementation(() => ({
    findObject: jest.fn(),
    vscodeUriWithFile: jest.fn()
  })),
  pathSequence: jest.fn().mockReturnValue([]),
  createUri: jest.fn()
}))

jest.mock("../conections", () => ({
  getClient: jest.fn().mockReturnValue({ username: "TESTUSER", validateNewObject: jest.fn().mockResolvedValue(true), createObject: jest.fn() }),
  getRoot: jest.fn().mockReturnValue({ getNode: jest.fn() })
}))

jest.mock("abapfs", () => ({
  isAbapFolder: jest.fn().mockReturnValue(false),
  isAbapStat: jest.fn().mockImplementation((x: any) => x != null && typeof x === "object" && x.object != null),
  isFolder: jest.fn().mockReturnValue(false)
}))

jest.mock("abapobject", () => ({ fromNode: jest.fn() }))

jest.mock("abap-adt-api", () => ({
  CreatableTypes: new Map([
    ["PROG/P", { typeId: "PROG/P", label: "Program", maxLen: 40 }],
    ["CLAS/OC", { typeId: "CLAS/OC", label: "Class", maxLen: 30 }],
    ["DEVC/K", { typeId: "DEVC/K", label: "Package", maxLen: 30 }]
  ]),
  objectPath: jest.fn((type: string, name?: string, parent?: string) => `/sap/bc/adt/${type}/${name}`),
  parentTypeId: jest.fn().mockReturnValue("DEVC/K"),
  isGroupType: jest.fn().mockReturnValue(false),
  isPackageType: jest.fn().mockReturnValue(false),
  isBindingOptions: jest.fn().mockReturnValue(false),
  hasPackageOptions: jest.fn().mockReturnValue(false),
  BindinTypes: [],
  PackageTypes: []
}))

jest.mock("fp-ts/lib/pipeable", () => ({ pipe: jest.fn((v: any) => v) }))
jest.mock("fp-ts/lib/TaskEither", () => ({
  bind: jest.fn(),
  chain: jest.fn(),
  map: jest.fn()
}))

import { AdtObjectCreator, selectObjectType, PACKAGE, TMPPACKAGE } from "./AdtObjectCreator"

describe("constants", () => {
  it("PACKAGE is DEVC/K", () => {
    expect(PACKAGE).toBe("DEVC/K")
  })

  it("TMPPACKAGE is $TMP", () => {
    expect(TMPPACKAGE).toBe("$TMP")
  })
})

describe("selectObjectType", () => {
  it("calls showQuickPick with all creatable types when no parent type", async () => {
    const { funWindow } = require("../../services/funMessenger")
    ;(funWindow.showQuickPick as jest.Mock).mockResolvedValue({
      typeId: "PROG/P",
      label: "Program",
      maxLen: 40
    })
    const result = await selectObjectType()
    expect(funWindow.showQuickPick).toHaveBeenCalled()
    expect(result?.typeId).toBe("PROG/P")
  })

  it("returns undefined when user cancels", async () => {
    const { funWindow } = require("../../services/funMessenger")
    ;(funWindow.showQuickPick as jest.Mock).mockResolvedValue(undefined)
    const result = await selectObjectType()
    expect(result).toBeUndefined()
  })

  it("filters types by parent type when parentType is provided", async () => {
    const { funWindow } = require("../../services/funMessenger")
    ;(funWindow.showQuickPick as jest.Mock).mockResolvedValue(undefined)
    const { parentTypeId } = require("abap-adt-api")
    ;(parentTypeId as jest.Mock).mockReturnValue("DEVC/K")
    await selectObjectType("DEVC/K")
    expect(funWindow.showQuickPick).toHaveBeenCalled()
  })
})

describe("AdtObjectCreator", () => {
  let creator: AdtObjectCreator

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset isAbapStat to its original implementation (clearAllMocks doesn't reset mockReturnValue)
    const { isAbapStat } = require("abapfs")
    ;(isAbapStat as jest.Mock).mockImplementation((x: any) => x != null && typeof x === "object" && x.object != null)
    creator = new AdtObjectCreator("testconn")
  })

  it("constructs with connId", () => {
    expect(creator).toBeDefined()
  })

  it("guessParentByType returns empty string when no match", () => {
    const { isAbapStat } = require("abapfs")
    ;(isAbapStat as jest.Mock).mockReturnValue(false)
    const result = creator.guessParentByType([], "DEVC/K")
    expect(result).toBe("")
  })

  it("guessParentByType finds matching type in hierarchy", () => {
    const { isAbapStat } = require("abapfs")
    ;(isAbapStat as jest.Mock).mockReturnValue(true)
    const hierarchy: any[] = [
      { object: { type: "DEVC/K", name: "ZPACKAGE" } },
      { object: { type: "PROG/P", name: "ZPROG" } }
    ]
    const result = creator.guessParentByType(hierarchy, "DEVC/K")
    expect(result).toBe("ZPACKAGE")
  })

  it("guessParentByType returns empty when no matching type", () => {
    const { isAbapStat } = require("abapfs")
    ;(isAbapStat as jest.Mock).mockReturnValue(true)
    const hierarchy: any[] = [{ object: { type: "PROG/P", name: "ZPROG" } }]
    const result = creator.guessParentByType(hierarchy, "DEVC/K")
    expect(result).toBe("")
  })

  it("getObjectTypes loads types from client", async () => {
    const { getClient } = require("../conections")
    const { getRoot } = require("../conections")
    ;(getClient as jest.Mock).mockReturnValue({
      loadTypes: jest.fn().mockResolvedValue([
        { OBJECT_TYPE: "PROG/P", PARENT_OBJECT_TYPE: "" }
      ])
    })
    ;(getRoot as jest.Mock).mockReturnValue({
      getNode: jest.fn().mockReturnValue(null)
    })
    const { Uri } = require("vscode")
    const uri = Uri.parse("adt://conn/path")
    const types = await creator.getObjectTypes(uri)
    expect(Array.isArray(types)).toBe(true)
  })

  it("createObject returns undefined when user cancels type selection", async () => {
    // createObject calls guessOrSelectObjectType which needs a non-empty hierarchy
    // With empty hierarchy, selectObjectType is called - mock it to return undefined (cancelled)
    const { funWindow } = require("../../services/funMessenger")
    ;(funWindow.showQuickPick as jest.Mock).mockResolvedValue(undefined)
    // getRoot returns a root that getNodePath returns [] for
    const { getRoot } = require("../conections")
    ;(getRoot as jest.Mock).mockReturnValue({
      getNode: jest.fn().mockReturnValue(null),
      getNodePath: jest.fn().mockReturnValue([])
    })
    const { pathSequence } = require("./AdtObjectFinder")
    ;(pathSequence as jest.Mock).mockReturnValue([])
    const result = await creator.createObject(undefined)
    expect(result).toBeUndefined()
  })
})
