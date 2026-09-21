vi.mock("vscode", () => {
  const Uri = {
    parse: vi.fn(function (s: string) {
      return {
        scheme: s.startsWith("adt") ? "adt" : "file",
        authority: s.split("://")[1]?.split("/")[0] ?? "",
        path: "/" + (s.split("://")[1]?.split("/").slice(1).join("/") ?? ""),
        toString: () => s
      }
    })
  }
  return {
    Uri,
    workspace: {
      openTextDocument: vi.fn(),
      updateWorkspaceFolders: vi.fn(),
      workspaceFolders: []
    },
    commands: {
      executeCommand: vi.fn()
    },
    ProgressLocation: { Notification: 15, Window: 10 },
    Range: vi.fn(class {}),
    FileChangeType: { Changed: 1 },
    extensions: {
      getExtension: vi.fn()
    },
    debug: {
      breakpoints: [],
      startDebugging: vi.fn()
    },
    SourceBreakpoint: class {}
  }
})

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showTextDocument: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    createOutputChannel: vi.fn()
  }
}))

vi.mock("../adt/conections", () => ({
  ADTSCHEME: "adt",
  getClient: vi.fn(),
  getRoot: vi.fn(),
  uriRoot: vi.fn(),
  getOrCreateRoot: vi.fn(),
  disconnect: vi.fn(),
  clearConnectionFailure: vi.fn()
}))

vi.mock("../config", () => ({
  pickAdtRoot: vi.fn(),
  RemoteManager: { get: vi.fn() }
}))

vi.mock("../lib", () => ({
  caughtToString: vi.fn(function (e: any) {
    return String(e)
  }),
  inputBox: vi.fn(),
  lineRange: vi.fn(),
  log: vi.fn(),
  rangeVscToApi: vi.fn(),
  splitAdtUri: vi.fn(),
  channel: { appendLine: vi.fn() }
}))

vi.mock("../views/favourites", () => ({
  FavouritesProvider: { get: vi.fn() },
  FavItem: vi.fn(class {})
}))

vi.mock("../langClient", () => ({
  findEditor: vi.fn(),
  vsCodeUri: vi.fn()
}))

vi.mock("../listeners", () => ({
  showHideActivate: vi.fn()
}))

vi.mock("../adt/operations/UnitTestRunner", () => ({
  UnitTestRunner: { get: vi.fn().mockReturnValue({ controller: {} }) }
}))

vi.mock("../adt/AdtTransports", () => ({
  selectTransport: vi.fn()
}))

vi.mock("../adt/sapgui/sapgui", () => ({
  showInGuiCb: vi.fn(),
  executeInGui: vi.fn(),
  runInSapGui: vi.fn(),
  SapGui: { create: vi.fn() }
}))

vi.mock("../oauth", () => ({
  storeTokens: vi.fn(),
  clearTokens: vi.fn()
}))

vi.mock("../views/help", () => ({
  showAbapDoc: vi.fn()
}))

vi.mock("../views/query/query", () => ({
  showQuery: vi.fn()
}))

vi.mock("abapfs", () => ({
  isAbapFolder: vi.fn(),
  isAbapFile: vi.fn(),
  isAbapStat: vi.fn()
}))

vi.mock("../adt/operations/AdtObjectActivator", () => ({
  AdtObjectActivator: { get: vi.fn() }
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn(class {}),
  createUri: vi.fn(),
  findAbapObject: vi.fn(),
  uriAbapFile: vi.fn()
}))

vi.mock("abapobject", async () => ({
  ...(await vi.importActual("abapobject")),
  isAbapClassInclude: vi.fn()
}))

vi.mock("../adt/includes", () => ({
  IncludeProvider: { get: vi.fn() }
}))

vi.mock("./", () => ({
  command: () => (_target: any, _key: string, descriptor: PropertyDescriptor) => descriptor,
  AbapFsCommands: {
    connect: "abapfs.connect",
    changePassword: "abapfs.changePassword",
    connectionManager: "abapfs.connectionManager"
  }
}))

vi.mock("./connectionwizard", () => ({
  createConnection: vi.fn()
}))

vi.mock("../configuration/sapConnectionManager", () => ({
  openConnectionManager: vi.fn()
}))

vi.mock("../extension", () => ({
  context: { subscriptions: [], extensionPath: "/fake" }
}))

vi.mock("../views/abaptestcockpit", () => ({
  atcProvider: { get: vi.fn() }
}))

vi.mock("../fs/FsProvider", () => ({
  FsProvider: { get: vi.fn() }
}))

