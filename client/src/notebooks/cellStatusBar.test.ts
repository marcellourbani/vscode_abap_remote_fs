vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showErrorMessage: vi.fn()
  }
}))
vi.mock("../lib", () => ({
  log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock("../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("../config", () => ({
  formatKey: (s: string) => s.toLowerCase(),
  connectedRoots: vi.fn(() => new Map([["dev", {}]])),
  getConfig: vi.fn(() => ({ get: () => ({ DEV: {}, QAS: {} }) }))
}))
vi.mock("vscode", () => {
  const NotebookCellStatusBarItem = vi.fn().mockImplementation(function (
    text: string,
    alignment: any
  ) {
    return { text, alignment, tooltip: undefined as string | undefined, command: undefined as any }
  })
  class EventEmitter {
    event = vi.fn()
    fire = vi.fn()
  }
  return {
    NotebookCellStatusBarItem,
    NotebookCellStatusBarAlignment: { Right: 2, Left: 1 },
    NotebookCellKind: { Markup: 1, Code: 2 },
    EventEmitter,
    NotebookEdit: {
      updateCellMetadata: vi.fn(function (index: number, meta: any) {
        return { index, meta }
      })
    },
    WorkspaceEdit: vi.fn().mockImplementation(function () {
      return { set: vi.fn(), replace: vi.fn() }
    }),
    notebooks: {
      registerNotebookCellStatusBarItemProvider: vi.fn(function () {
        return { dispose: vi.fn() }
      }),
      createNotebookController: vi.fn()
    },
    commands: {
      registerCommand: vi.fn(function () {
        return { dispose: vi.fn() }
      })
    },
    window: { activeNotebookEditor: undefined },
    workspace: {
      applyEdit: vi.fn().mockResolvedValue(true),
      onDidChangeNotebookDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      getConfiguration: vi.fn(() => ({ get: (_k: string, d: unknown) => d }))
    }
  }
})

import { SqlCellStatusBarProvider, registerCellStatusBar } from "./cellStatusBar"
import { DEFAULT_MAX_ROWS, SQL_LANGUAGE_ID } from "./types"
import { funWindow as window } from "../services/funMessenger"
import * as vscode from "vscode"

const mockWindow = window as any

/** Build a notebook of cells: spec = [languageId, metadata] */
function makeNotebook(spec: Array<[string, Record<string, unknown>?]>): any[] {
  const notebook: any = { uri: { toString: () => "file:///nb.sapwb" } }
  const cells = spec.map(([languageId, metadata], index) => ({
    kind: languageId === "markdown" ? 1 : 2,
    document: { languageId, getText: () => "" },
    metadata: metadata ?? {},
    index,
    notebook
  }))
  notebook.getCells = () => cells
  return cells
}
const texts = (items: any[]) => items.map(i => i.text)

function commandHandler(name: string): (...a: any[]) => Promise<void> {
  const call = (vscode.commands.registerCommand as any).mock.calls.find((c: any[]) => c[0] === name)
  return call[1]
}

describe("cell status bar", () => {
  let provider: SqlCellStatusBarProvider
  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SqlCellStatusBarProvider()
  })

  test("JS cell shows only its index", () => {
    const [cell] = makeNotebook([["javascript"]])
    expect(texts(provider.provideCellStatusBarItems(cell))).toEqual(["$(tag) #0"])
  })

  test("named cell shows its name", () => {
    const [cell] = makeNotebook([["javascript", { name: "summary" }]])
    expect(texts(provider.provideCellStatusBarItems(cell))[0]).toBe("$(tag) #0 · summary")
  })

  test("SQL cell: name and row limit", () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID]])
    const t = texts(provider.provideCellStatusBarItems(cell))
    expect(t).toEqual(["$(tag) #0", `$(list-ordered) Rows: ${DEFAULT_MAX_ROWS}`])
  })

  test("custom row limit is shown", () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID, { maxRows: 50 }]])
    expect(texts(provider.provideCellStatusBarItems(cell))).toContain("$(list-ordered) Rows: 50")
  })

  test("items are clickable with the right commands", () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID]])
    const cmds = provider.provideCellStatusBarItems(cell).map((i: any) => i.command.command)
    expect(cmds).toEqual(["abapfs.notebookSetCellName", "abapfs.notebookSetCellMaxRows"])
  })
})

describe("cell commands", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerCellStatusBar({ subscriptions: [] } as any)
  })

  test("setCellMaxRows stores the value", async () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID]])
    mockWindow.showInputBox.mockResolvedValue("500")
    await commandHandler("abapfs.notebookSetCellMaxRows")(cell)
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(0, { maxRows: 500 })
  })

  test("setCellName validates uniqueness and stores the name", async () => {
    const cells = makeNotebook([[SQL_LANGUAGE_ID, { name: "taken" }], ["javascript"]])
    mockWindow.showInputBox.mockImplementation(async (opts: any) => {
      expect(opts.validateInput("taken")).toMatch(/already named/)
      expect(opts.validateInput("1abc")).toBeDefined()
      expect(opts.validateInput("summary")).toBeUndefined()
      return "summary"
    })
    await commandHandler("abapfs.notebookSetCellName")(cells[1])
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(1, { name: "summary" })
  })

  test("clearing the name removes it from metadata", async () => {
    const [cell] = makeNotebook([["javascript", { name: "old", maxRows: 5 }]])
    mockWindow.showInputBox.mockResolvedValue("")
    await commandHandler("abapfs.notebookSetCellName")(cell)
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(0, { maxRows: 5 })
  })
})
