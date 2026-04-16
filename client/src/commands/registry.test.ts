// Mock vscode-languageclient BEFORE anything else to prevent deep import chain failures
jest.mock("vscode-languageclient/node", () => ({
  LanguageClient: jest.fn(),
  TransportKind: { ipc: 1 },
  State: { Running: 1, Stopped: 2 }
}), { virtual: true })

jest.mock("vscode", () => ({
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() }))
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(), show: jest.fn(), clear: jest.fn(), dispose: jest.fn(),
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), trace: jest.fn()
    })),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showOpenDialog: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    createStatusBarItem: jest.fn(() => ({ show: jest.fn(), hide: jest.fn(), dispose: jest.fn() })),
    withProgress: jest.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    onDidChangeActiveTextEditor: jest.fn(),
    createWebviewPanel: jest.fn(() => ({ webview: { html: "", onDidReceiveMessage: jest.fn() }, dispose: jest.fn(), onDidDispose: jest.fn() }))
  },
  workspace: {
    getConfiguration: jest.fn(() => ({ get: jest.fn(), update: jest.fn() })),
    workspaceFolders: [],
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
    fs: { stat: jest.fn(), createDirectory: jest.fn(), writeFile: jest.fn(), readFile: jest.fn(), readDirectory: jest.fn() },
    openTextDocument: jest.fn(),
    registerFileSystemProvider: jest.fn(),
    registerTextDocumentContentProvider: jest.fn()
  },
  Uri: {
    parse: jest.fn((s: string) => ({ toString: () => s, authority: "", path: s, scheme: "file", with: jest.fn() })),
    file: jest.fn((s: string) => ({ toString: () => s, fsPath: s, scheme: "file" })),
    joinPath: jest.fn((...args: any[]) => ({ fsPath: args.map((a: any) => a.fsPath || a).join("/") }))
  },
  EventEmitter: jest.fn(() => ({ event: jest.fn(), fire: jest.fn() })),
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Active: -1 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  WorkspaceEdit: class { insert = jest.fn(); replace = jest.fn() },
  MarkdownString: class { constructor(public value = "") {} },
  ThemeIcon: class { constructor(public id: string) {} },
  Range: class { constructor(public start: any, public end: any) {} },
  Position: class { constructor(public line: number, public character: number) {} },
  Selection: class { constructor(public anchor: any, public active: any) {} },
  CodeLens: class { constructor(public range: any, public command?: any) {} },
  FileType: { File: 1, Directory: 2 },
  FileSystemError: { FileNotFound: jest.fn(), Unavailable: jest.fn() },
  debug: { activeDebugSession: undefined, startDebugging: jest.fn(), stopDebugging: jest.fn(), onDidStartDebugSession: jest.fn(), onDidTerminateDebugSession: jest.fn(), registerDebugAdapterDescriptorFactory: jest.fn(), registerDebugConfigurationProvider: jest.fn() },
  languages: { registerCodeLensProvider: jest.fn(), registerHoverProvider: jest.fn(), createDiagnosticCollection: jest.fn() },
  Disposable: class { constructor(public callOnDispose: () => void) {} static from(...d: any[]) { return { dispose: jest.fn() } } },
  CancellationTokenSource: class { token = { isCancellationRequested: false }; cancel = jest.fn(); dispose = jest.fn() },
  env: { clipboard: { writeText: jest.fn() }, openExternal: jest.fn(), uriScheme: "vscode" },
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
  extensions: { getExtension: jest.fn() },
  notebooks: { registerNotebookCellStatusBarItemProvider: jest.fn(), createNotebookController: jest.fn() },
  tests: { createTestController: jest.fn(() => ({ createRunProfile: jest.fn(), items: { add: jest.fn() }, dispose: jest.fn() })) },
  scm: { createSourceControl: jest.fn(() => ({ inputBox: {}, createResourceGroup: jest.fn(() => ({ resourceStates: [] })), dispose: jest.fn() })) },
  authentication: { getSession: jest.fn(), onDidChangeSessions: jest.fn() }
}), { virtual: true })

// Mock the heavy intermediate modules to break the deep import chain
jest.mock("./createObjectInEditor", () => ({
  createObjectInEditorCommand: jest.fn()
}))
jest.mock("./commands", () => ({
  openObject: jest.fn(),
  deleteObject: jest.fn()
}))

jest.mock("./configureFeeds", () => ({
  configureFeedsCommand: jest.fn()
}))

jest.mock("./textElementsCommands", () => ({
  manageTextElementsCommand: jest.fn()
}))

import { AbapFsCommands } from "./registry"

