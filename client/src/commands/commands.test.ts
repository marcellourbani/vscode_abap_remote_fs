jest.mock(
  "vscode",
  () => {
    const Uri = {
      parse: jest.fn((s: string) => ({
        scheme: s.startsWith("adt") ? "adt" : "file",
        authority: s.split("://")[1]?.split("/")[0] ?? "",
        path: "/" + (s.split("://")[1]?.split("/").slice(1).join("/") ?? ""),
        toString: () => s
      }))
    }
    return {
      Uri,
      workspace: {
        openTextDocument: jest.fn(),
        updateWorkspaceFolders: jest.fn(),
        workspaceFolders: []
      },
      commands: {
        executeCommand: jest.fn()
      },
      ProgressLocation: { Notification: 15, Window: 10 },
      Range: jest.fn(),
      FileChangeType: { Changed: 1 },
      extensions: {
        getExtension: jest.fn()
      },
      debug: {
        breakpoints: [],
        startDebugging: jest.fn()
      },
      SourceBreakpoint: class {}
    }
  },
  { virtual: true }
)

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showTextDocument: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    withProgress: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    createOutputChannel: jest.fn()
  }
}))

jest.mock("../adt/conections", () => ({
  ADTSCHEME: "adt",
  getClient: jest.fn(),
  getRoot: jest.fn(),
  uriRoot: jest.fn(),
  getOrCreateRoot: jest.fn(),
  disconnect: jest.fn()
}))

jest.mock("../config", () => ({
  pickAdtRoot: jest.fn(),
  RemoteManager: { get: jest.fn() }
}))

jest.mock("../lib", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  inputBox: jest.fn(),
  lineRange: jest.fn(),
  log: jest.fn(),
  rangeVscToApi: jest.fn(),
  splitAdtUri: jest.fn(),
  channel: { appendLine: jest.fn() }
}))

jest.mock("../views/favourites", () => ({
  FavouritesProvider: { get: jest.fn() },
  FavItem: jest.fn()
}))

jest.mock("../langClient", () => ({
  findEditor: jest.fn(),
  vsCodeUri: jest.fn()
}))

jest.mock("../listeners", () => ({
  showHideActivate: jest.fn()
}))

jest.mock("../adt/operations/UnitTestRunner", () => ({
  UnitTestRunner: { get: jest.fn().mockReturnValue({ controller: {} }) }
}))

jest.mock("../adt/AdtTransports", () => ({
  selectTransport: jest.fn()
}))

jest.mock("../adt/sapgui/sapgui", () => ({
  showInGuiCb: jest.fn(),
  executeInGui: jest.fn(),
  runInSapGui: jest.fn(),
  SapGui: { create: jest.fn() }
}))

jest.mock("../oauth", () => ({
  storeTokens: jest.fn(),
  clearTokens: jest.fn()
}))

jest.mock("../views/help", () => ({
  showAbapDoc: jest.fn()
}))

jest.mock("../views/query/query", () => ({
  showQuery: jest.fn()
}))

jest.mock("abapfs", () => ({
  isAbapFolder: jest.fn(),
  isAbapFile: jest.fn(),
  isAbapStat: jest.fn()
}))

jest.mock("../adt/operations/AdtObjectActivator", () => ({
  AdtObjectActivator: { get: jest.fn() }
}))

jest.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: jest.fn(),
  createUri: jest.fn(),
  findAbapObject: jest.fn(),
  uriAbapFile: jest.fn()
}))

jest.mock("abapobject", () => ({
  isAbapClassInclude: jest.fn()
}))

jest.mock("../adt/includes", () => ({
  IncludeProvider: { get: jest.fn() }
}))

jest.mock("./", () => ({
  command: () => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor,
  AbapFsCommands: {}
}))

jest.mock("./connectionwizard", () => ({
  createConnection: jest.fn()
}))

jest.mock("../configuration/sapConnectionManager", () => ({
  openConnectionManager: jest.fn()
}))

jest.mock("../extension", () => ({
  context: { subscriptions: [], extensionPath: "/fake" }
}))

jest.mock("../views/abaptestcockpit", () => ({
  atcProvider: { get: jest.fn() }
}))

jest.mock("../fs/FsProvider", () => ({
  FsProvider: { get: jest.fn() }
}))

jest.mock("../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))

jest.mock("../adt/debugger/abapDebugSession", () => ({
  AbapDebugSession: { byConnection: jest.fn() }
}))

jest.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K",
  AdtObjectCreator: jest.fn()
}))

jest.mock("abap-adt-api", () => ({
  CreatableTypeIds: {},
  PackageTypes: {},
  CreatableTypes: {}
}))

jest.mock("../views/sapgui/SapGuiPanel", () => ({
  SapGuiPanel: { createOrShow: jest.fn() }
}))

jest.mock("../services/sapSystemInfo", () => ({
  clearSystemInfoCache: jest.fn()
}))

import { currentUri, currentAbapFile, currentEditState, openObject } from "./commands"
import { funWindow as window } from "../services/funMessenger"
import { ADTSCHEME, getRoot } from "../adt/conections"
import { uriAbapFile } from "../adt/operations/AdtObjectFinder"
import { isAbapFolder, isAbapFile } from "abapfs"

// Helper to cast type-guard mocks
const asMock = (fn: any): jest.Mock => fn as jest.Mock
import * as vscode from "vscode"

const mockWindow = window as jest.Mocked<typeof window>
const mockGetRoot = getRoot as jest.MockedFunction<typeof getRoot>
const mockUriAbapFile = uriAbapFile as jest.MockedFunction<typeof uriAbapFile>

