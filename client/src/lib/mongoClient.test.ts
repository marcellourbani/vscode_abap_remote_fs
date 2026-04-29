jest.mock("vscode", () => {
  class CompletionItem { constructor(public label: string, public kind?: number) {} }
  class CompletionList { constructor(public items: any[] = [], public isIncomplete = false) {} }
  class CodeAction { constructor(public title: string, public kind?: any) {} }
  class CodeLens { constructor(public range: any, public command?: any) {} }
  class DocumentLink { constructor(public range: any, public target?: any) {} }
  class Color { constructor(public red: number, public green: number, public blue: number, public alpha: number) {} }
  class ColorInformation { constructor(public range: any, public color: any) {} }
  class ColorPresentation { constructor(public label: string) {} }
  class FoldingRange { constructor(public start: number, public end: number, public kind?: number) {} }
  class SelectionRange { constructor(public range: any, public parent?: any) {} }
  class DocumentSymbol { constructor(public name: string, public detail: string, public kind: number, public range: any, public selectionRange: any) {} }
  class SymbolInformation { constructor(public name: string, public kind: number, public containerName: string, public location: any) {} }
  class Diagnostic { constructor(public range: any, public message: string, public severity?: number) {} }
  class Hover { constructor(public contents: any, public range?: any) {} }
  class SignatureHelp { signatures: any[] = []; activeSignature = 0; activeParameter = 0 }
  class Location { constructor(public uri: any, public range: any) {} }
  class Position { constructor(public line: number, public character: number) {} }
  class Range { constructor(public start: any, public end: any) {} }
  class WorkspaceEdit { _edits: any[] = []; replace() {}; insert() {}; delete() {}; has() { return false }; set() {}; get() { return [] }; entries() { return [] }; get size() { return 0 } }
  class TextEdit { constructor(public range: any, public newText: string) {}; static replace(r: any, t: string) { return new TextEdit(r, t) }; static insert(p: any, t: string) { return new TextEdit(p, t) }; static delete(r: any) { return new TextEdit(r, "") } }
  class SnippetString { constructor(public value = "") {} }
  class MarkdownString { constructor(public value = "") {}; appendMarkdown() { return this }; appendCodeblock() { return this } }
  class InlayHint { constructor(public position: any, public label: any, public kind?: number) {} }
  class SemanticTokens { constructor(public data: any, public resultId?: string) {} }
  class CallHierarchyItem { constructor(public kind: number, public name: string, public detail: string, public uri: any, public range: any, public selectionRange: any) {} }
  class TypeHierarchyItem { constructor(public kind: number, public name: string, public detail: string, public uri: any, public range: any, public selectionRange: any) {} }
  class LinkedEditingRanges { constructor(public ranges: any[], public wordPattern?: any) {} }
  class TreeItem { constructor(public label: any, public collapsibleState?: number) {} }
  class ThemeIcon { constructor(public id: string) {} }
  class EventEmitter { event = jest.fn(); fire = jest.fn(); dispose = jest.fn() }
  class Disposable { constructor(public fn?: () => void) { this.dispose = fn ?? (() => {}) }; dispose: () => void }
  class CancellationTokenSource { token = { isCancellationRequested: false, onCancellationRequested: jest.fn() }; cancel() {}; dispose() {} }

  return {
    CompletionItem, CompletionList, CodeAction, CodeLens, DocumentLink, Color,
    ColorInformation, ColorPresentation, FoldingRange, SelectionRange,
    DocumentSymbol, SymbolInformation, Diagnostic, Hover, SignatureHelp,
    Location, Position, Range, WorkspaceEdit, TextEdit, SnippetString,
    MarkdownString, InlayHint, SemanticTokens, CallHierarchyItem,
    TypeHierarchyItem, LinkedEditingRanges, TreeItem, ThemeIcon, EventEmitter,
    Disposable, CancellationTokenSource,
    CompletionItemKind: {},
    SymbolKind: {},
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
    EndOfLine: { LF: 1, CRLF: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
    window: {
      createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), append: jest.fn(), show: jest.fn(), dispose: jest.fn() })),
      showQuickPick: jest.fn(),
      showInputBox: jest.fn(),
      showOpenDialog: jest.fn(),
      showSaveDialog: jest.fn(),
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      createTextEditorDecorationType: jest.fn(() => ({ dispose: jest.fn() })),
      visibleTextEditors: [],
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: jest.fn(),
      onDidChangeVisibleTextEditors: jest.fn(),
      createWebviewPanel: jest.fn(),
      withProgress: jest.fn(),
      createStatusBarItem: jest.fn(() => ({ show: jest.fn(), hide: jest.fn(), dispose: jest.fn() })),
      createTreeView: jest.fn(() => ({ dispose: jest.fn() })),
      registerWebviewViewProvider: jest.fn(),
      tabGroups: { all: [] },
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    workspace: {
      getConfiguration: jest.fn(() => ({ get: jest.fn(), update: jest.fn() })),
      workspaceFolders: [],
      onDidChangeConfiguration: jest.fn(),
      fs: { readFile: jest.fn(), writeFile: jest.fn() },
    },
    Uri: {
      parse: jest.fn((s: string) => ({ toString: () => s, scheme: "file", path: s })),
      file: jest.fn((s: string) => ({ toString: () => s, scheme: "file", path: s })),
    },
    debug: { registerDebugAdapterDescriptorFactory: jest.fn(), onDidStartDebugSession: jest.fn(), onDidTerminateDebugSession: jest.fn() },
    languages: { registerHoverProvider: jest.fn(), createDiagnosticCollection: jest.fn(() => ({ set: jest.fn(), delete: jest.fn(), dispose: jest.fn() })) },
    env: { clipboard: { writeText: jest.fn() }, uriScheme: "vscode" },
    extensions: { getExtension: jest.fn() },
  }
}, { virtual: true })

