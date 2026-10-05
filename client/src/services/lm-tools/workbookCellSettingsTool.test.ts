const h = vi.hoisted(() => ({
  notebook: undefined as any,
  existing: new Set<string>(),
  applied: [] as any[]
}))

vi.mock("vscode", () => {
  const uri = (fsPath: string, scheme = "file") => ({ scheme, fsPath, toString: () => fsPath })
  return {
    LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
      return { parts }
    }),
    LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
      return { text }
    }),
    NotebookCellKind: { Markup: 1, Code: 2 },
    NotebookEdit: {
      updateCellMetadata: vi.fn((index: number, meta: any) => ({ index, meta }))
    },
    WorkspaceEdit: vi.fn().mockImplementation(function (this: any) {
      this.set = vi.fn((_u: any, edits: any[]) => (this.edits = edits))
    }),
    Uri: {
      file: vi.fn((p: string) => uri(p)),
      parse: vi.fn((p: string) => uri(p.replace(/^file:\/\//, ""), p.split(":")[0])),
      joinPath: vi.fn((base: any, p: string) => uri(`${base.fsPath}/${p}`, base.scheme))
    },
    workspace: {
      workspaceFolders: [
        { uri: { scheme: "adt", fsPath: "/dev100" } },
        { uri: { scheme: "file", fsPath: "/ws" } }
      ],
      fs: {
        stat: vi.fn(async (u: any) => {
          if (!h.existing.has(u.fsPath)) throw new Error("ENOENT")
          return {}
        })
      },
      openNotebookDocument: vi.fn(async () => h.notebook),
      applyEdit: vi.fn(async (edit: any) => {
        // apply to the fake notebook so the tool's final listing shows the new state
        for (const e of edit.edits) h.notebook.getCells()[e.index].metadata = e.meta
        h.applied.push(edit.edits)
        return true
      })
    }
  }
})
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(() => ({ dispose: vi.fn() }))
}))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("../../config", () => ({
  formatKey: (s: string) => s.toLowerCase(),
  connectedRoots: vi.fn(
    () =>
      new Map([
        ["sys1", {}],
        ["sys2", {}]
      ])
  ),
  getConfig: vi.fn(() => ({ get: () => ({ SYS1: {}, SYS2: {}, SYS3: {} }) }))
}))

import { WorkbookCellSettingsTool, resolveWorkbookUri } from "./workbookCellSettingsTool"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { logTelemetry } from "../telemetry"

type Spec = [string, Record<string, unknown>?, string?]

function makeNotebook(spec: Spec[], dirty = false) {
  const nb: any = {
    uri: { fsPath: "/ws/t.sapwb" },
    notebookType: "sap-data-workbook",
    isDirty: dirty,
    save: vi.fn(async () => true)
  }
  const cells = spec.map(([lang, metadata, text], index) => ({
    kind: lang === "markdown" ? 1 : 2,
    document: { languageId: lang, getText: () => text ?? "" },
    metadata: metadata ?? {},
    index,
    notebook: nb
  }))
  nb.getCells = () => cells
  nb.cellCount = cells.length
  return nb
}

// reviewer's scenario: T000 on three systems, totalled in a JS cell
const t000 = (): Spec[] => [
  ["markdown", {}, "# Clients in SYS1, SYS2 and SYS3"],
  ["abap-sql", {}, "SELECT mandt, mtext FROM t000"],
  ["abap-sql", {}, "SELECT mandt, mtext FROM t000"],
  ["abap-sql", {}, "SELECT mandt, mtext FROM t000"],
  ["javascript", {}, "return [cells[1], cells[2], cells[3]]"]
]

const tool = new WorkbookCellSettingsTool()
const run = async (input: any) => {
  const r: any = await tool.invoke({ input, toolInvocationToken: {} } as any, {} as any)
  return r.parts[0].text as string
}
const meta = () => h.notebook.getCells().map((c: any) => c.metadata)

beforeEach(() => {
  vi.clearAllMocks()
  h.applied = []
  h.existing = new Set(["/ws/wb/t.sapwb"])
  h.notebook = makeNotebook(t000())
})

describe("resolveWorkbookUri", () => {
  test("rejects other extensions", async () => {
    await expect(resolveWorkbookUri("/ws/t.ipynb")).rejects.toThrow(/\.sapwb extension/)
    await expect(resolveWorkbookUri("")).rejects.toThrow(/filePath is required/)
  })
  test("absolute, Windows, URI and workspace-relative paths", async () => {
    expect((await resolveWorkbookUri("/ws/t.sapwb")).fsPath).toBe("/ws/t.sapwb")
    expect((await resolveWorkbookUri("C:\\BOB\\t.SAPWB")).fsPath).toBe("C:\\BOB\\t.SAPWB")
    expect((await resolveWorkbookUri("file:///ws/t.sapwb")).scheme).toBe("file")
    expect((await resolveWorkbookUri("wb/t.sapwb")).fsPath).toBe("/ws/wb/t.sapwb")
    await expect(resolveWorkbookUri("nope/t.sapwb")).rejects.toThrow(/not found/)
  })
})

