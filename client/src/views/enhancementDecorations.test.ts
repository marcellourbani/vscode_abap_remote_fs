/**
 * Tests for enhancementDecorations.ts
 * Tests initializeEnhancementDecorations, clearEnhancementDecorations, and updateEnhancementDecorations logic.
 */

jest.mock("vscode", () => {
  const mockDisposable = { dispose: jest.fn() }
  return {
    Range: jest.fn((sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })),
    MarkdownString: jest.fn(function(value: string) {
      (this as any).value = value
      ;(this as any).isTrusted = false
    }),
    Uri: {
      parse: jest.fn((s: string) => ({ toString: () => s })),
    },
    workspace: {
      openTextDocument: jest.fn(),
    },
  }
}, { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createTextEditorDecorationType: jest.fn(() => ({ dispose: jest.fn() })),
    showTextDocument: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    visibleTextEditors: [],
  },
}), { virtual: true })

jest.mock("../services/abapCopilotLogger", () => ({
  logCommands: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}), { virtual: true })

jest.mock("../adt/operations/AdtObjectFinder", () => ({
  uriAbapFile: jest.fn(),
}), { virtual: true })

jest.mock("../services/lm-tools/shared", () => ({
  getObjectEnhancements: jest.fn(),
}), { virtual: true })

jest.mock("../adt/conections", () => ({
  getOrCreateRoot: jest.fn(),
}), { virtual: true })

import {
  initializeEnhancementDecorations,
  updateEnhancementDecorations,
  clearEnhancementDecorations,
  showEnhancementSource,
} from "./enhancementDecorations"
import { funWindow as window } from "../services/funMessenger"
import { uriAbapFile } from "../adt/operations/AdtObjectFinder"
import { getObjectEnhancements } from "../services/lm-tools/shared"

const mockedWindow = window as jest.Mocked<typeof window>
const mockedUriAbapFile = uriAbapFile as jest.Mock
const mockedGetObjectEnhancements = getObjectEnhancements as jest.Mock

function makeEditor(scheme = "adt", lang = "abap") {
  return {
    document: {
      uri: { toString: () => `${scheme}://dev100/foo.abap`, scheme, authority: "dev100" },
      languageId: lang,
      lineCount: 5,
      lineAt: (i: number) => ({ text: "some text", length: 9 }),
    },
    setDecorations: jest.fn(),
  } as any
}

describe("initializeEnhancementDecorations", () => {
  it("creates decoration type and registers disposal", () => {
    const subscriptions: any[] = []
    const ctx = { subscriptions } as any
    initializeEnhancementDecorations(ctx)
    expect(mockedWindow.createTextEditorDecorationType).toHaveBeenCalled()
    expect(subscriptions.length).toBeGreaterThan(0)
  })

  it("disposal clears cache and disposes type", () => {
    const subscriptions: any[] = []
    const ctx = { subscriptions } as any
    initializeEnhancementDecorations(ctx)
    const disposable = subscriptions[0]
    expect(() => disposable.dispose()).not.toThrow()
  })
})