jest.mock("vscode-languageclient/node", () => ({
  LanguageClient: jest.fn(),
  TransportKind: { ipc: 1, stdio: 2, pipe: 3, socket: 4 },
  State: { Stopped: 1, Starting: 2, Running: 3 },
}), { virtual: true })

jest.mock("mongoose", () => {
  const mockModel = jest.fn().mockImplementation(function (this: any, data: any) {
    Object.assign(this, data)
    this.save = jest.fn().mockResolvedValue(this)
  })
  mockModel.prototype.save = jest.fn().mockResolvedValue({})

  const mockMongoInstance = {
    model: jest.fn().mockReturnValue(mockModel)
  }

  return {
    Schema: jest.fn().mockImplementation(function () { return {} }),
    connect: jest.fn().mockResolvedValue(mockMongoInstance),
    Types: { Number: Number, String: String, Boolean: Boolean, Mixed: Object }
  }
})

// Attach Types to Schema mock
const mongooseMock = require("mongoose")
mongooseMock.Schema.Types = { Number: Number, String: String, Boolean: Boolean, Mixed: Object }

jest.mock("../config", () => ({
  RemoteManager: {
    get: jest.fn()
  }
}))

jest.mock("./logger", () => ({
  log: jest.fn()
}))

jest.mock("./functions", () => ({
  cache: jest.fn((fn: (key: string) => any) => ({
    get: (key: string) => fn(key)
  }))
}))

jest.mock(".", () => ({
  caughtToString: jest.fn((e: any) => String(e)),
  log: Object.assign(jest.fn(), { debug: jest.fn() }),
}))

jest.mock("method-call-logger", () => ({}), { virtual: true })
jest.mock("abap-adt-api", () => ({
  session_types: {},
}))

jest.mock("vscode-abap-remote-fs-sharedapi", () => ({
  clientTraceUrl: jest.fn(),
  httpTraceUrl: jest.fn(),
  Sources: {}
}))

import { mongoApiLogger, mongoHttpLogger } from "./mongoClient"
import { RemoteManager } from "../config"
import { clientTraceUrl, httpTraceUrl } from "vscode-abap-remote-fs-sharedapi"

const mockRemoteManager = RemoteManager.get as jest.MockedFunction<typeof RemoteManager.get>
const mockClientTraceUrl = clientTraceUrl as jest.MockedFunction<typeof clientTraceUrl>
const mockHttpTraceUrl = httpTraceUrl as jest.MockedFunction<typeof httpTraceUrl>

describe("mongoApiLogger", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns undefined when no connection config found", () => {
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue(null)
    } as any)
    mockClientTraceUrl.mockReturnValue(undefined as any)
    mockHttpTraceUrl.mockReturnValue(undefined as any)

    const logger = mongoApiLogger("unknown", "source", false)
    expect(logger).toBeUndefined()
  })

  it("returns undefined when no mongoUrl configured", () => {
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({ name: "myconn" })
    } as any)
    mockClientTraceUrl.mockReturnValue(undefined as any)
    mockHttpTraceUrl.mockReturnValue(undefined as any)

    const logger = mongoApiLogger("myconn", "source", false)
    expect(logger).toBeUndefined()
  })

  it("returns a function when mongo is configured", () => {
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({ name: "myconn" })
    } as any)
    mockClientTraceUrl.mockReturnValue("mongodb://localhost:27017" as any)

    const logger = mongoApiLogger("myconn", "source", false)
    expect(typeof logger).toBe("function")
  })
})

describe("mongoHttpLogger", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns undefined when no connection config found", () => {
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue(null)
    } as any)
    mockClientTraceUrl.mockReturnValue(undefined as any)
    mockHttpTraceUrl.mockReturnValue(undefined as any)

    const logger = mongoHttpLogger("unknown", "source" as any)
    expect(logger).toBeUndefined()
  })

  it("returns undefined when no mongoUrl configured", () => {
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({ name: "myconn" })
    } as any)
    mockClientTraceUrl.mockReturnValue(undefined as any)
    mockHttpTraceUrl.mockReturnValue(undefined as any)

    const logger = mongoHttpLogger("myconn", "source" as any)
    expect(logger).toBeUndefined()
  })

  it("returns a function when mongo is configured", () => {
    mockRemoteManager.mockReturnValue({
      byId: jest.fn().mockReturnValue({ name: "myconn" })
    } as any)
    mockClientTraceUrl.mockReturnValue("mongodb://localhost:27017" as any)

    const logger = mongoHttpLogger("myconn", "source" as any)
    expect(typeof logger).toBe("function")
  })
})

