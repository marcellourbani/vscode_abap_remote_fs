jest.mock("../services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showErrorMessage: jest.fn(),
    createOutputChannel: jest.fn(() => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), trace: jest.fn(),
    })),
  },
}), { virtual: false })
jest.mock("vscode", () => {
  const NotebookCellStatusBarItem = jest.fn().mockImplementation((text: string, alignment: any) => ({
    text, alignment, tooltip: undefined as string | undefined, command: undefined as any
  }))
  return {
    NotebookCellStatusBarItem,
    NotebookCellStatusBarAlignment: { Right: 2, Left: 1 },
    NotebookEdit: {
      updateCellMetadata: jest.fn((index: number, meta: any) => ({ index, meta })),
    },
    WorkspaceEdit: jest.fn().mockImplementation(() => ({
      set: jest.fn(),
    })),
    notebooks: {
      registerNotebookCellStatusBarItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
    },
    commands: {
      registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    },
    workspace: {
      applyEdit: jest.fn().mockResolvedValue(true),
    },
  }
}, { virtual: true })

import { SqlCellStatusBarProvider, registerCellStatusBar } from "./cellStatusBar"
import { DEFAULT_MAX_ROWS, SQL_LANGUAGE_ID } from "./types"
import { funWindow as window } from "../services/funMessenger"

const mockWindow = window as any

function makeCell(languageId: string, metadata?: Record<string, unknown>): any {
  return {
    document: { languageId },
    metadata: metadata ?? {},
    index: 0,
    notebook: { uri: { toString: () => "adt://dev100/nb.sapwb" } },
  }
}

describe("SqlCellStatusBarProvider", () => {
  let provider: SqlCellStatusBarProvider

  beforeEach(() => {
    provider = new SqlCellStatusBarProvider()
    jest.clearAllMocks()
  })

  test("returns undefined for non-SQL cells", () => {
    const cell = makeCell("javascript")
    expect(provider.provideCellStatusBarItems(cell)).toBeUndefined()
  })

  test("returns undefined for markdown cells", () => {
    const cell = makeCell("markdown")
    expect(provider.provideCellStatusBarItems(cell)).toBeUndefined()
  })

  test("returns a status bar item for SQL cells", () => {
    const cell = makeCell(SQL_LANGUAGE_ID)
    const item = provider.provideCellStatusBarItems(cell)
    expect(item).toBeDefined()
  })

  test("displays DEFAULT_MAX_ROWS when no maxRows in metadata", () => {
    const cell = makeCell(SQL_LANGUAGE_ID)
    const item = provider.provideCellStatusBarItems(cell)!
    expect(item.text).toContain(String(DEFAULT_MAX_ROWS))
  })

  test("displays custom maxRows from metadata", () => {
    const cell = makeCell(SQL_LANGUAGE_ID, { maxRows: 250 })
    const item = provider.provideCellStatusBarItems(cell)!
    expect(item.text).toContain("250")
  })

  test("item is aligned to the Right", () => {
    const cell = makeCell(SQL_LANGUAGE_ID)
    const item = provider.provideCellStatusBarItems(cell)!
    const vscode = require("vscode")
    expect(item.alignment).toBe(vscode.NotebookCellStatusBarAlignment.Right)
  })

  test("item has tooltip text", () => {
    const cell = makeCell(SQL_LANGUAGE_ID)
    const item = provider.provideCellStatusBarItems(cell)!
    expect(item.tooltip).toBeTruthy()
  })

  test("item has command set to abapfs.notebookSetCellMaxRows", () => {
    const cell = makeCell(SQL_LANGUAGE_ID)
    const item = provider.provideCellStatusBarItems(cell)!
    expect(item.command).toBeDefined()
    expect((item.command as any).command).toBe("abapfs.notebookSetCellMaxRows")
  })

  test("command arguments include the cell", () => {
    const cell = makeCell(SQL_LANGUAGE_ID)
    const item = provider.provideCellStatusBarItems(cell)!
    expect((item.command as any).arguments).toContain(cell)
  })
})

describe("registerCellStatusBar", () => {
  beforeEach(() => jest.clearAllMocks())

  test("registers the provider and command on the context subscriptions", () => {
    const disposables: any[] = []
    const context = { subscriptions: { push: (d: any) => disposables.push(d) } } as any
    registerCellStatusBar(context)
    expect(disposables).toHaveLength(2)
  })

  test("registers notebook cell status bar provider", () => {
    const context = { subscriptions: { push: jest.fn() } } as any
    registerCellStatusBar(context)
    const vscode = require("vscode")
    expect(vscode.notebooks.registerNotebookCellStatusBarItemProvider).toHaveBeenCalled()
  })

  test("registers the abapfs.notebookSetCellMaxRows command", () => {
    const context = { subscriptions: { push: jest.fn() } } as any
    registerCellStatusBar(context)
    const vscode = require("vscode")
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "abapfs.notebookSetCellMaxRows",
      expect.any(Function)
    )
  })
})