describe("AbapFsCommands", () => {
  test("all command keys have string values", () => {
    for (const [key, value] of Object.entries(AbapFsCommands)) {
      expect(typeof value).toBe("string")
      expect(value.length).toBeGreaterThan(0)
    }
  })

  test("all command values start with abapfs.", () => {
    for (const value of Object.values(AbapFsCommands)) {
      expect(value).toMatch(/^abapfs[.:]/)
    }
  })

  test("core commands have correct values", () => {
    expect(AbapFsCommands.connect).toBe("abapfs.connect")
    expect(AbapFsCommands.disconnect).toBe("abapfs.disconnect")
    expect(AbapFsCommands.activate).toBe("abapfs.activate")
    expect(AbapFsCommands.search).toBe("abapfs.search")
    expect(AbapFsCommands.create).toBe("abapfs.create")
    expect(AbapFsCommands.execute).toBe("abapfs.execute")
    expect(AbapFsCommands.unittest).toBe("abapfs.unittest")
  })

  test("GUI commands have correct values", () => {
    expect(AbapFsCommands.runInGui).toBe("abapfs.runInGui")
    expect(AbapFsCommands.runInEmbeddedGui).toBe("abapfs.runInEmbeddedGui")
    expect(AbapFsCommands.runTransaction).toBe("abapfs.runTransaction")
  })

  test("ATC commands have correct values", () => {
    expect(AbapFsCommands.atcChecks).toBe("abapfs.atcChecks")
    expect(AbapFsCommands.atcIgnore).toBe("abapfs.atcIgnore")
    expect(AbapFsCommands.atcRefresh).toBe("abapfs.atcRefresh")
    expect(AbapFsCommands.atcRequestExemption).toBe("abapfs.atcRequestExemption")
    expect(AbapFsCommands.atcRequestExemptionAll).toBe("abapfs.atcRequestExemptionAll")
    expect(AbapFsCommands.atcAutoRefreshOn).toBe("abapfs.atcAutoRefreshOn")
    expect(AbapFsCommands.atcAutoRefreshOff).toBe("abapfs.atcAutoRefreshOff")
  })

  test("transport commands have correct values", () => {
    expect(AbapFsCommands.releaseTransport).toBe("abapfs.releaseTransport")
    expect(AbapFsCommands.deleteTransport).toBe("abapfs.deleteTransport")
    expect(AbapFsCommands.refreshtransports).toBe("abapfs.refreshtransports")
    expect(AbapFsCommands.transportObjectDiff).toBe("abapfs.transportObjectDiff")
    expect(AbapFsCommands.openTransportObject).toBe("abapfs.openTransportObject")
  })

  test("abapgit commands have correct values", () => {
    expect(AbapFsCommands.agitRefreshRepos).toBe("abapfs.refreshrepos")
    expect(AbapFsCommands.agitPull).toBe("abapfs.pullRepo")
    expect(AbapFsCommands.agitCreate).toBe("abapfs.createRepo")
    expect(AbapFsCommands.agitPush).toBe("abapfs.pushAbapGit")
  })

  test("feed commands have correct values", () => {
    expect(AbapFsCommands.configureFeeds).toBe("abapfs.configureFeeds")
    expect(AbapFsCommands.refreshFeedInbox).toBe("abapfs.refreshFeedInbox")
    expect(AbapFsCommands.viewFeedEntry).toBe("abapfs.viewFeedEntry")
    expect(AbapFsCommands.markAllFeedsRead).toBe("abapfs.markAllFeedsRead")
    expect(AbapFsCommands.markFeedFolderRead).toBe("abapfs.markFeedFolderRead")
    expect(AbapFsCommands.deleteFeedEntry).toBe("abapfs.deleteFeedEntry")
    expect(AbapFsCommands.clearFeedFolder).toBe("abapfs.clearFeedFolder")
    expect(AbapFsCommands.showFeedInbox).toBe("abapfs.showFeedInbox")
  })

  test("blame commands have correct values", () => {
    expect(AbapFsCommands.showBlame).toBe("abapfs.showBlame")
    expect(AbapFsCommands.hideBlame).toBe("abapfs.hideBlame")
  })

  test("text elements command has correct value", () => {
    expect(AbapFsCommands.manageTextElements).toBe("abapfs.manageTextElements")
  })

  test("revision commands have correct values", () => {
    expect(AbapFsCommands.opendiff).toBe("abapfs.opendiff")
    expect(AbapFsCommands.opendiffNormalized).toBe("abapfs.opendiffNormalized")
    expect(AbapFsCommands.openrevstate).toBe("abapfs.openrevstate")
    expect(AbapFsCommands.remotediff).toBe("abapfs.remotediff")
    expect(AbapFsCommands.comparediff).toBe("abapfs.comparediff")
  })

  test("all command ids are unique", () => {
    const values = Object.values(AbapFsCommands)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  test("cleaner commands have correct values", () => {
    expect(AbapFsCommands.cleanCode).toBe("abapfs.cleanCode")
    expect(AbapFsCommands.setupCleaner).toBe("abapfs.setupCleaner")
  })

  test("changeInclude uses colon separator", () => {
    expect(AbapFsCommands.changeInclude).toBe("abapfs:changeInclude")
  })
})
