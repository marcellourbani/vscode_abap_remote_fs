/**
 * Controller: system-per-cell routing, single run-plan confirmation, named references,
 * results that survive inserting cells.
 */
const h = vi.hoisted(() => ({
  executeHandler: undefined as any,
  outputs: new Map<number, any[]>(),
  ok: new Map<number, boolean>(),
  connected: new Set(["dev", "qas"]),
  cellsRef: [] as any[]
}))

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    showWarningMessage: vi.fn(async () => "Yes, run"),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn()
  }
}))
vi.mock("../lib", () => ({ log: Object.assign(vi.fn(), { debug: vi.fn() }) }))
vi.mock("../config", () => ({
  formatKey: (s: string) => s.toLowerCase(),
  connectedRoots: () => new Map([...h.connected].map(k => [k, {}]))
}))
vi.mock("../adt/conections", () => ({
  getOrCreateClient: vi.fn(async (id: string) => ({ id }))
}))
vi.mock("./connectionResolver", () => ({
  resolveConnection: vi.fn(async () => ({ connectionId: "picked", client: { id: "picked" } })),
  NotebookConnectionError: class extends Error {}
}))
vi.mock("./sqlCellExecutor", () => ({
  executeSqlCell: vi.fn(
    async (
      code: string,
      client: any,
      idx: number,
      results: Map<number, any>,
      _m: any,
      names: Map<string, number>
    ) => {
      // echo which system ran it, and resolve ${cells.<name>} to prove names work
      const ref = /\$\{cells\.(\w+)\.result\}/.exec(code)
      const refVal = ref ? results.get(names.get(ref[1])!)?.result : undefined
      return { result: [{ SYS: client.id, IDX: idx, REF: JSON.stringify(refVal ?? null) }] }
    }
  )
}))
vi.mock("./jsCellExecutor", () => ({
  executeJsCell: vi.fn(async (_code: string, idx: number) => ({ result: [{ js: idx }] }))
}))
vi.mock("vscode", () => ({
  NotebookCellKind: { Markup: 1, Code: 2 },
  notebooks: {
    createNotebookController: vi.fn(() => ({
      set executeHandler(fn: any) {
        h.executeHandler = fn
      },
      set interruptHandler(_fn: any) {},
      createNotebookCellExecution: (cell: any) => ({
        token: {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose() {} })
        },
        start() {},
        end(ok: boolean) {
          h.ok.set(cell.index, ok)
        },
        replaceOutput(o: any[]) {
          h.outputs.set(cell.index, o)
        },
        executionOrder: 0
      }),
      dispose() {}
    }))
  },
  window: { showErrorMessage: vi.fn() },
  workspace: {
    getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
    applyEdit: vi.fn(async (e: any) => {
      for (const [, edits] of e.sets)
        for (const ed of edits) h.cellsRef[ed.index].metadata = ed.meta
      return true
    })
  },
  WorkspaceEdit: vi.fn(function (this: any) {
    this.sets = [] as any[]
    this.set = (uri: any, edits: any[]) => this.sets.push([uri, edits])
  }),
  NotebookEdit: { updateCellMetadata: (index: number, meta: any) => ({ index, meta }) },
  NotebookCellOutput: vi.fn(function (items: any[]) {
    return { items }
  }),
  NotebookCellOutputItem: { text: (t: string, mime: string) => ({ text: t, mime }) }
}))

import { AbapNotebookController } from "./abapNotebookController"
import { SQL_LANGUAGE_ID } from "./types"
import { funWindow } from "../services/funMessenger"
import { getOrCreateClient } from "../adt/conections"
import { resolveConnection } from "./connectionResolver"

let uriSeq = 0
function notebook(spec: Array<[string, Record<string, unknown>?, string?]>) {
  const nb: any = { uri: { toString: () => "file:///wb.sapwb" } }
  const cells = spec.map(([lang, metadata, code], index) => {
    const id = `cell-${++uriSeq}`
    return {
      index,
      kind: lang === "markdown" ? 1 : 2,
      metadata: metadata ?? {},
      notebook: nb,
      document: { languageId: lang, getText: () => code ?? "", uri: { toString: () => id } }
    }
  })
  nb.getCells = () => cells
  h.cellsRef = cells
  return { nb, cells }
}
const sysOf = (i: number) =>
  h.outputs.get(i)?.[0]?.items?.[0]?.text?.match(/<tbody><tr><td>([^<]+)<\/td>/)?.[1]

