/**
 * Tests for blameGutter.ts
 * Covers blame lifecycle handlers and configuration-driven rendering.
 */

jest.mock(
  "vscode",
  () => {
    const mockDisposable = { dispose: jest.fn() }
    return {
      ProgressLocation: { Notification: 15 },
      OverviewRulerLane: { Right: 4 },
      DecorationRangeBehavior: { ClosedClosed: 0, OpenOpen: 1 },
      Range: jest.fn((sl: number, sc: number, el: number, ec: number) => ({
        start: { line: sl, character: sc },
        end: { line: el, character: ec }
      })),
      ThemeColor: jest.fn((id: string) => ({ id })),
      MarkdownString: jest.fn(function (value: string) {
        ;(this as any).value = value
        ;(this as any).isTrusted = false
      }),
      commands: { registerCommand: jest.fn(() => mockDisposable) },
      workspace: {
        getConfiguration: jest.fn(() => ({ get: jest.fn((_: string, fallback: unknown) => fallback) })),
        onDidSaveTextDocument: jest.fn(() => mockDisposable),
        onDidChangeConfiguration: jest.fn(() => mockDisposable)
      }
    }
  },
  { virtual: true }
)

jest.mock(
  "../adt/conections",
  () => ({
    getClient: jest.fn(),
    ADTSCHEME: "adt",
    abapUri: jest.fn(() => true)
  }),
  { virtual: true }
)

jest.mock(
  "../scm/abaprevisions/abaprevisionservice",
  () => ({
    AbapRevisionService: { get: jest.fn() }
  }),
  { virtual: true }
)

jest.mock(
  "../context",
  () => ({
    setContext: jest.fn()
  }),
  { virtual: true }
)

jest.mock(
  "../lib",
  () => ({
    log: jest.fn()
  }),
  { virtual: true }
)

jest.mock(
  "../services/telemetry",
  () => ({
    logTelemetry: jest.fn()
  }),
  { virtual: true }
)

jest.mock(
  "../services/funMessenger",
  () => ({
    funWindow: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
      showWarningMessage: jest.fn(),
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      withProgress: jest.fn(),
      createTextEditorDecorationType: jest.fn(() => ({ dispose: jest.fn() }))
    }
  }),
  { virtual: true }
)

import {
  hideBlame,
  initializeBlameGutter,
  onBlameActiveEditorChanged,
  onBlameConfigurationChanged,
  onBlameDocumentChanged,
  onBlameDocumentSaved,
  onBlameTextEditorSelectionChanged,
  showBlame
} from "./blameGutter"

import { funWindow as window } from "../services/funMessenger"
import { setContext } from "../context"

const mockedWindow = window as jest.Mocked<typeof window>
const mockedSetContext = setContext as jest.Mock

// Helper to make a fake vscode.TextEditor.
function makeEditor(uriStr: string, scheme = "adt", dirty = false, lang = "abap") {
  return {
    document: {
      uri: { toString: () => uriStr, scheme, authority: "dev100", languageId: lang },
      languageId: lang,
      isDirty: dirty,
      getText: () => "line1\nline2\nline3",
      lineCount: 3,
      lineAt: (_i: number) => ({ text: "some line text", length: 14 })
    },
    setDecorations: jest.fn(),
    selection: { active: { line: 0, character: 0 } },
    viewColumn: 1
  } as any
}

// Helper to make a fake vscode.TextDocument.
function makeDocument(uriStr: string, scheme = "adt") {
  return {
    uri: { toString: () => uriStr, scheme },
    languageId: "abap",
    isDirty: false
  } as any
}

afterEach(async () => {
  await hideBlame()
  ;(mockedWindow as any).activeTextEditor = undefined
  ;(mockedWindow as any).visibleTextEditors = []
})

describe("showBlame", () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default configuration falls back to the implementation defaults.
    const { workspace } = require("vscode")
    workspace.getConfiguration.mockReturnValue({
      get: jest.fn((_: string, fallback: unknown) => fallback)
    })

    // Execute the progress callback immediately so the test can assert synchronously.
    mockedWindow.withProgress.mockImplementation(async (_options: any, task: any) =>
      task({ report: jest.fn() }, { isCancellationRequested: false })
    )
  })

  it("renders a GitLens-like blame lane when configured", async () => {
    const editor = makeEditor("adt://dev100/gitlens-test.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const revisionDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    const { workspace } = require("vscode")
    workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, fallback: unknown) =>
        key === "blame.renderMode" ? "gitlens" : fallback
      )
    })

    const { AbapRevisionService } = require("../scm/abaprevisions/abaprevisionservice")
    AbapRevisionService.get.mockReturnValue({
      uriRevisions: jest.fn().mockResolvedValue([
        {
          author: "JSMITH",
          date: revisionDate,
          version: "KD1K900123",
          versionTitle: "Fix pricing logic",
          uri: "/sap/bc/adt/programs/programs/zfoo/source/main"
        }
      ])
    })

    await showBlame()

    expect(editor.setDecorations).toHaveBeenCalled()
    const leaderCall = (editor.setDecorations as jest.Mock).mock.calls.find(
      call =>
        Array.isArray(call[1]) &&
        call[1].length > 0 &&
        typeof call[1][0].renderOptions?.before?.contentText === "string" &&
        call[1][0].renderOptions.before.contentText.includes("KD1K900123")
    )
    expect(leaderCall).toBeDefined()
    expect(leaderCall[1][0].renderOptions.before.contentText).toContain("Fix pricing logic")
    expect(leaderCall[1][0].renderOptions.before.borderColor).toContain("rgba(")
    expect(leaderCall[1][0].renderOptions.after.textDecoration).toContain("background:url")
  })

  it("keeps classic annotations and also shows selected-line details", async () => {
    const editor = makeEditor("adt://dev100/classic-test.abap")
    editor.selection.active.line = 1
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const revisionDate = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { workspace } = require("vscode")
    workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, fallback: unknown) =>
        key === "blame.renderMode" ? "classic" : fallback
      )
    })

    const { AbapRevisionService } = require("../scm/abaprevisions/abaprevisionservice")
    AbapRevisionService.get.mockReturnValue({
      uriRevisions: jest.fn().mockResolvedValue([
        {
          author: "JSMITH",
          date: revisionDate,
          version: "KD1K900123",
          versionTitle: "Fix pricing logic",
          uri: "/sap/bc/adt/programs/programs/zfoo/source/main"
        }
      ])
    })

    await showBlame()

    const classicCall = (editor.setDecorations as jest.Mock).mock.calls.find(
      call =>
        Array.isArray(call[1]) &&
        call[1].length === 3 &&
        call[1][0].renderOptions?.after?.contentText?.includes("JSMITH -")
    )

    const selectedLineCall = (editor.setDecorations as jest.Mock).mock.calls.find(
      call =>
        Array.isArray(call[1]) &&
        call[1].length === 1 &&
        call[1][0].renderOptions?.after?.contentText?.includes("JSMITH,")
    )

    expect(classicCall).toBeDefined()
    expect(classicCall[1][0].renderOptions.after.contentText).toContain("KD1K900123")
    expect(selectedLineCall).toBeDefined()
    expect(selectedLineCall[1][0].renderOptions.after.contentText).toContain("KD1K900123")
  })
})

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

