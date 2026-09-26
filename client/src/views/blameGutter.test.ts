/**
 * Tests for blameGutter.ts
 * Covers blame lifecycle handlers and configuration-driven rendering.
 */

vi.mock("vscode", () => {
  const mockDisposable = { dispose: vi.fn() }
  return {
    ProgressLocation: { Notification: 15 },
    OverviewRulerLane: { Right: 4 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    DecorationRangeBehavior: { ClosedClosed: 0, OpenOpen: 1 },
    Range: vi.fn(function (this: object, sl: number, sc: number, el: number, ec: number) {
      return {
        start: { line: sl, character: sc },
        end: { line: el, character: ec }
      }
    }),
    ThemeColor: vi.fn(function (id: string) {
      return { id }
    }),
    MarkdownString: vi.fn(function (this: { value?: string; isTrusted?: boolean }, value: string) {
      this.value = value
      this.isTrusted = false
    }),
    commands: {
      registerCommand: vi.fn(function () {
        return mockDisposable
      })
    },
    workspace: {
      getConfiguration: vi.fn(function () {
        return {
          get: vi.fn((_: string, fallback: unknown) => fallback)
        }
      }),
      onDidSaveTextDocument: vi.fn(function () {
        return mockDisposable
      }),
      onDidChangeConfiguration: vi.fn(function () {
        return mockDisposable
      })
    }
  }
})

vi.mock("../adt/conections", () => ({
  getClient: vi.fn(),
  ADTSCHEME: "adt",
  abapUri: vi.fn(function () {
    return true
  })
}))

vi.mock("../scm/abaprevisions/abaprevisionservice", () => ({
  AbapRevisionService: { get: vi.fn() }
}))

vi.mock("../context", () => ({
  setContext: vi.fn()
}))

vi.mock("../lib", () => ({
  log: vi.fn()
}))

vi.mock("../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    onDidChangeTextEditorSelection: vi.fn(function () {
      return { dispose: vi.fn() }
    }),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn(),
    createTextEditorDecorationType: vi.fn(function () {
      return { dispose: vi.fn() }
    }),
    createStatusBarItem: vi.fn(function () {
      return {
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn()
      }
    })
  }
}))

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
import * as __$mock_vscode from "vscode"
import * as __$mock_scm_abaprevisions_abaprevisionservice from "../scm/abaprevisions/abaprevisionservice"
import type { Mocked, Mock } from "vitest"

