/** Controller: named references and results that survive inserting cells. */
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
describe("controller: named cells", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.outputs.clear()
    h.ok.clear()
    new AbapNotebookController()
  })

  test("named reference resolves, and results survive inserting a cell above", async () => {
    const { nb, cells } = notebook([
      [SQL_LANGUAGE_ID, { name: "params" }],
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
