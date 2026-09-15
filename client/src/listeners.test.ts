// Tests for listeners.ts - focusing on the pure/exported functions
vi.mock("vscode", () => ({
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
  workspace: {
    textDocuments: [],
    onDidChangeTextDocument: vi.fn(),
    getConfiguration: vi.fn(function () {
      return { get: vi.fn() }
    })
  },
  window: {
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  },
  commands: { executeCommand: vi.fn() },
  Uri: {
    parse: vi.fn(function (s) {
      return { toString: () => s, scheme: "adt", authority: "host", path: "/file" }
    })
  },
  TabInputTextDiff: class {}
}))

vi.mock("./lib", () => ({
  caughtToString: vi.fn(function (e) {
    return String(e)
  }),
  debounce: vi.fn(function (delay: number, fn: Function) {
    return fn
  }),
  log: vi.fn(),
  viewableObjecttypes: []
}))
vi.mock("./adt/conections", () => ({
  ADTSCHEME: "adt",
  uriRoot: vi.fn(),
  abapUri: vi.fn(function () {
    return false
  }),
  getRoot: vi.fn()
}))
vi.mock("abapobject", () => vi.importActual("abapobject"))
vi.mock("abapfs", () => ({ isAbapStat: vi.fn() }))
vi.mock("abap-adt-api", () => ({ isCsrfError: vi.fn() }))
vi.mock("abapfs/src/lockObject", () => ({}))
vi.mock("./adt/operations/AdtObjectFinder", () => ({ uriAbapFile: vi.fn() }))
vi.mock("./scm/abaprevisions", () => ({ versionRevisions: vi.fn() }))
vi.mock("./context", () => ({ setContext: vi.fn() }))
vi.mock("./services/telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./fs/LocalFsProvider", () => ({
  LocalFsProvider: {
    useLocalStorage: vi.fn(function () {
      return false
    })
  }
}))
vi.mock("./langClient", () => ({ triggerSyntaxCheck: vi.fn() }))
vi.mock("./views/enhancementDecorations", () => ({ updateEnhancementDecorations: vi.fn() }))
vi.mock("./services/cleanerCommands", () => ({ updateCleanerContext: vi.fn() }))
vi.mock("./views/blameGutter", () => ({
  onBlameActiveEditorChanged: vi.fn(),
  onBlameDocumentChanged: vi.fn()
}))
vi.mock("abapfs/src/lockManager", () => ({ ReloginError: { isReloginError: vi.fn() } }))
vi.mock("./services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  }
}))

import {
  setSaveReason,
  getSaveReason,
  clearSaveReason,
  listenersubscribers,
  listener
} from "./listeners"
import { TextDocumentSaveReason } from "vscode"

describe("listeners.ts - save reason tracking", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // clear any lingering state by round-tripping
    clearSaveReason("adt://host/test")
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe("setSaveReason / getSaveReason", () => {
    it("stores and retrieves a save reason", () => {
      setSaveReason("adt://host/file", TextDocumentSaveReason.Manual)
      expect(getSaveReason("adt://host/file")).toBe(TextDocumentSaveReason.Manual)
    })

    it("returns undefined for unknown uri", () => {
      expect(getSaveReason("adt://host/nonexistent")).toBeUndefined()
    })

    it("stores AfterDelay reason", () => {
      setSaveReason("adt://host/file2", TextDocumentSaveReason.AfterDelay)
      expect(getSaveReason("adt://host/file2")).toBe(TextDocumentSaveReason.AfterDelay)
    })

    it("overwrites previously stored reason", () => {
      setSaveReason("adt://host/file3", TextDocumentSaveReason.AfterDelay)
      setSaveReason("adt://host/file3", TextDocumentSaveReason.Manual)
      expect(getSaveReason("adt://host/file3")).toBe(TextDocumentSaveReason.Manual)
    })
  })

  describe("clearSaveReason", () => {
    it("removes the stored reason", () => {
      setSaveReason("adt://host/todelete", TextDocumentSaveReason.Manual)
      clearSaveReason("adt://host/todelete")
      expect(getSaveReason("adt://host/todelete")).toBeUndefined()
    })

    it("is a no-op for unknown uri", () => {
      expect(() => clearSaveReason("adt://host/doesnotexist")).not.toThrow()
    })
  })

  describe("listenersubscribers array", () => {
    it("is an array", () => {
      expect(Array.isArray(listenersubscribers)).toBe(true)
    })
  })
})