const mockedWindow = window as Mocked<typeof window>
const mockedSetContext = setContext as Mock

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
    setDecorations: vi.fn(),
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
    vi.clearAllMocks()

    // Default configuration falls back to the implementation defaults.
    const { workspace } = __$mock_vscode
    ;(workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn(function (_: string, fallback: unknown) {
        return fallback
      })
    })

    // Execute the progress callback immediately so the test can assert synchronously.
    mockedWindow.withProgress.mockImplementation(function (_options: any, task: any) {
      return task({ report: vi.fn() }, { isCancellationRequested: false })
    })
  })

  it("renders a GitLens-like blame lane when configured", async () => {
    const editor = makeEditor("adt://dev100/gitlens-test.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const revisionDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    const { workspace } = __$mock_vscode
    ;(workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn(function (key: string, fallback: unknown) {
        return key === "blame.renderMode" ? "gitlens" : fallback
      })
    })

    const { AbapRevisionService } = __$mock_scm_abaprevisions_abaprevisionservice
    ;(AbapRevisionService.get as Mock).mockReturnValue({
      uriRevisions: vi.fn().mockResolvedValue([
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
    const leaderCall = (editor.setDecorations as Mock).mock.calls.find(
      call =>
        Array.isArray(call[1]) &&
        call[1].length > 0 &&
        typeof call[1][0].renderOptions?.before?.contentText === "string" &&
        call[1][0].renderOptions.before.contentText.includes("KD1K900123")
    )
    expect(leaderCall).toBeDefined()
    expect(leaderCall![1][0].renderOptions.before.contentText).toContain("Fix pricing logic")
    expect(leaderCall![1][0].renderOptions.before.borderColor).toContain("rgba(")
    expect(leaderCall![1][0].renderOptions.after.textDecoration).toContain("background:url")
  })

  it("keeps classic annotations and also shows selected-line details", async () => {
    const editor = makeEditor("adt://dev100/classic-test.abap")
    editor.selection.active.line = 1
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const revisionDate = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { workspace } = __$mock_vscode
    ;(workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn(function (key: string, fallback: unknown) {
        return key === "blame.renderMode" ? "classic" : fallback
      })
    })

    const { AbapRevisionService } = __$mock_scm_abaprevisions_abaprevisionservice
    ;(AbapRevisionService.get as Mock).mockReturnValue({
      uriRevisions: vi.fn().mockResolvedValue([
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

    const classicCall = (editor.setDecorations as Mock).mock.calls.find(
      call =>
        Array.isArray(call[1]) &&
        call[1].length === 3 &&
        call[1][0].renderOptions?.after?.contentText?.includes("JSMITH -")
    )

    const selectedLineCall = (editor.setDecorations as Mock).mock.calls.find(
      call =>
        Array.isArray(call[1]) &&
        call[1].length === 1 &&
        call[1][0].renderOptions?.after?.contentText?.includes("JSMITH,")
    )

    expect(classicCall).toBeDefined()
    expect(classicCall![1][0].renderOptions.after.contentText).toContain("KD1K900123")
    expect(selectedLineCall).toBeDefined()
    expect(selectedLineCall![1][0].renderOptions.after.contentText).toContain("KD1K900123")
  })
})

describe("hideBlame", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.clearAllMocks()
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
    vi.clearAllMocks()
  })

  it("ignores unrelated configuration changes", () => {
    const event = {
      affectsConfiguration: vi.fn(function () {
        return false
      })
    } as any

    expect(() => onBlameConfigurationChanged(event)).not.toThrow()
    expect(event.affectsConfiguration).toHaveBeenCalledWith("abapfs.blame.renderMode")
  })
})

describe("onBlameTextEditorSelectionChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("highlights all lines from the same blame group", async () => {
    const editor = makeEditor("adt://dev100/selection-test.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const revisionDate = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    mockedWindow.withProgress.mockImplementation(function (_options: any, task: any) {
      return task({ report: vi.fn() }, { isCancellationRequested: false })
    })

    const { AbapRevisionService } = __$mock_scm_abaprevisions_abaprevisionservice
    ;(AbapRevisionService.get as Mock).mockReturnValue({
      uriRevisions: vi.fn().mockResolvedValue([
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
    ;(editor.setDecorations as Mock).mockClear()

    onBlameTextEditorSelectionChanged({
      textEditor: editor,
      selections: [{ active: { line: 1, character: 0 } }]
    } as any)

    const highlightCall = (editor.setDecorations as Mock).mock.calls.find(
      call => Array.isArray(call[1]) && call[1].length === 3 && call[1][0].start?.line === 0
    )
    expect(highlightCall).toBeDefined()
  })

  it("does not re-render classic blame decorations on selection change", async () => {
    const editor = makeEditor("adt://dev100/classic-selection-test.abap")
    ;(mockedWindow as any).activeTextEditor = editor
    ;(mockedWindow as any).visibleTextEditors = [editor]

    const { workspace } = __$mock_vscode
    ;(workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn(function (key: string, fallback: unknown) {
        return key === "blame.renderMode" ? "classic" : fallback
      })
    })

    const revisionDate = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    mockedWindow.withProgress.mockImplementation(function (_options: any, task: any) {
      return task({ report: vi.fn() }, { isCancellationRequested: false })
    })

    const { AbapRevisionService } = __$mock_scm_abaprevisions_abaprevisionservice
    ;(AbapRevisionService.get as Mock).mockReturnValue({
      uriRevisions: vi.fn().mockResolvedValue([
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
    ;(editor.setDecorations as Mock).mockClear()

    onBlameTextEditorSelectionChanged({
      textEditor: editor,
      selections: [{ active: { line: 1, character: 0 } }]
    } as any)

    expect((editor.setDecorations as Mock).mock.calls).toHaveLength(3)
    expect(
      (editor.setDecorations as Mock).mock.calls[1][1][0].renderOptions.after.contentText
    ).toContain("JSMITH,")
    expect((editor.setDecorations as Mock).mock.calls[2][1]).toEqual([])
  })
})

describe("onBlameDocumentChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.clearAllMocks()
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
    const { commands, workspace } = __$mock_vscode
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