function makeAdtUri(authority = "dev100", path = "/sap/bc/adt/programs/programs/ztest") {
  return { scheme: "adt", authority, path, toString: () => `adt://${authority}${path}` } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(mockWindow as any).activeTextEditor = undefined
})

describe("currentUri", () => {
  test("returns undefined when no active editor", () => {
    expect(currentUri()).toBeUndefined()
  })

  test("returns undefined when active editor is not adt scheme", () => {
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: { scheme: "file", authority: "", path: "/test.ts" } }
    }
    expect(currentUri()).toBeUndefined()
  })

  test("returns uri when active editor is adt scheme", () => {
    const uri = makeAdtUri()
    ;(mockWindow as any).activeTextEditor = { document: { uri } }
    expect(currentUri()).toBe(uri)
  })
})

describe("currentAbapFile", () => {
  test("returns undefined when no active editor", () => {
    mockUriAbapFile.mockReturnValue(undefined)
    expect(currentAbapFile()).toBeUndefined()
  })

  test("returns abap file when adt editor active", () => {
    const uri = makeAdtUri()
    ;(mockWindow as any).activeTextEditor = { document: { uri } }
    const mockFile = { object: { type: "PROG/P" } } as any
    mockUriAbapFile.mockReturnValue(mockFile)
    expect(currentAbapFile()).toBe(mockFile)
  })
})

describe("currentEditState", () => {
  test("returns undefined when no active editor", () => {
    expect(currentEditState()).toBeUndefined()
  })

  test("returns undefined when editor is not adt scheme", () => {
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: { scheme: "file", path: "/test.ts" } },
      selection: { active: { line: 5 } }
    }
    expect(currentEditState()).toBeUndefined()
  })

  test("returns uri and line when adt editor active", () => {
    const uri = makeAdtUri()
    ;(mockWindow as any).activeTextEditor = {
      document: { uri },
      selection: { active: { line: 10 } }
    }
    const result = currentEditState()
    expect(result?.uri).toBe(uri)
    expect(result?.line).toBe(10)
  })
})

describe("openObject", () => {
  beforeEach(() => {
    ;(mockWindow.withProgress as jest.Mock).mockImplementation(async (_opts: any, fn: Function) =>
      fn()
    )
  })

  test("calls findByAdtUri on root", async () => {
    const mockFile = {}
    const mockRoot = {
      findByAdtUri: jest.fn().mockResolvedValue({ file: mockFile, path: "/ztest" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(false)

    await openObject("dev100", "/sap/bc/adt/programs/programs/ztest")

    expect(mockRoot.findByAdtUri).toHaveBeenCalledWith("/sap/bc/adt/programs/programs/ztest", true)
  })

  test("tries to refresh and re-find when object not found initially", async () => {
    const mockRoot = {
      findByAdtUri: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ file: {}, path: "/ztest" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(false)
    ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined)

    await openObject("dev100", "/sap/bc/adt/programs/programs/ztest")

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.files.action.refreshFilesExplorer"
    )
    expect(mockRoot.findByAdtUri).toHaveBeenCalledTimes(2)
  })

  test("reveals package in explorer when ABAP folder found", async () => {
    const { PACKAGE } = require("../adt/operations/AdtObjectCreator")
    const mockPackageFile = { object: { type: PACKAGE } }
    const mockRoot = {
      findByAdtUri: jest.fn().mockResolvedValue({ file: mockPackageFile, path: "/devc/test" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(true)
    ;(mockPackageFile as any).object.type = PACKAGE
    asMock(isAbapFile).mockReturnValue(false)
    const { createUri } = require("../adt/operations/AdtObjectFinder")
    ;(createUri as jest.Mock).mockReturnValue({ toString: () => "adt://dev100/test" })

    await openObject("dev100", "/sap/bc/adt/repository/packages/ztest")

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "revealInExplorer",
      expect.anything()
    )
  })

  test("throws when object still not found after refresh", async () => {
    const mockRoot = {
      findByAdtUri: jest.fn().mockResolvedValue(null)
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined)

    await expect(openObject("dev100", "/sap/bc/adt/programs/programs/nonexistent")).rejects.toThrow(
      "Object not found in workspace"
    )
  })

  test("opens text document for ABAP file", async () => {
    const mockAbapFile = { object: { type: "PROG/P" } }
    const mockRoot = {
      findByAdtUri: jest.fn().mockResolvedValue({ file: mockAbapFile, path: "/ztest" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(true)
    const { createUri } = require("../adt/operations/AdtObjectFinder")
    ;(createUri as jest.Mock).mockReturnValue({ toString: () => "adt://dev100/ztest" })
    const mockDoc = {}
    ;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc)
    ;(mockWindow.showTextDocument as jest.Mock).mockResolvedValue(undefined)

    await openObject("dev100", "/sap/bc/adt/programs/programs/ztest")

    expect(vscode.workspace.openTextDocument).toHaveBeenCalled()
    expect(mockWindow.showTextDocument).toHaveBeenCalledWith(mockDoc)
  })

  test("opens message class with custom editor", async () => {
    const mockAbapFile = { object: { type: "MSAG/N" } }
    const mockRoot = {
      findByAdtUri: jest.fn().mockResolvedValue({ file: mockAbapFile, path: "/msag/zmsag" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(true)
    const { createUri } = require("../adt/operations/AdtObjectFinder")
    ;(createUri as jest.Mock).mockReturnValue({ toString: () => "adt://dev100/msag/zmsag" })

    await openObject("dev100", "/sap/bc/adt/messageclass/zmsag", "MSAG/N")

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.anything(),
      "abapfs.msagn"
    )
  })
})
