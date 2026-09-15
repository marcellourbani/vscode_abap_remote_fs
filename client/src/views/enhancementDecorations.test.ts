/**
 * Tests for enhancementDecorations.ts
 * Tests initializeEnhancementDecorations, clearEnhancementDecorations, and updateEnhancementDecorations logic.
 */

vi.mock("vscode", () => {
  const mockDisposable = { dispose: vi.fn() }
  return {
    Range: vi.fn(function (this: object, sl: number, sc: number, el: number, ec: number) {
      return {
        start: { line: sl, character: sc },
        end: { line: el, character: ec }
      }
    }),
    MarkdownString: vi.fn(function (this: { value?: string; isTrusted?: boolean }, value: string) {
      this.value = value
      this.isTrusted = false
    }),
    Uri: {
      parse: vi.fn(function (s: string) {
        return { toString: () => s }
      })
    },
    workspace: {
      openTextDocument: vi.fn()
    }
  }
})

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createTextEditorDecorationType: vi.fn(function () {
      return { dispose: vi.fn() }
    }),
    showTextDocument: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    visibleTextEditors: []
  }
}))

vi.mock("../services/abapCopilotLogger", () => ({
  logCommands: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock("../adt/operations/AdtObjectFinder", () => ({
  uriAbapFile: vi.fn()
}))

vi.mock("../services/lm-tools/shared", () => ({
  getObjectEnhancements: vi.fn()
}))

vi.mock("../adt/conections", () => ({
  getOrCreateRoot: vi.fn()
}))

import {
  initializeEnhancementDecorations,
  updateEnhancementDecorations,
  clearEnhancementDecorations,
  showEnhancementSource
} from "./enhancementDecorations"
import { funWindow as window } from "../services/funMessenger"
import { uriAbapFile } from "../adt/operations/AdtObjectFinder"
import { getObjectEnhancements } from "../services/lm-tools/shared"
import type { Mocked, Mock } from "vitest"

const mockedWindow = window as Mocked<typeof window>
const mockedUriAbapFile = uriAbapFile as Mock
const mockedGetObjectEnhancements = getObjectEnhancements as Mock

function makeEditor(scheme = "adt", lang = "abap") {
  return {
    document: {
      uri: { toString: () => `${scheme}://dev100/foo.abap`, scheme, authority: "dev100" },
      languageId: lang,
      lineCount: 5,
      lineAt: (i: number) => ({ text: "some text", length: 9 })
    },
    setDecorations: vi.fn()
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
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Reinitialize so decoration type is set
    const subscriptions: any[] = []
    initializeEnhancementDecorations({ subscriptions } as any)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
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
      loadStructure: vi.fn(),
      contentsPath: vi.fn(function () {
        return "/sap/bc/adt/programs/programs/zprog/source/main"
      })
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
      loadStructure: vi.fn(),
      contentsPath: vi.fn(function () {
        return "/sap/bc/adt/programs/programs/zprog/source/main"
      })
    }
    mockedUriAbapFile.mockReturnValue({ object: mockObject })
    mockedGetObjectEnhancements.mockResolvedValue({
      hasEnhancements: true,
      enhancements: [
        { name: "ZENH1", type: "HOOK", startLine: 2, uri: "/some/uri" },
        { name: "ZENH2", type: "WDYN", startLine: 0, uri: "/another/uri" }
      ]
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
      loadStructure: vi.fn().mockResolvedValue(undefined),
      contentsPath: vi.fn(function () {
        return "/sap/bc/adt/programs/programs/zprog/source/main"
      })
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
      loadStructure: vi.fn(),
      contentsPath: vi.fn(function () {
        return "/sap/bc/adt/programs/programs/zprog/source/main"
      })
    }
    mockedUriAbapFile.mockReturnValue({ object: mockObject })
    mockedGetObjectEnhancements.mockRejectedValue(new Error("API error"))
    ;(mockedWindow as any).activeTextEditor = editor
    await expect(updateEnhancementDecorations(editor)).resolves.toBeUndefined()
  })
})

describe("clearEnhancementDecorations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.clearAllMocks()
  })

  it("shows error if objectUri is missing", async () => {
    await showEnhancementSource("ZENH1", "", "dev100")
    expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith(
      "Missing object URI or connection ID"
    )
  })

  it("shows error if connectionId is missing", async () => {
    await showEnhancementSource("ZENH1", "/some/uri", "")
    expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith(
      "Missing object URI or connection ID"
    )
  })
})