vi.mock("../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

vi.mock("../adt/debugger/abapDebugSession", () => ({
  AbapDebugSession: { byConnection: vi.fn() }
}))

vi.mock("../adt/operations/AdtObjectCreator", () => ({
  PACKAGE: "DEVC/K",
  AdtObjectCreator: vi.fn(class {})
}))

vi.mock("abap-adt-api", () => ({
  CreatableTypeIds: {},
  PackageTypes: {},
  CreatableTypes: {}
}))

vi.mock("../views/sapgui/SapGuiPanel", () => ({
  SapGuiPanel: { createOrShow: vi.fn() }
}))

vi.mock("../services/sapSystemInfo", () => ({
  clearSystemInfoCache: vi.fn()
}))

import { currentUri, currentAbapFile, currentEditState, openObject, AdtCommands } from "./commands"
import { funWindow as window } from "../services/funMessenger"
import { ADTSCHEME, getRoot } from "../adt/conections"
import { RemoteManager } from "../config"
import { uriAbapFile } from "../adt/operations/AdtObjectFinder"
import { isAbapFolder, isAbapFile } from "abapfs"

// Helper to cast type-guard mocks
const asMock = (fn: any): Mock => fn as Mock
import * as vscode from "vscode"
import * as __$mock_adt_conections from "../adt/conections"
import * as __$mock_adt_operations_AdtObjectCreator from "../adt/operations/AdtObjectCreator"
import * as __$mock_adt_operations_AdtObjectFinder from "../adt/operations/AdtObjectFinder"
import type { Mock, Mocked, MockedFunction } from "vitest"

const mockWindow = window as Mocked<typeof window>
const mockGetRoot = getRoot as MockedFunction<typeof getRoot>
const mockUriAbapFile = uriAbapFile as MockedFunction<typeof uriAbapFile>

function makeAdtUri(authority = "dev100", path = "/sap/bc/adt/programs/programs/ztest") {
  return { scheme: "adt", authority, path, toString: () => `adt://${authority}${path}` } as any
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe("connectAdtServer", () => {
  test("offers username and password actions for authentication failures", async () => {
    const { getOrCreateRoot } = __$mock_adt_conections
    const mockManager = {
      selectConnection: vi.fn().mockResolvedValue({
        remote: { name: "dev100", username: "developer" },
        userCancel: false
      })
    }
    ;(RemoteManager.get as Mock).mockReturnValue(mockManager)
    vi.mocked(getOrCreateRoot).mockRejectedValue(new Error("Request failed with status code 401"))
    mockWindow.showErrorMessage.mockResolvedValue("Change Password" as any)

    await (AdtCommands as any).connectAdtServer({})

    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      'Authentication failed for "dev100" (username: developer). Check your username and password.',
      "Change Username",
      "Change Password"
    )
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("abapfs.changePassword", {
      connection: "dev100"
    })
  })

  test("opens Connection Manager when the username action is selected", async () => {
    const { getOrCreateRoot } = __$mock_adt_conections
    const mockManager = {
      selectConnection: vi.fn().mockResolvedValue({
        remote: { name: "dev100", username: "developer" },
        userCancel: false
      })
    }
    ;(RemoteManager.get as Mock).mockReturnValue(mockManager)
    vi.mocked(getOrCreateRoot).mockRejectedValue(new Error("Request failed with status code 401"))
    mockWindow.showErrorMessage.mockResolvedValue("Change Username" as any)

    await (AdtCommands as any).connectAdtServer({})

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("abapfs.connectionManager")
  })

  test("offers to connect after changing the password", async () => {
    const mockManager = {
      selectConnection: vi.fn().mockResolvedValue({
        remote: { name: "dev100", username: "developer" },
        userCancel: false
      }),
      clearPassword: vi.fn().mockResolvedValue(true),
      savePassword: vi.fn().mockResolvedValue(true)
    }
    ;(RemoteManager.get as Mock).mockReturnValue(mockManager)
    mockWindow.showInputBox.mockResolvedValue("new-password")
    mockWindow.showQuickPick.mockResolvedValue("Yes" as any)

    await (AdtCommands as any).changePasswordCmd()

    expect(mockWindow.showQuickPick).toHaveBeenCalledWith(["Yes", "No"], {
      title: "Password updated",
      placeHolder: 'Connect to system "dev100" now?'
    })
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("abapfs.connect", {
      connection: "dev100"
    })
  })
})

describe("createAdtObjectProgrammatically", () => {
  test("requires a parent function group when creating function modules", async () => {
    const result = await AdtCommands.createAdtObjectProgrammatically(
      "FUGR/FF" as any,
      "Z_TEST_FUNCTION",
      "Test function module",
      "$TMP",
      undefined,
      "dev100"
    )

    const { AdtObjectCreator } = __$mock_adt_operations_AdtObjectCreator

    expect(result).toEqual({
      success: false,
      error: "MISSING_FUNCTION_GROUP_PARENT",
      message: "Function module creation requires parentName with the parent function group name.",
      objectName: "Z_TEST_FUNCTION",
      objectType: "FUGR/FF"
    })
    expect(AdtObjectCreator).not.toHaveBeenCalled()
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
    ;(mockWindow.withProgress as Mock).mockImplementation(function (_opts: any, fn: Function) {
      return fn()
    })
  })

  test("calls findByAdtUri on root", async () => {
    const mockFile = {}
    const mockRoot = {
      findByAdtUri: vi.fn().mockResolvedValue({ file: mockFile, path: "/ztest" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(false)

    await openObject("dev100", "/sap/bc/adt/programs/programs/ztest")

    expect(mockRoot.findByAdtUri).toHaveBeenCalledWith("/sap/bc/adt/programs/programs/ztest", true)
  })

  test("tries to refresh and re-find when object not found initially", async () => {
    const mockRoot = {
      findByAdtUri: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ file: {}, path: "/ztest" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(false)
    ;(vscode.commands.executeCommand as Mock).mockResolvedValue(undefined)

    await openObject("dev100", "/sap/bc/adt/programs/programs/ztest")

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.files.action.refreshFilesExplorer"
    )
    expect(mockRoot.findByAdtUri).toHaveBeenCalledTimes(2)
  })

  test("reveals package in explorer when ABAP folder found", async () => {
    const { PACKAGE } = __$mock_adt_operations_AdtObjectCreator
    const mockPackageFile = { object: { type: PACKAGE } }
    const mockRoot = {
      findByAdtUri: vi.fn().mockResolvedValue({ file: mockPackageFile, path: "/devc/test" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(true)
    ;(mockPackageFile as any).object.type = PACKAGE
    asMock(isAbapFile).mockReturnValue(false)
    const { createUri } = __$mock_adt_operations_AdtObjectFinder
    ;(createUri as Mock).mockReturnValue({ toString: () => "adt://dev100/test" })

    await openObject("dev100", "/sap/bc/adt/repository/packages/ztest")

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "revealInExplorer",
      expect.anything()
    )
  })

  test("throws when object still not found after refresh", async () => {
    const mockRoot = {
      findByAdtUri: vi.fn().mockResolvedValue(null)
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    ;(vscode.commands.executeCommand as Mock).mockResolvedValue(undefined)

    await expect(openObject("dev100", "/sap/bc/adt/programs/programs/nonexistent")).rejects.toThrow(
      "Object not found in workspace"
    )
  })

  test("opens text document for ABAP file", async () => {
    const mockAbapFile = { object: { type: "PROG/P" } }
    const mockRoot = {
      findByAdtUri: vi.fn().mockResolvedValue({ file: mockAbapFile, path: "/ztest" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(true)
    const { createUri } = __$mock_adt_operations_AdtObjectFinder
    ;(createUri as Mock).mockReturnValue({ toString: () => "adt://dev100/ztest" })
    const mockDoc = {}
    ;(vscode.workspace.openTextDocument as Mock).mockResolvedValue(mockDoc)
    ;(mockWindow.showTextDocument as Mock).mockResolvedValue(undefined)

    await openObject("dev100", "/sap/bc/adt/programs/programs/ztest")

    expect(vscode.workspace.openTextDocument).toHaveBeenCalled()
    expect(mockWindow.showTextDocument).toHaveBeenCalledWith(mockDoc)
  })

  test("opens message class with custom editor", async () => {
    const mockAbapFile = { object: { type: "MSAG/N" } }
    const mockRoot = {
      findByAdtUri: vi.fn().mockResolvedValue({ file: mockAbapFile, path: "/msag/zmsag" })
    }
    mockGetRoot.mockReturnValue(mockRoot as any)
    asMock(isAbapFolder).mockReturnValue(false)
    asMock(isAbapFile).mockReturnValue(true)
    const { createUri } = __$mock_adt_operations_AdtObjectFinder
    ;(createUri as Mock).mockReturnValue({ toString: () => "adt://dev100/msag/zmsag" })

    await openObject("dev100", "/sap/bc/adt/messageclass/zmsag", "MSAG/N")

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.anything(),
      "abapfs.msagn"
    )
  })
})
