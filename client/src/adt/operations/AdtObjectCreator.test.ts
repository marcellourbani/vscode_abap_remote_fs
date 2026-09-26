vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn(function (s: string) {
      return { scheme: "adt", path: "/path", toString: () => s }
    })
  },
  FileStat: vi.fn(class {})
}))

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn()
  }
}))

vi.mock("../AdtTransports", () => ({ selectTransport: vi.fn() }))

vi.mock("../../lib", () => ({
  fieldOrder: () => () => 0,
  quickPick: vi.fn(),
  rfsExtract: vi.fn(),
  rfsTaskEither: vi.fn(),
  rfsTryCatch: vi.fn(),
  log: vi.fn()
}))

vi.mock("./AdtObjectFinder", () => ({
  MySearchResult: vi.fn(class {}),
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      findObject: vi.fn(),
      vscodeUriWithFile: vi.fn()
    }
  }),
  pathSequence: vi.fn().mockReturnValue([]),
  createUri: vi.fn()
}))

vi.mock("../conections", () => ({
  getClient: vi.fn().mockReturnValue({
    username: "TESTUSER",
    validateNewObject: vi.fn().mockResolvedValue(true),
    createObject: vi.fn()
  }),
  getRoot: vi.fn().mockReturnValue({ getNode: vi.fn() })
}))

vi.mock("abapfs", () => ({
  isAbapFolder: vi.fn().mockReturnValue(false),
  isAbapStat: vi.fn().mockImplementation(function (x: any) {
    return x != null && typeof x === "object" && x.object != null
  }),
  isFolder: vi.fn().mockReturnValue(false)
}))

vi.mock("abapobject", () => ({ fromNode: vi.fn() }))

vi.mock("abap-adt-api", () => ({
  CreatableTypes: new Map([
    ["PROG/P", { typeId: "PROG/P", label: "Program", maxLen: 40 }],
    ["CLAS/OC", { typeId: "CLAS/OC", label: "Class", maxLen: 30 }],
    ["DEVC/K", { typeId: "DEVC/K", label: "Package", maxLen: 30 }]
  ]),
  objectPath: vi.fn(function (type: string, name?: string, parent?: string) {
    return `/sap/bc/adt/${type}/${name}`
  }),
  parentTypeId: vi.fn().mockReturnValue("DEVC/K"),
  isGroupType: vi.fn().mockReturnValue(false),
  isPackageType: vi.fn().mockReturnValue(false),
  isBindingOptions: vi.fn().mockReturnValue(false),
  hasPackageOptions: vi.fn().mockReturnValue(false),
  BindinTypes: [],
  PackageTypes: []
}))

vi.mock("fp-ts/lib/pipeable", () => ({
  pipe: vi.fn(function (v: any) {
    return v
  })
}))
vi.mock("fp-ts/lib/TaskEither", () => ({
  bind: vi.fn(),
  chain: vi.fn(),
  map: vi.fn()
}))

import { AdtObjectCreator, selectObjectType, PACKAGE, TMPPACKAGE } from "./AdtObjectCreator"
import * as __$mock_services_funMessenger from "../../services/funMessenger"
import * as __$mock_abap_adt_api from "abap-adt-api"
import * as __$mock_abapfs from "abapfs"
import * as __$mock_conections from "../conections"
import * as __$mock_vscode from "vscode"
import * as __$mock_AdtObjectFinder from "./AdtObjectFinder"
import * as __$mock_AdtTransports from "../AdtTransports"
import * as __$mock_abapobject from "abapobject"
import type { Mock } from "vitest"

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
    const { funWindow } = __$mock_services_funMessenger
    ;(funWindow.showQuickPick as Mock).mockResolvedValue({
      typeId: "PROG/P",
      label: "Program",
      maxLen: 40
    })
    const result = await selectObjectType()
    expect(funWindow.showQuickPick).toHaveBeenCalled()
    expect(result?.typeId).toBe("PROG/P")
  })

  it("returns undefined when user cancels", async () => {
    const { funWindow } = __$mock_services_funMessenger
    ;(funWindow.showQuickPick as Mock).mockResolvedValue(undefined)
    const result = await selectObjectType()
    expect(result).toBeUndefined()
  })

  it("filters types by parent type when parentType is provided", async () => {
    const { funWindow } = __$mock_services_funMessenger
    ;(funWindow.showQuickPick as Mock).mockResolvedValue(undefined)
    const { parentTypeId } = __$mock_abap_adt_api
    ;(parentTypeId as Mock).mockReturnValue("DEVC/K")
    await selectObjectType("DEVC/K")
    expect(funWindow.showQuickPick).toHaveBeenCalled()
  })
})