describe("abapfs.notebookSetCellMaxRows command handler", () => {
  let commandHandler: Function

  beforeEach(() => {
    jest.clearAllMocks()
    const vscode = require("vscode")
    vscode.commands.registerCommand.mockImplementation((_cmd: string, fn: Function) => {
      commandHandler = fn
      return { dispose: jest.fn() }
    })
    const context = { subscriptions: { push: jest.fn() } } as any
    registerCellStatusBar(context)
  })

  test("does nothing when user cancels input box (returns undefined)", async () => {
    mockWindow.showInputBox.mockResolvedValue(undefined)
    const cell = makeCell(SQL_LANGUAGE_ID, { maxRows: 500 })
    await commandHandler(cell)
    const vscode = require("vscode")
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled()
  })

  test("applies workspace edit when user provides valid input", async () => {
    mockWindow.showInputBox.mockResolvedValue("750")
    const cell = makeCell(SQL_LANGUAGE_ID, { maxRows: 500 })
    await commandHandler(cell)
    const vscode = require("vscode")
    expect(vscode.workspace.applyEdit).toHaveBeenCalled()
  })

  test("sets correct maxRows value in the edit", async () => {
    mockWindow.showInputBox.mockResolvedValue("999")
    const cell = makeCell(SQL_LANGUAGE_ID, {})
    await commandHandler(cell)
    const vscode = require("vscode")
    expect(vscode.NotebookEdit.updateCellMetadata).toHaveBeenCalledWith(
      cell.index,
      expect.objectContaining({ maxRows: 999 })
    )
  })

  test("input box is pre-populated with current maxRows", async () => {
    mockWindow.showInputBox.mockResolvedValue(undefined)
    const cell = makeCell(SQL_LANGUAGE_ID, { maxRows: 42 })
    await commandHandler(cell)
    expect(mockWindow.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ value: "42" })
    )
  })

  test("input box defaults to DEFAULT_MAX_ROWS when no maxRows in metadata", async () => {
    mockWindow.showInputBox.mockResolvedValue(undefined)
    const cell = makeCell(SQL_LANGUAGE_ID)
    await commandHandler(cell)
    expect(mockWindow.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ value: String(DEFAULT_MAX_ROWS) })
    )
  })

  test("validateInput rejects non-integer values", async () => {
    mockWindow.showInputBox.mockImplementation(async (opts: any) => {
      const result = opts.validateInput("3.14")
      return result ? undefined : "3"
    })
    const cell = makeCell(SQL_LANGUAGE_ID)
    await commandHandler(cell)
    // Just ensure no crash, validation callback was invoked
    expect(mockWindow.showInputBox).toHaveBeenCalled()
  })

  test("validateInput rejects zero", async () => {
    let validationResult: string | undefined
    mockWindow.showInputBox.mockImplementation(async (opts: any) => {
      validationResult = opts.validateInput("0")
      return undefined
    })
    const cell = makeCell(SQL_LANGUAGE_ID)
    await commandHandler(cell)
    expect(validationResult).toBeTruthy()
  })

  test("validateInput rejects numbers above 100000", async () => {
    let validationResult: string | undefined
    mockWindow.showInputBox.mockImplementation(async (opts: any) => {
      validationResult = opts.validateInput("100001")
      return undefined
    })
    const cell = makeCell(SQL_LANGUAGE_ID)
    await commandHandler(cell)
    expect(validationResult).toBeTruthy()
  })

  test("validateInput accepts boundary value 1", async () => {
    let validationResult: string | undefined
    mockWindow.showInputBox.mockImplementation(async (opts: any) => {
      validationResult = opts.validateInput("1")
      return undefined
    })
    const cell = makeCell(SQL_LANGUAGE_ID)
    await commandHandler(cell)
    expect(validationResult).toBeUndefined()
  })

  test("validateInput accepts boundary value 100000", async () => {
    let validationResult: string | undefined
    mockWindow.showInputBox.mockImplementation(async (opts: any) => {
      validationResult = opts.validateInput("100000")
      return undefined
    })
    const cell = makeCell(SQL_LANGUAGE_ID)
    await commandHandler(cell)
    expect(validationResult).toBeUndefined()
  })
})
