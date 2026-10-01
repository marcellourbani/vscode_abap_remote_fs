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
  connectedRoots: vi.fn(
    () =>
      new Map([
        ["dev", {}],
        ["prd", {}]
      ])
  ),
  getConfig: vi.fn(() => ({ get: () => ({ DEV: {}, QAS: {}, PRD: {}, TST: {} }) }))
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
    QuickPickItemKind: { Separator: -1, Default: 0 },
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

  test("JS cell without system shows only its index", () => {
    const [cell] = makeNotebook([["javascript"]])
    expect(texts(provider.provideCellStatusBarItems(cell))).toEqual(["$(tag) #0"])
  })

  test("named cell shows its name", () => {
    const [cell] = makeNotebook([["javascript", { name: "summary" }]])
    expect(texts(provider.provideCellStatusBarItems(cell))[0]).toBe("$(tag) #0 · summary")
  })

  test("SQL cell without system: name, 'ask' and row limit", () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID]])
    const t = texts(provider.provideCellStatusBarItems(cell))
    expect(t).toEqual([
      "$(tag) #0",
      "$(plug) system: ask",
      `$(list-ordered) Rows: ${DEFAULT_MAX_ROWS}`
    ])
  })

  test("custom row limit is shown", () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID, { maxRows: 50 }]])
    expect(texts(provider.provideCellStatusBarItems(cell))).toContain("$(list-ordered) Rows: 50")
  })

  test("system marker is sticky across SQL cells until the next marker", () => {
    const cells = makeNotebook([
      [SQL_LANGUAGE_ID, { system: "DEV" }],
      ["javascript"],
      [SQL_LANGUAGE_ID],
      [SQL_LANGUAGE_ID, { system: "QAS" }],
      [SQL_LANGUAGE_ID]
    ])
    const sys = (i: number) => texts(provider.provideCellStatusBarItems(cells[i]))[1]
    expect(sys(0)).toBe("$(server-environment) DEV ▸")
    expect(sys(2)).toBe("$(server-environment) DEV (from #0)")
    // QAS is configured but not connected in the mocked window
    expect(sys(3)).toBe("$(debug-disconnect) QAS ▸")
    expect(sys(4)).toBe("$(debug-disconnect) QAS (from #3)")
  })

  test("JavaScript and markdown cells show no system", () => {
    const cells = makeNotebook([["markdown"], [SQL_LANGUAGE_ID, { system: "DEV" }], ["javascript"]])
    expect(texts(provider.provideCellStatusBarItems(cells[0]))).toEqual(["$(tag) #0"])
    expect(texts(provider.provideCellStatusBarItems(cells[2]))).toEqual(["$(tag) #2"])
  })

  test("a marker left on a non-SQL cell is shown as ignored and does not apply", () => {
    const cells = makeNotebook([["markdown", { system: "DEV" }], [SQL_LANGUAGE_ID]])
    expect(texts(provider.provideCellStatusBarItems(cells[0]))[1]).toBe("$(warning) DEV (ignored)")
    expect(texts(provider.provideCellStatusBarItems(cells[1]))[1]).toBe("$(plug) system: ask")
  })

  test("removing the middle of three markers: no cell points at the removed one", () => {
    const cells = makeNotebook([
      [SQL_LANGUAGE_ID, { system: "DEV" }],
      [SQL_LANGUAGE_ID, { system: "QAS" }],
      [SQL_LANGUAGE_ID, { system: "PRD" }],
      ["javascript"]
    ])
    cells[1].metadata = {} // what the remove command stores
    const all = cells.map(c => texts(provider.provideCellStatusBarItems(c)).join(" | "))
    expect(all).toEqual([
      "$(tag) #0 | $(server-environment) DEV ▸ | $(list-ordered) Rows: 1000",
      "$(tag) #1 | $(server-environment) DEV (from #0) | $(list-ordered) Rows: 1000",
      "$(tag) #2 | $(server-environment) PRD ▸ | $(list-ordered) Rows: 1000",
      "$(tag) #3"
    ])
  })

  test("items are clickable with the right commands", () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID]])
    const cmds = provider.provideCellStatusBarItems(cell).map((i: any) => i.command.command)
    expect(cmds).toEqual([
      "abapfs.notebookSetCellName",
      "abapfs.notebookSetCellSystem",
      "abapfs.notebookSetCellMaxRows"
    ])
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

  test("setCellSystem stores the picked system", async () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID]])
    mockWindow.showQuickPick.mockImplementation(async (items: any[]) =>
      items.find(i => i.value === "QAS")
    )
    await commandHandler("abapfs.notebookSetCellSystem")(cell)
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(0, { system: "QAS" })
  })

  test("picker: connected first, then the current system, then not connected; no free text", async () => {
    const cells = makeNotebook([[SQL_LANGUAGE_ID, { system: "dev" }], [SQL_LANGUAGE_ID]])
    let shown: any[] = []
    mockWindow.showQuickPick.mockImplementation(async (items: any[]) => {
      shown = items
      return undefined
    })
    await commandHandler("abapfs.notebookSetCellSystem")(cells[0])
    expect(
      shown.map(i => (i.kind === -1 ? `--${i.label}` : `${i.label}|${i.description ?? ""}`))
    ).toEqual([
      "--Connected",
      "prd|",
      "dev|current",
      "--Not connected",
      "QAS|not connected",
      "TST|not connected",
      "--",
      "$(close) Remove the system marker from this cell|"
    ])
    // a cell that inherits its system: the inherited one is current, nothing to remove
    await commandHandler("abapfs.notebookSetCellSystem")(cells[1])
    expect(shown.map(i => i.label)).toEqual([
      "Connected",
      "prd",
      "dev",
      "Not connected",
      "QAS",
      "TST"
    ])
    expect(vscode.NotebookEdit.updateCellMetadata).not.toHaveBeenCalled()
  })

  test("setCellSystem can remove a marker", async () => {
    const [cell] = makeNotebook([[SQL_LANGUAGE_ID, { system: "DEV", name: "a" }]])
    mockWindow.showQuickPick.mockImplementation(async (items: any[]) =>
      items.find(i => i.action === "clear")
    )
    await commandHandler("abapfs.notebookSetCellSystem")(cell)
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(0, { name: "a" })
  })

  test("non-SQL cells: no picker; a leftover marker is removed", async () => {
    const cells = makeNotebook([["javascript"], ["markdown", { system: "DEV" }]])
    await commandHandler("abapfs.notebookSetCellSystem")(cells[0])
    expect(mockWindow.showQuickPick).not.toHaveBeenCalled()
    expect(mockWindow.showInformationMessage).toHaveBeenCalledWith(
      "System markers apply to ABAP SQL cells only."
    )
    await commandHandler("abapfs.notebookSetCellSystem")(cells[1])
    expect(mockWindow.showQuickPick).not.toHaveBeenCalled()
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(1, {})
  })
})
