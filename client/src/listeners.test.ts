// Tests for listeners.ts - focusing on the pure/exported functions
jest.mock("vscode", () => ({
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 },
  workspace: {
    textDocuments: [],
    onDidChangeTextDocument: jest.fn(),
    getConfiguration: jest.fn(() => ({ get: jest.fn() }))
  },
  window: {
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  },
  commands: { executeCommand: jest.fn() },
  Uri: {
    parse: jest.fn(s => ({ toString: () => s, scheme: "adt", authority: "host", path: "/file" }))
  },
  TabInputTextDiff: class {}
}), { virtual: true })

jest.mock("./lib", () => ({
  caughtToString: jest.fn(e => String(e)),
  debounce: jest.fn((delay: number, fn: Function) => fn),
  log: jest.fn(),
  viewableObjecttypes: []
}))
jest.mock("./adt/conections", () => ({
  ADTSCHEME: "adt",
  uriRoot: jest.fn(),
  abapUri: jest.fn(() => false),
  getRoot: jest.fn()
}))
jest.mock("abapobject", () => ({}))
jest.mock("abapfs", () => ({ isAbapStat: jest.fn() }))
jest.mock("abap-adt-api", () => ({ isCsrfError: jest.fn() }))
jest.mock("abapfs/out/lockObject", () => ({}))
jest.mock("./adt/operations/AdtObjectFinder", () => ({ uriAbapFile: jest.fn() }))
jest.mock("./scm/abaprevisions", () => ({ versionRevisions: jest.fn() }))
jest.mock("./context", () => ({ setContext: jest.fn() }))
jest.mock("./services/telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./fs/LocalFsProvider", () => ({ LocalFsProvider: { useLocalStorage: jest.fn(() => false) } }))
jest.mock("./langClient", () => ({ triggerSyntaxCheck: jest.fn() }))
jest.mock("./views/enhancementDecorations", () => ({ updateEnhancementDecorations: jest.fn() }))
jest.mock("./services/cleanerCommands", () => ({ updateCleanerContext: jest.fn() }))
jest.mock("./views/blameGutter", () => ({
  onBlameActiveEditorChanged: jest.fn(),
  onBlameDocumentChanged: jest.fn()
}))
jest.mock("abapfs/out/lockManager", () => ({ ReloginError: { isReloginError: jest.fn() } }))
jest.mock("./services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  }
}))

import { setSaveReason, getSaveReason, clearSaveReason, listenersubscribers, listener } from "./listeners"
import { TextDocumentSaveReason } from "vscode"

describe("listeners.ts - save reason tracking", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // clear any lingering state by round-tripping
    clearSaveReason("adt://host/test")
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