describe("onBlameConfigurationChanged", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("ignores unrelated configuration changes", () => {
    const event = {
      affectsConfiguration: jest.fn(() => false)
    } as any

    expect(() => onBlameConfigurationChanged(event)).not.toThrow()
    expect(event.affectsConfiguration).toHaveBeenCalledWith("abapfs.blame.renderMode")
  })
})

describe("onBlameTextEditorSelectionChanged", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("highlights all lines from the same blame group", async () => {
    const editor = makeEditor("adt://dev100/selection-test.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const revisionDate = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    mockedWindow.withProgress.mockImplementation(async (_options: any, task: any) =>
      task({ report: jest.fn() }, { isCancellationRequested: false })
    )

    const { AbapRevisionService } = require("../scm/abaprevisions/abaprevisionservice")
    AbapRevisionService.get.mockReturnValue({
      uriRevisions: jest.fn().mockResolvedValue([
        {
          author: "JSMITH",
          date: revisionDate,
          version: "KD1K900123",
          versionTitle: "Fix pricing logic",
          uri: "/sap/bc/adt/programs/programs/zfoo/source/main"
        }
      ])
    })

    await showBlame()
    ;(editor.setDecorations as jest.Mock).mockClear()

    onBlameTextEditorSelectionChanged({
      textEditor: editor,
      selections: [{ active: { line: 1, character: 0 } }]
    } as any)

    const highlightCall = (editor.setDecorations as jest.Mock).mock.calls.find(
      call => Array.isArray(call[1]) && call[1].length === 3 && call[1][0].start?.line === 0
    )
    expect(highlightCall).toBeDefined()
  })

  it("does not re-render classic blame decorations on selection change", async () => {
    const editor = makeEditor("adt://dev100/classic-selection-test.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const { workspace } = require("vscode")
    workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, fallback: unknown) =>
        key === "blame.renderMode" ? "classic" : fallback
      )
    })

    const revisionDate = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    mockedWindow.withProgress.mockImplementation(async (_options: any, task: any) =>
      task({ report: jest.fn() }, { isCancellationRequested: false })
    )

    const { AbapRevisionService } = require("../scm/abaprevisions/abaprevisionservice")
    AbapRevisionService.get.mockReturnValue({
      uriRevisions: jest.fn().mockResolvedValue([
        {
          author: "JSMITH",
          date: revisionDate,
          version: "KD1K900123",
          versionTitle: "Fix pricing logic",
          uri: "/sap/bc/adt/programs/programs/zfoo/source/main"
        }
      ])
    })

    await showBlame()
    ;(editor.setDecorations as jest.Mock).mockClear()

    onBlameTextEditorSelectionChanged({
      textEditor: editor,
      selections: [{ active: { line: 1, character: 0 } }]
    } as any)

    expect((editor.setDecorations as jest.Mock).mock.calls).toHaveLength(3)
    expect((editor.setDecorations as jest.Mock).mock.calls[1][1][0].renderOptions.after.contentText).toContain("JSMITH,")
    expect((editor.setDecorations as jest.Mock).mock.calls[2][1]).toEqual([])
  })
})

describe("onBlameDocumentChanged", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("ignores non-adt documents", () => {
    const event = {
      document: makeDocument("file:///foo.ts", "file"),
      contentChanges: [{}]
    } as any
    expect(() => onBlameDocumentChanged(event)).not.toThrow()
  })

  it("handles adt document without active blame", () => {
    const event = {
      document: makeDocument("adt://dev100/foo.abap"),
      contentChanges: []
    } as any
    ;(mockedWindow as any).activeTextEditor = undefined
    expect(() => onBlameDocumentChanged(event)).not.toThrow()
  })

  it("handles empty content changes", () => {
    const event = {
      document: makeDocument("adt://dev100/foo.abap"),
      contentChanges: []
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
    expect(workspace.onDidChangeConfiguration).toHaveBeenCalled()
    expect(mockedWindow.onDidChangeTextEditorSelection).toHaveBeenCalled()
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