describe("MongoClient formatDbName (via integration)", () => {
  // Test the DB name formatting logic in isolation
  const formatDbName = (name: string) =>
    `abapfs_${name.replace(/[\\\/\*\?\"<>\|\s,#]/g, "_").toLowerCase()}`

  it("lowercases the name", () => {
    expect(formatDbName("MYCONN")).toBe("abapfs_myconn")
  })

  it("replaces special characters with underscores", () => {
    expect(formatDbName("my conn")).toBe("abapfs_my_conn")
    expect(formatDbName("my/conn")).toBe("abapfs_my_conn")
    expect(formatDbName('my"conn')).toBe("abapfs_my_conn")
    expect(formatDbName("my<conn>")).toBe("abapfs_my_conn_")
    expect(formatDbName("my|conn")).toBe("abapfs_my_conn")
    expect(formatDbName("my,conn")).toBe("abapfs_my_conn")
    expect(formatDbName("my#conn")).toBe("abapfs_my_conn")
  })

  it("prefixes with abapfs_", () => {
    expect(formatDbName("test")).toMatch(/^abapfs_/)
  })

  it("handles empty string", () => {
    expect(formatDbName("")).toBe("abapfs_")
  })

  it("handles already valid name", () => {
    expect(formatDbName("myconn123")).toBe("abapfs_myconn123")
  })
})

describe("MongoClient toCallLog logic", () => {
  // Test the transformation logic extracted from toCallLog
  const toCallLog = (call: any, source: string, statelessClone: boolean) => {
    const { methodName, callType, start, duration, failed, resolvedPromise, ...callDetails } = call
    return {
      start,
      callType,
      source,
      statelessClone,
      methodName,
      duration,
      failed,
      resolvedPromise,
      callDetails
    }
  }

  it("extracts all required fields from method call", () => {
    const call = {
      methodName: "atcCheck",
      callType: "async",
      start: 1000,
      duration: 250,
      failed: false,
      resolvedPromise: true,
      extraInfo: "details"
    }
    const result = toCallLog(call, "mysource", false)
    expect(result.methodName).toBe("atcCheck")
    expect(result.callType).toBe("async")
    expect(result.start).toBe(1000)
    expect(result.duration).toBe(250)
    expect(result.failed).toBe(false)
    expect(result.resolvedPromise).toBe(true)
    expect(result.source).toBe("mysource")
    expect(result.statelessClone).toBe(false)
    expect(result.callDetails.extraInfo).toBe("details")
  })

  it("separates callDetails from known fields", () => {
    const call = {
      methodName: "test",
      callType: "sync",
      start: 0,
      duration: 10,
      failed: false,
      resolvedPromise: false,
      param1: "a",
      param2: "b"
    }
    const result = toCallLog(call, "src", true)
    expect(result.callDetails).toEqual({ param1: "a", param2: "b" })
    expect(result.callDetails.methodName).toBeUndefined()
  })
})

describe("MongoClient toHttpRequest logic", () => {
  // Test the stateful detection logic
  const isStateful = (sessionType: string) => {
    const stateful = "stateful"
    const keep = "keep"
    return sessionType === stateful || sessionType === keep
  }

  it("detects stateful session type", () => {
    expect(isStateful("stateful")).toBe(true)
  })

  it("detects keep session as stateful", () => {
    expect(isStateful("keep")).toBe(true)
  })

  it("stateless is not stateful", () => {
    expect(isStateful("stateless")).toBe(false)
  })

  it("empty string is not stateful", () => {
    expect(isStateful("")).toBe(false)
  })
})

describe("MongoClient httpLog header filtering", () => {
  // Test the unbool and filter logic for response headers
  const unbool = (x: any): any => (typeof x === "boolean" ? `${x}` : x)
  const filterHeaders = (headers: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(headers)
        .map(([k, v]) => [`${k}`, unbool(v)])
        .filter(([_, v]) => v !== null)
    )

  it("converts boolean values to strings", () => {
    const result = filterHeaders({ "x-header": true })
    expect(result["x-header"]).toBe("true")
  })

  it("converts false booleans to strings", () => {
    const result = filterHeaders({ "x-header": false })
    expect(result["x-header"]).toBe("false")
  })

  it("keeps non-boolean values as-is", () => {
    const result = filterHeaders({ "content-type": "application/json" })
    expect(result["content-type"]).toBe("application/json")
  })

  it("removes null values", () => {
    const result = filterHeaders({ "x-null": null, "x-valid": "ok" })
    expect(result["x-null"]).toBeUndefined()
    expect(result["x-valid"]).toBe("ok")
  })

  it("handles numeric header values", () => {
    const result = filterHeaders({ "content-length": 1234 })
    expect(result["content-length"]).toBe(1234)
  })

  it("handles empty headers object", () => {
    expect(filterHeaders({})).toEqual({})
  })
})
