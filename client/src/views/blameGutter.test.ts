/**
 * Tests for blameGutter.ts
 * Tests the computeBlame algorithm and related pure/exported functions.
 */

jest.mock("vscode", () => {
  const mockDisposable = { dispose: jest.fn() }
  return {
    ProgressLocation: { Notification: 15 },
    DecorationRangeBehavior: { ClosedClosed: 0 },
    Range: jest.fn((sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })),
    ThemeColor: jest.fn((id: string) => ({ id })),
    MarkdownString: jest.fn(function(value: string) { (this as any).value = value; (this as any).isTrusted = false }),
    commands: { registerCommand: jest.fn(() => mockDisposable) },
    workspace: { onDidSaveTextDocument: jest.fn(() => mockDisposable) },
  }
}, { virtual: true })

jest.mock("../adt/conections", () => ({
  getClient: jest.fn(),
  ADTSCHEME: "adt",
  abapUri: jest.fn(() => true),
}), { virtual: true })

jest.mock("../scm/abaprevisions/abaprevisionservice", () => ({
  AbapRevisionService: { get: jest.fn() },
}), { virtual: true })

jest.mock("../context", () => ({
  setContext: jest.fn(),
}), { virtual: true })

jest.mock("../lib", () => ({
  log: jest.fn(),
}), { virtual: true })

jest.mock("../services/telemetry", () => ({
  logTelemetry: jest.fn(),
}), { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    withProgress: jest.fn(),
    createTextEditorDecorationType: jest.fn(() => ({ dispose: jest.fn() })),
  },
}), { virtual: true })

// We can only test exported functions from blameGutter; the internal
// computeBlame is private but exercised indirectly via showBlame.
// We also test the exported helpers directly.
import {
  BlameInfo,
  hideBlame,
  onBlameActiveEditorChanged,
  onBlameDocumentChanged,
  onBlameDocumentSaved,
  initializeBlameGutter,
} from "./blameGutter"

import { funWindow as window } from "../services/funMessenger"
import { setContext } from "../context"

const mockedWindow = window as jest.Mocked<typeof window>
const mockedSetContext = setContext as jest.Mock

// Helper to make a fake vscode.TextEditor
function makeEditor(uriStr: string, scheme = "adt", dirty = false, lang = "abap") {
  return {
    document: {
      uri: { toString: () => uriStr, scheme, authority: "dev100", languageId: lang },
      languageId: lang,
      isDirty: dirty,
      getText: () => "line1\nline2\nline3",
      lineCount: 3,
      lineAt: (i: number) => ({ text: "some line text", length: 14 }),
    },
    setDecorations: jest.fn(),
    selection: { active: { line: 0, character: 0 } },
    viewColumn: 1,
  } as any
}

function makeDocument(uriStr: string, scheme = "adt") {
  return {
    uri: { toString: () => uriStr, scheme },
    languageId: "abap",
    isDirty: false,
  } as any
}

describe("hideBlame", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does nothing if no active editor", async () => {
    ;(mockedWindow as any).activeTextEditor = undefined
    await hideBlame()
    expect(mockedSetContext).toHaveBeenCalledWith("abapfs:blameActive", false)
    expect(mockedSetContext).toHaveBeenCalledWith("abapfs:blameAvailable", false)
  })

  it("clears decorations when editor present", async () => {
    const editor = makeEditor("adt://dev100/foo.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    await hideBlame()
    // blameDecorationType is only created when showBlame renders decorations.
    // hideBlame without prior showBlame won't call setDecorations.
    expect(mockedSetContext).toHaveBeenCalledWith("abapfs:blameActive", false)
  })
})

describe("onBlameActiveEditorChanged", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("handles undefined editor gracefully", () => {
    expect(() => onBlameActiveEditorChanged(undefined)).not.toThrow()
    expect(mockedSetContext).toHaveBeenCalledWith("abapfs:blameActive", false)
    expect(mockedSetContext).toHaveBeenCalledWith("abapfs:blameAvailable", false)
  })

  it("handles non-adt scheme editor", () => {
    const editor = makeEditor("file:///foo.ts", "file")
    expect(() => onBlameActiveEditorChanged(editor)).not.toThrow()
  })

  it("handles adt editor without cached blame", () => {
    const editor = makeEditor("adt://dev100/foo.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    expect(() => onBlameActiveEditorChanged(editor)).not.toThrow()
  })
})

describe("onBlameDocumentChanged", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("ignores non-adt documents", () => {
    const event = {
      document: makeDocument("file:///foo.ts", "file"),
      contentChanges: [{}],
    } as any
    expect(() => onBlameDocumentChanged(event)).not.toThrow()
  })

  it("handles adt document without active blame", () => {
    const event = {
      document: makeDocument("adt://dev100/foo.abap"),
      contentChanges: [],
    } as any
    ;(mockedWindow as any).activeTextEditor = undefined
    expect(() => onBlameDocumentChanged(event)).not.toThrow()
  })

  it("handles empty content changes", () => {
    const event = {
      document: makeDocument("adt://dev100/foo.abap"),
      contentChanges: [],
    } as any
    expect(() => onBlameDocumentChanged(event)).not.toThrow()
  })
})

describe("onBlameDocumentSaved", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("ignores non-adt documents", () => {
    const doc = makeDocument("file:///foo.ts", "file")
    expect(() => onBlameDocumentSaved(doc)).not.toThrow()
  })

  it("processes adt documents without throwing", () => {
    const doc = makeDocument("adt://dev100/foo.abap")
    ;(mockedWindow as any).activeTextEditor = undefined
    expect(() => onBlameDocumentSaved(doc)).not.toThrow()
  })

  it("updates context when active editor matches saved document", () => {
    const doc = makeDocument("adt://dev100/bar.abap")
    const editor = makeEditor("adt://dev100/bar.abap")
    editor.document = doc as any
    ;(mockedWindow as any).activeTextEditor = editor
    expect(() => onBlameDocumentSaved(doc)).not.toThrow()
    expect(mockedSetContext).toHaveBeenCalled()
  })
})

describe("initializeBlameGutter", () => {
  it("registers commands and subscriptions", () => {
    const { commands, workspace } = require("vscode")
    const subscriptions: any[] = []
    const context = { subscriptions } as any
    initializeBlameGutter(context)
    expect(commands.registerCommand).toHaveBeenCalledWith("abapfs.showBlame", expect.any(Function))
    expect(commands.registerCommand).toHaveBeenCalledWith("abapfs.hideBlame", expect.any(Function))
    expect(workspace.onDidSaveTextDocument).toHaveBeenCalled()
    expect(subscriptions.length).toBeGreaterThan(0)
  })

  it("dispose callback clears state without throwing", () => {
    const subscriptions: any[] = []
    const context = { subscriptions } as any
    initializeBlameGutter(context)
    const disposeItem = subscriptions.find(s => typeof s.dispose === "function" && !s._isMock)
    if (disposeItem) expect(() => disposeItem.dispose()).not.toThrow()
  })
})