describe("AdtObjectCreator", () => {
  let creator: AdtObjectCreator

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset isAbapStat to its original implementation (clearAllMocks doesn't reset mockReturnValue)
    const { isAbapStat } = __$mock_abapfs
    ;(isAbapStat as unknown as Mock).mockImplementation(function (x: any) {
      return x != null && typeof x === "object" && x.object != null
    })
    creator = new AdtObjectCreator("testconn")
  })

  it("constructs with connId", () => {
    expect(creator).toBeDefined()
  })

  it("guessParentByType returns empty string when no match", () => {
    const { isAbapStat } = __$mock_abapfs
    ;(isAbapStat as unknown as Mock).mockReturnValue(false)
    const result = creator.guessParentByType([], "DEVC/K")
    expect(result).toBe("")
  })

  it("guessParentByType finds matching type in hierarchy", () => {
    const { isAbapStat } = __$mock_abapfs
    ;(isAbapStat as unknown as Mock).mockReturnValue(true)
    const hierarchy: any[] = [
      { object: { type: "DEVC/K", name: "ZPACKAGE" } },
      { object: { type: "PROG/P", name: "ZPROG" } }
    ]
    const result = creator.guessParentByType(hierarchy, "DEVC/K")
    expect(result).toBe("ZPACKAGE")
  })

  it("guessParentByType returns empty when no matching type", () => {
    const { isAbapStat } = __$mock_abapfs
    ;(isAbapStat as unknown as Mock).mockReturnValue(true)
    const hierarchy: any[] = [{ object: { type: "PROG/P", name: "ZPROG" } }]
    const result = creator.guessParentByType(hierarchy, "DEVC/K")
    expect(result).toBe("")
  })

  it("getObjectTypes loads types from client", async () => {
    const { getClient } = __$mock_conections
    const { getRoot } = __$mock_conections
    ;(getClient as Mock).mockReturnValue({
      loadTypes: vi.fn().mockResolvedValue([{ OBJECT_TYPE: "PROG/P", PARENT_OBJECT_TYPE: "" }])
    })
    ;(getRoot as Mock).mockReturnValue({
      getNode: vi.fn().mockReturnValue(null)
    })
    const { Uri } = __$mock_vscode
    const uri = Uri.parse("adt://conn/path")
    const types = await creator.getObjectTypes(uri)
    expect(Array.isArray(types)).toBe(true)
  })

  it("createObject passes the connection language as master language", async () => {
    // Regression: abap-adt-api hardcodes adtcore:masterLanguage="EN" when the
    // create options carry no language. We must forward the connection language.
    const createObject = vi.fn().mockResolvedValue(undefined)
    const { getClient, getRoot } = __$mock_conections
    ;(getClient as Mock).mockReturnValue({
      username: "TESTUSER",
      language: "DE",
      validateNewObject: vi.fn().mockResolvedValue(true),
      createObject
    })
    ;(getRoot as Mock).mockReturnValue({
      getNode: vi.fn().mockReturnValue(null),
      getNodePath: vi.fn().mockReturnValue([]),
      service: {}
    })

    const { funWindow } = __$mock_services_funMessenger
    // guessOrSelectObjectType -> selectObjectType
    ;(funWindow.showQuickPick as Mock).mockResolvedValue({
      typeId: "PROG/P",
      label: "Program",
      maxLen: 40
    })
    // askName, then askInput("description")
    ;(funWindow.showInputBox as Mock).mockResolvedValueOnce("ZPROG").mockResolvedValueOnce("desc")

    const { AdtObjectFinder } = __$mock_AdtObjectFinder
    ;(AdtObjectFinder as Mock).mockImplementation(function () {
      return {
        findObject: vi.fn().mockResolvedValue({ name: "ZPKG" }),
        vscodeUriWithFile: vi.fn()
      }
    })

    const { selectTransport } = __$mock_AdtTransports
    ;(selectTransport as Mock).mockResolvedValue({ cancelled: false, transport: "K123" })

    const { fromNode } = __$mock_abapobject
    ;(fromNode as Mock).mockReturnValue({
      name: "ZPROG",
      type: "PROG/P",
      loadStructure: vi.fn().mockResolvedValue(undefined)
    })

    await creator.createObject(undefined)

    expect(createObject).toHaveBeenCalledTimes(1)
    expect(createObject.mock.calls[0][0]).toMatchObject({ language: "DE" })
  })

  it("createObject returns undefined when user cancels type selection", async () => {
    // createObject calls guessOrSelectObjectType which needs a non-empty hierarchy
    // With empty hierarchy, selectObjectType is called - mock it to return undefined (cancelled)
    const { funWindow } = __$mock_services_funMessenger
    ;(funWindow.showQuickPick as Mock).mockResolvedValue(undefined)
    // getRoot returns a root that getNodePath returns [] for
    const { getRoot } = __$mock_conections
    ;(getRoot as Mock).mockReturnValue({
      getNode: vi.fn().mockReturnValue(null),
      getNodePath: vi.fn().mockReturnValue([])
    })
    const { pathSequence } = __$mock_AdtObjectFinder
    ;(pathSequence as Mock).mockReturnValue([])
    const result = await creator.createObject(undefined)
    expect(result).toBeUndefined()
  })
})