describe("controller: system per cell", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.outputs.clear()
    h.ok.clear()
    h.connected = new Set(["dev", "qas"])
    new AbapNotebookController()
  })

  test("Run All: cell 1 = DEV, cell 3 = QAS; one confirmation, no system picker", async () => {
    const { nb, cells } = notebook([
      ["markdown"],
      [SQL_LANGUAGE_ID, { system: "DEV" }],
      ["javascript"],
      [SQL_LANGUAGE_ID, { system: "QAS" }],
      [SQL_LANGUAGE_ID]
    ])
    await h.executeHandler(cells.slice(1), nb)
    expect([sysOf(1), sysOf(3), sysOf(4)]).toEqual(["dev", "qas", "qas"])
    expect(funWindow.showWarningMessage).toHaveBeenCalledTimes(1)
    const detail = (funWindow.showWarningMessage as any).mock.calls[0][1].detail
    expect(detail).toBe("Cells 1-2 -> DEV  (1 SQL)\nCells 3-4 -> QAS  (2 SQL)")
    expect(resolveConnection).not.toHaveBeenCalled()
    expect((getOrCreateClient as any).mock.calls.map((c: any[]) => c[0])).toEqual([
      "dev",
      "qas",
      "qas"
    ])
  })

  test("declining the plan runs nothing", async () => {
    ;(funWindow.showWarningMessage as any).mockResolvedValueOnce(undefined)
    const { nb, cells } = notebook([[SQL_LANGUAGE_ID, { system: "DEV" }], [SQL_LANGUAGE_ID]])
    await h.executeHandler(cells, nb)
    expect(h.outputs.size).toBe(0)
  })

  test("unknown marker: user maps it to a connected system, marker is saved, run continues", async () => {
    h.connected = new Set(["erp100"])
    ;(funWindow.showQuickPick as any).mockImplementation(async (items: any[]) => items[0])
    const { nb, cells } = notebook([
      [SQL_LANGUAGE_ID, { system: "DEV" }],
      [SQL_LANGUAGE_ID, { system: "QAS" }]
    ])
    await h.executeHandler(cells, nb)
    expect(funWindow.showQuickPick).toHaveBeenCalledTimes(2)
    expect(cells[0].metadata.system).toBe("erp100")
    expect(cells[1].metadata.system).toBe("erp100")
    expect([sysOf(0), sysOf(1)]).toEqual(["erp100", "erp100"])
  })

  test("unknown marker and user cancels: clear message naming what IS connected; nothing runs", async () => {
    h.connected = new Set(["erp100"])
    ;(funWindow.showQuickPick as any).mockResolvedValue(undefined)
    const { nb, cells } = notebook([
      [SQL_LANGUAGE_ID, { system: "DEV" }],
      [SQL_LANGUAGE_ID, { system: "QAS" }]
    ])
    await h.executeHandler(cells, nb)
    const msg = (funWindow.showErrorMessage as any).mock.calls[0][0]
    expect(msg).toMatch(/'DEV'.*not connected.*connected: erp100.*Click the marker/)
    expect(getOrCreateClient).not.toHaveBeenCalled()
    expect(h.ok.get(0)).toBe(false)
  })

  test("single cell with an assigned system runs without prompts", async () => {
    const { nb, cells } = notebook([[SQL_LANGUAGE_ID, { system: "QAS" }], [SQL_LANGUAGE_ID]])
    await h.executeHandler([cells[1]], nb)
    expect(sysOf(1)).toBe("qas")
    expect(funWindow.showWarningMessage).not.toHaveBeenCalled()
    expect(resolveConnection).not.toHaveBeenCalled()
  })

  test("cells without any system keep the old behaviour (ask once)", async () => {
    const { nb, cells } = notebook([[SQL_LANGUAGE_ID], [SQL_LANGUAGE_ID]])
    await h.executeHandler(cells, nb)
    expect(resolveConnection).toHaveBeenCalledTimes(1)
    expect([sysOf(0), sysOf(1)]).toEqual(["picked", "picked"])
  })

  test("named reference resolves, and results survive inserting a cell above", async () => {
    const { nb, cells } = notebook([
      [SQL_LANGUAGE_ID, { system: "DEV", name: "params" }],
      [SQL_LANGUAGE_ID, {}, "SELECT ${cells.params.result}"]
    ])
    const ctl = new AbapNotebookController()
    await h.executeHandler([cells[0]], nb)
    // insert a new cell at the top: every index shifts by one
    const inserted: any = {
      index: 0,
      kind: 2,
      metadata: {},
      notebook: nb,
      document: { languageId: "javascript", getText: () => "", uri: { toString: () => "new" } }
    }
    const shifted = [inserted, ...cells.map(c => ({ ...c, index: c.index + 1 }))]
    nb.getCells = () => shifted
    const view = ctl.getResultsView(nb)
    expect(view.nameToIndex.get("params")).toBe(1)
    expect(view.byIndex.has(1)).toBe(true) // params result moved with its cell
    expect(view.byIndex.has(0)).toBe(false)
  })
})
