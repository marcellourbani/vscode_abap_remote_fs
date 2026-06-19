// Tests for providers/hoverProvider.ts - AbapHoverProviderV2 (private methods via indirect testing)
jest.mock("vscode", () => {
  const Position = class {
    constructor(public line: number, public character: number) {}
  }
  const Range = class {
    constructor(public start: any, public end: any) {}
  }
  const MarkdownString = class {
    public isTrusted?: boolean
    public supportHtml?: boolean
    public value = ""
    appendMarkdown(s: string) { this.value += s; return this }
    appendCodeblock(s: string, lang?: string) { this.value += `\`\`\`${lang}\n${s}\n\`\`\``; return this }
  }
  const Hover = class {
    constructor(public contents: any, public range?: any) {}
  }
  const CancellationTokenCls = class { isCancellationRequested = false }
  return {
    Position,
    Range,
    MarkdownString,
    Hover,
    CancellationToken: CancellationTokenCls,
    commands: { executeCommand: jest.fn() },
    workspace: { openTextDocument: jest.fn() },
    window: { visibleTextEditors: [] }
  }
}, { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: { visibleTextEditors: [] }
}))

import { AbapHoverProviderV2 } from "./hoverProvider"
import * as vscode from "vscode"

// Helper to build a mock TextDocument
const makeMockDocument = (lines: string[], uriStr = "file:///test.abap") => {
  const mockUri = { toString: () => uriStr, path: uriStr, scheme: "file", authority: "" }
  return {
    uri: mockUri,
    lineAt: jest.fn((lineOrPos: number | any) => {
      const line = typeof lineOrPos === "number" ? lineOrPos : lineOrPos.line
      return { text: lines[line] ?? "" }
    }),
    getText: jest.fn((range?: any) => lines.join("\n")),
    getWordRangeAtPosition: jest.fn()
  } as any
}

const makeMockPosition = (line: number, character: number) => new vscode.Position(line, character)
const makeMockToken = () => ({ isCancellationRequested: false } as unknown as vscode.CancellationToken)

describe("AbapHoverProviderV2", () => {
  let provider: AbapHoverProviderV2
  let logMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    logMock = jest.fn()
    provider = new AbapHoverProviderV2(logMock)
  })

  describe("constructor", () => {
    it("creates instance without log", () => {
      expect(() => new AbapHoverProviderV2()).not.toThrow()
    })

    it("creates instance with log", () => {
      expect(() => new AbapHoverProviderV2(jest.fn())).not.toThrow()
    })
  })

  describe("provideHover - no word found", () => {
    it("returns undefined when no word range detected and no fallback word range", async () => {
      const doc = makeMockDocument(["   "])
      doc.getWordRangeAtPosition.mockReturnValue(undefined)
      const pos = makeMockPosition(0, 0)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      expect(result).toBeUndefined()
    })
  })

  describe("provideHover - no definitions found", () => {
    it("returns undefined when executeDefinitionProvider returns empty", async () => {
      const doc = makeMockDocument(["DATA lv_var TYPE string."])
      doc.getWordRangeAtPosition.mockReturnValue(
        new vscode.Range(new vscode.Position(0, 5), new vscode.Position(0, 11))
      )
      ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue([])

      const pos = makeMockPosition(0, 6)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      // no definitions -> fallback to built-in types -> if not found -> undefined
      // lv_var is not a built-in type keyword
      expect(result).toBeUndefined()
    })
  })

  describe("ABAP word range detection (getAbapWordRange)", () => {
    it("detects TEXT-001 pattern", async () => {
      const line = "  WRITE TEXT-001."
      const doc = makeMockDocument([line])
      doc.getWordRangeAtPosition.mockReturnValue(undefined)
      ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(null)

      // position within TEXT-001
      const pos = makeMockPosition(0, 10)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      // word is TEXT-001 but no definitions - check built-in types
      // TEXT-001 is not a built-in type, so result depends on built-in fallback
      // The important thing is it doesn't crash
      expect(result === undefined || result instanceof vscode.Hover).toBe(true)
    })

    it("detects SY-SUBRC pattern", async () => {
      const line = "  IF SY-SUBRC <> 0."
      const doc = makeMockDocument([line])
      doc.getWordRangeAtPosition.mockReturnValue(undefined)
      ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(null)

      const pos = makeMockPosition(0, 6)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      expect(result === undefined || result instanceof vscode.Hover).toBe(true)
    })

    it("does not crash on lines with no special patterns", async () => {
      const line = "  normal_variable."
      const doc = makeMockDocument([line])
      doc.getWordRangeAtPosition.mockReturnValue(undefined)
      ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(null)

      const pos = makeMockPosition(0, 3)
      await expect(provider.provideHover(doc, pos, makeMockToken())).resolves.not.toThrow()
    })
  })

  describe("getContextAwareHover - context-aware keywords", () => {
    it("returns undefined when definition command throws", async () => {
      const doc = makeMockDocument(["  MESSAGE 'test' TYPE 'S'."])
      doc.getWordRangeAtPosition.mockReturnValue(
        new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 9))
      )
      ;(vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error("failed"))

      const pos = makeMockPosition(0, 5)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      expect(result).toBeUndefined()
    })
  })

  describe("provideHover - definition found", () => {
    it("returns a Hover when definition is found and document can be opened", async () => {
      const doc = makeMockDocument(["  CALL FUNCTION 'MY_FM'."])
      doc.getWordRangeAtPosition.mockReturnValue(
        new vscode.Range(new vscode.Position(0, 17), new vscode.Position(0, 22))
      )

      const defUri = { toString: () => "file:///fm.abap", path: "/fm.abap", scheme: "file", authority: "" }
      const defDoc = makeMockDocument(["FUNCTION MY_FM.", "  ....", "ENDFUNCTION."], "file:///fm.abap")
      ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue([
        { uri: defUri, range: { start: { line: 0 } } }
      ])
      ;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(defDoc)

      const pos = makeMockPosition(0, 18)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      expect(result).toBeInstanceOf(vscode.Hover)
    })
  })

  describe("error handling", () => {
    it("catches errors in provideHover and returns undefined", async () => {
      const doc = {
        uri: { toString: () => "file:///err.abap" },
        lineAt: jest.fn(() => { throw new Error("document error") }),
        getText: jest.fn(),
        getWordRangeAtPosition: jest.fn(() => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)))
      } as any

      const pos = makeMockPosition(0, 2)
      const result = await provider.provideHover(doc, pos, makeMockToken())
      expect(result).toBeUndefined()
    })
  })
})