describe("WorkbookCellSettingsTool", () => {
  test("checks authorization and logs telemetry", async () => {
    await run({ filePath: "/ws/t.sapwb" })
    expect(assertToolInvocationAuthorized).toHaveBeenCalled()
    expect(logTelemetry).toHaveBeenCalledWith("tool_workbook_cell_settings_called")
  })

  test("prepareInvocation describes read and update", async () => {
    const msg = async (input: any) =>
      ((await tool.prepareInvocation({ input } as any, {} as any)) as any).invocationMessage
    expect(await msg({ filePath: "/x/t.sapwb" })).toBe("Reading cell settings of t.sapwb")
    expect(await msg({ filePath: "/x/t.sapwb", cells: [{ index: 1 }] })).toBe(
      "Updating settings of 1 cell(s) in t.sapwb"
    )
  })

  test("read: every cell with its settings, nothing changed", async () => {
    h.notebook = makeNotebook([
      ["markdown", { system: "SYS1" }, "# Title"],
      ["abap-sql", { system: "SYS1", name: "a", maxRows: 50 }, "SELECT 1"],
      ["javascript", {}, "\n  return 1"],
      ["abap-sql", {}, "SELECT 2"],
      ["abap-sql", { system: "SYS3" }, "SELECT 3"]
    ])
    const text = await run({ filePath: "/ws/t.sapwb" })
    expect(text).toBe(
      [
        "Workbook: /ws/t.sapwb (5 cells)",
        "Cells:",
        `#0 markdown | system marker 'SYS1' is ignored (not an ABAP SQL cell; clear it) | "# Title"`,
        `#1 abap-sql | name: a | system: SYS1 (marker) | maxRows: 50 | "SELECT 1"`,
        `#2 javascript | "  return 1"`,
        `#3 abap-sql | system: SYS1 (from #1) | maxRows: 1000 | "SELECT 2"`,
        `#4 abap-sql | system: SYS3 (marker, not connected) | maxRows: 1000 | "SELECT 3"`
      ].join("\n")
    )
    expect(h.applied).toEqual([])
  })

  test("update: reviewer's T000 workbook in one call, one edit, saved", async () => {
    const text = await run({
      filePath: "/ws/t.sapwb",
      cells: [
        { index: 1, system: "SYS1", name: "sys1" },
        { index: 2, system: "SYS2" },
        { index: 3, system: "SYS3", maxRows: 5000 }
      ]
    })
    expect(h.applied).toHaveLength(1)
    expect(meta()).toEqual([
      {},
      { system: "SYS1", name: "sys1" },
      { system: "SYS2" },
      { system: "SYS3", maxRows: 5000 },
      {}
    ])
    expect(h.notebook.save).toHaveBeenCalled()
    expect(text).toContain("Changed:\n- Cell #1: name sys1, system SYS1\n- Cell #2: system SYS2")
    expect(text).toContain("Saved.")
    expect(text).toContain(
      "Warnings:\n- Cell #3: system 'SYS3' is configured but not connected. Saved anyway"
    )
    expect(text).toContain(`#3 abap-sql | system: SYS3 (marker, not connected) | maxRows: 5000`)
  })

  test("an unsaved workbook is not saved", async () => {
    h.notebook = makeNotebook(t000(), true)
    const text = await run({ filePath: "/ws/t.sapwb", cells: [{ index: 1, system: "SYS1" }] })
    expect(h.notebook.save).not.toHaveBeenCalled()
    expect(text).toContain("Not saved: the workbook has other unsaved changes")
  })

  test("clearSystem: the cell inherits the marker above; reviewer's remove-the-middle case", async () => {
    h.notebook = makeNotebook([
      ["abap-sql", { system: "SYS1" }],
      ["abap-sql", { system: "SYS2", maxRows: 10 }],
      ["abap-sql", { system: "SYS3" }],
      ["javascript"]
    ])
    const text = await run({ filePath: "/ws/t.sapwb", cells: [{ index: 1, clearSystem: true }] })
    expect(meta()[1]).toEqual({ maxRows: 10 })
    expect(text).toContain("#1 abap-sql | system: SYS1 (from #0) | maxRows: 10")
    expect(text).toContain("#2 abap-sql | system: SYS3 (marker, not connected)")
  })

  test("clearSystem removes a marker left on a JavaScript cell", async () => {
    h.notebook = makeNotebook([["javascript", { system: "SYS1" }]])
    await run({ filePath: "/ws/t.sapwb", cells: [{ index: 0, clearSystem: true }] })
    expect(meta()[0]).toEqual({})
  })

  test("unknown connection id: saved with a warning", async () => {
    const text = await run({ filePath: "/ws/t.sapwb", cells: [{ index: 1, system: "PRD" }] })
    expect(meta()[1]).toEqual({ system: "PRD" })
    expect(text).toContain("'PRD' is not a configured ABAP FS connection id. Saved anyway")
  })

  test("any invalid entry: nothing is changed and every problem is reported", async () => {
    h.notebook = makeNotebook([["abap-sql", { name: "taken" }], ...t000().slice(1)])
    const err = await run({
      filePath: "/ws/t.sapwb",
      cells: [
        { index: 1, system: "SYS1" }, // valid
        { index: 4, system: "SYS1" }, // JS cell
        { index: 4, maxRows: 10 }, // listed twice
        { index: 9, name: "x" }, // no such cell
        { index: 2 }, // no setting
        { index: 3, name: "taken" }, // duplicate name
        { index: 1, maxRows: 0 } // listed twice (index 1)
      ]
    }).catch((e: Error) => e.message)
    expect(err).toContain("Nothing was changed")
    expect(err).toContain("Cell #4 is a javascript cell: systems apply to ABAP SQL cells only.")
    expect(err).toContain("Cell #4 is listed more than once")
    expect(err).toContain("Cell #9: no such cell (the workbook has cells #0 to #4).")
    expect(err).toContain("Cell #2: give at least one of name, system, maxRows")
    expect(err).toContain("Name 'taken' would be used by cells #0, #3.")
    expect(h.applied).toEqual([])
  })

  test("field validation messages", async () => {
    const err = (cells: any[]) =>
      run({ filePath: "/ws/t.sapwb", cells }).catch((e: Error) => e.message)
    expect(await err([{ index: 1, name: "1abc" }])).toMatch(/invalid name '1abc'/)
    expect(await err([{ index: 1, name: "a", clearName: true }])).toMatch(
      /either name or clearName/
    )
    expect(await err([{ index: 1, system: "S", clearSystem: true }])).toMatch(/either system or/)
    expect(await err([{ index: 1, system: " " }])).toMatch(/use clearSystem/)
    expect(await err([{ index: 1, maxRows: 100_001 }])).toMatch(/invalid maxRows 100001/)
    expect(await err([{ index: 4, maxRows: 5 }])).toMatch(/row limits apply to ABAP SQL cells only/)
    expect(await err([{ index: 0, name: "" }])).toMatch(/Use clearName/)
  })

  test("swapping two names in one call is allowed", async () => {
    h.notebook = makeNotebook([
      ["abap-sql", { name: "a" }],
      ["abap-sql", { name: "b" }]
    ])
    await run({
      filePath: "/ws/t.sapwb",
      cells: [
        { index: 0, name: "b" },
        { index: 1, name: "a" }
      ]
    })
    expect(meta()).toEqual([{ name: "b" }, { name: "a" }])
  })

  test("renaming or clearing a referenced name warns which cells still use it", async () => {
    h.notebook = makeNotebook([
      ["abap-sql", { name: "src" }, "SELECT 1"],
      ["javascript", {}, "return cells.src.result"],
      ["abap-sql", {}, "SELECT * FROM t WHERE a = ${cells.src.result.A}"]
    ])
    const text = await run({ filePath: "/ws/t.sapwb", cells: [{ index: 0, name: "clients" }] })
    expect(text).toContain("Cells #1, #2 still reference cells.src; update them to cells.clients.")
    h.notebook.getCells()[0].metadata = { name: "src" }
    const cleared = await run({ filePath: "/ws/t.sapwb", cells: [{ index: 0, clearName: true }] })
    expect(cleared).toContain("Cells #1, #2 still reference cells.src; update them to cells[0].")
  })

  test("SQL cells left without a system are pointed out", async () => {
    h.notebook = makeNotebook([
      ["abap-sql", {}],
      ["abap-sql", {}]
    ])
    const text = await run({ filePath: "/ws/t.sapwb", cells: [{ index: 1, system: "SYS1" }] })
    expect(text).toContain("SQL cell #0 has no system and is asked for one when run.")
  })

  test("a file not opened as an SAP Data Workbook is rejected", async () => {
    h.notebook = { ...makeNotebook([]), notebookType: "jupyter-notebook" }
    await expect(run({ filePath: "/ws/t.sapwb" })).rejects.toThrow(
      /not open as an SAP Data Workbook/
    )
  })
})