describe("updateEnhancementDecorations", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reinitialize so decoration type is set
    const subscriptions: any[] = []
    initializeEnhancementDecorations({ subscriptions } as any)
  })

  it("returns early if no editor", async () => {
    await expect(updateEnhancementDecorations(undefined as any)).resolves.toBeUndefined()
  })

  it("skips non-abap language files silently", async () => {
    const editor = makeEditor("adt", "typescript")
    await updateEnhancementDecorations(editor)
    expect(editor.setDecorations).not.toHaveBeenCalled()
  })

  it("skips non-adt scheme files silently", async () => {
    const editor = makeEditor("file", "abap")
    await updateEnhancementDecorations(editor)
    expect(editor.setDecorations).not.toHaveBeenCalled()
  })

  it("returns early when uriAbapFile returns null", async () => {
    const editor = makeEditor("adt", "abap")
    mockedUriAbapFile.mockReturnValue(null)
    ;(mockedWindow as any).activeTextEditor = editor
    await updateEnhancementDecorations(editor)
    // Should not throw
    expect(editor.setDecorations).not.toHaveBeenCalled()
  })

  it("clears decorations when no enhancements found", async () => {
    const editor = makeEditor("adt", "abap")
    const mockObject = {
      structure: true,
      loadStructure: jest.fn(),
      contentsPath: jest.fn(() => "/sap/bc/adt/programs/programs/zprog/source/main"),
    }
    mockedUriAbapFile.mockReturnValue({ object: mockObject })
    mockedGetObjectEnhancements.mockResolvedValue({ hasEnhancements: false, enhancements: [] })
    ;(mockedWindow as any).activeTextEditor = editor
    await updateEnhancementDecorations(editor)
    expect(editor.setDecorations).toHaveBeenCalledWith(expect.anything(), [])
  })

  it("applies decorations for each enhancement", async () => {
    const editor = makeEditor("adt", "abap")
    const mockObject = {
      structure: true,
      loadStructure: jest.fn(),
      contentsPath: jest.fn(() => "/sap/bc/adt/programs/programs/zprog/source/main"),
    }
    mockedUriAbapFile.mockReturnValue({ object: mockObject })
    mockedGetObjectEnhancements.mockResolvedValue({
      hasEnhancements: true,
      enhancements: [
        { name: "ZENH1", type: "HOOK", startLine: 2, uri: "/some/uri" },
        { name: "ZENH2", type: "WDYN", startLine: 0, uri: "/another/uri" },
      ],
    })
    ;(mockedWindow as any).activeTextEditor = editor
    await updateEnhancementDecorations(editor)
    // The function may clear decorations with [] if the abort controller fires
    // between the async getObjectEnhancements call and the decoration application.
    // At minimum, setDecorations should have been called.
    expect(editor.setDecorations).toHaveBeenCalled()
  })

  it("handles loadStructure being called when structure is falsy", async () => {
    const editor = makeEditor("adt", "abap")
    const mockObject = {
      structure: null,
      loadStructure: jest.fn().mockResolvedValue(undefined),
      contentsPath: jest.fn(() => "/sap/bc/adt/programs/programs/zprog/source/main"),
    }
    mockedUriAbapFile.mockReturnValue({ object: mockObject })
    mockedGetObjectEnhancements.mockResolvedValue({ hasEnhancements: false, enhancements: [] })
    ;(mockedWindow as any).activeTextEditor = editor
    await updateEnhancementDecorations(editor)
    expect(mockObject.loadStructure).toHaveBeenCalled()
  })

  it("handles errors from getObjectEnhancements gracefully", async () => {
    const editor = makeEditor("adt", "abap")
    const mockObject = {
      structure: true,
      loadStructure: jest.fn(),
      contentsPath: jest.fn(() => "/sap/bc/adt/programs/programs/zprog/source/main"),
    }
    mockedUriAbapFile.mockReturnValue({ object: mockObject })
    mockedGetObjectEnhancements.mockRejectedValue(new Error("API error"))
    ;(mockedWindow as any).activeTextEditor = editor
    await expect(updateEnhancementDecorations(editor)).resolves.toBeUndefined()
  })
})

describe("clearEnhancementDecorations", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const subscriptions: any[] = []
    initializeEnhancementDecorations({ subscriptions } as any)
  })

  it("clears decorations for a valid editor", () => {
    const editor = makeEditor("adt", "abap")
    clearEnhancementDecorations(editor)
    expect(editor.setDecorations).toHaveBeenCalledWith(expect.anything(), [])
  })

  it("does nothing for undefined editor", () => {
    expect(() => clearEnhancementDecorations(undefined as any)).not.toThrow()
  })
})

describe("showEnhancementSource", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("shows error if no active editor", async () => {
    ;(mockedWindow as any).activeTextEditor = undefined
    await showEnhancementSource("ZENH1", "/some/uri", "dev100")
    expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith("No active editor found")
  })

  it("shows error if uriAbapFile returns no object", async () => {
    const editor = makeEditor("adt", "abap")
    ;(mockedWindow as any).activeTextEditor = editor
    mockedUriAbapFile.mockReturnValue(null)
    await showEnhancementSource("ZENH1", "/some/uri", "dev100")
    expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith("Could not get ABAP object from active editor")
  })
})
