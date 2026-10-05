vi.mock("../config", () => ({
  formatKey: (s: string) => s.toLowerCase(),
  connectedRoots: vi.fn(() => new Map([["dev", {}]])),
  getConfig: vi.fn(() => ({ get: () => ({ DEV: {}, QAS: {}, qas: {} }) }))
}))
vi.mock("vscode", () => ({
  NotebookCellKind: { Markup: 1, Code: 2 },
  NotebookEdit: {
    updateCellMetadata: vi.fn((index: number, meta: any) => ({ index, meta }))
  },
  WorkspaceEdit: vi.fn().mockImplementation(function (this: any) {
    this.set = vi.fn((_uri: any, edits: any[]) => (this.edits = edits))
  }),
  workspace: { applyEdit: vi.fn().mockResolvedValue(true) }
}))

import * as vscode from "vscode"
import {
  applyCellPatches,
  cellsReferencingName,
  effectiveSystems,
  isSystemConnected,
  knownSystems,
  patchMetadata,
  validateMaxRows
} from "./cellMetadata"
import { SQL_LANGUAGE_ID } from "./types"

function notebook(spec: Array<[string, Record<string, unknown>?, string?]>): any {
  const nb: any = { uri: "file:///nb.sapwb" }
  const cells = spec.map(([lang, metadata, text], index) => ({
    kind: lang === "markdown" ? 1 : 2,
    document: { languageId: lang, getText: () => text ?? "" },
    metadata: metadata ?? {},
    index,
    notebook: nb
  }))
  nb.getCells = () => cells
  return nb
}

describe("cell metadata helpers", () => {
  test("patchMetadata sets, keeps and removes keys", () => {
    expect(patchMetadata({ name: "a", maxRows: 5 }, { system: "DEV", name: undefined })).toEqual({
      maxRows: 5,
      system: "DEV"
    })
    expect(patchMetadata(undefined, { name: "" })).toEqual({})
  })

  test("validateMaxRows", () => {
    expect(validateMaxRows(1)).toBeUndefined()
    expect(validateMaxRows(100_000)).toBeUndefined()
    for (const bad of [0, 100_001, 1.5, "10", undefined]) expect(validateMaxRows(bad)).toBeDefined()
  })

  test("known systems: connected and configured, without case duplicates", () => {
    expect(knownSystems()).toEqual(["QAS", "dev"])
    expect(isSystemConnected("DEV")).toBe(true)
    expect(isSystemConnected("QAS")).toBe(false)
  })

  test("effective systems ignore non-SQL cells", () => {
    const nb = notebook([
      ["markdown", { system: "X" }],
      [SQL_LANGUAGE_ID, { system: "DEV" }]
    ])
    expect(effectiveSystems(nb)).toEqual([{}, { system: "DEV", from: 1 }])
    // preview a change: remove the marker on #1, add one on #0 (ignored: not SQL)
    const preview = new Map<number, string | undefined>([
      [0, "QAS"],
      [1, undefined]
    ])
    expect(effectiveSystems(nb, preview)).toEqual([{}, {}])
  })

  test("applyCellPatches makes one edit for several cells", async () => {
    const nb = notebook([
      [SQL_LANGUAGE_ID, { name: "a" }],
      [SQL_LANGUAGE_ID, { system: "DEV", maxRows: 50 }]
    ])
    await applyCellPatches(nb, [
      { index: 0, patch: { system: "QAS" } },
      { index: 1, patch: { system: undefined } }
    ])
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1)
    const edit = (vscode.workspace.applyEdit as any).mock.calls[0][0]
    expect(edit.edits).toEqual([
      { index: 0, meta: { name: "a", system: "QAS" } },
      { index: 1, meta: { maxRows: 50 } }
    ])
    expect(await applyCellPatches(nb, [])).toBe(false)
  })

  test("cellsReferencingName finds JS and SQL references, not look-alikes", () => {
    const nb = notebook([
      [SQL_LANGUAGE_ID, { name: "t000" }, "SELECT * FROM t000"],
      ["javascript", {}, "return cells.t000.result"],
      [SQL_LANGUAGE_ID, {}, "SELECT * FROM x WHERE a = ${cells.t000.result.MANDT}"],
      ["javascript", {}, "return cells.t0001.result"],
      ["markdown", {}, "cells.t000"]
    ])
    expect(cellsReferencingName(nb, "t000", 0).map((c: any) => c.index)).toEqual([1, 2])
  })
})
