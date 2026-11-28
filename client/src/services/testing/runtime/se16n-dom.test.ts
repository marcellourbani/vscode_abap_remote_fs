import type { SapSession } from "./sap-session"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isClipboardPromptOpen, isModalOpen, Se16nDriver } from "./se16n"

afterEach(() => vi.unstubAllGlobals())
function element(text: string, visible = true) {
  return {
    textContent: text,
    getBoundingClientRect: () => ({ width: visible ? 100 : 0, height: visible ? 40 : 0 }),
    getAttribute: () => null,
    style: { display: visible ? "block" : "none", visibility: "visible" }
  }
}
function dom(popups: ReturnType<typeof element>[], layer: unknown = null) {
  vi.stubGlobal("document", { querySelectorAll: () => popups, getElementById: () => layer })
  vi.stubGlobal("getComputedStyle", (node: { style: unknown }) => node.style)
}

describe("SE16N popup rendering variants", () => {
  it.each([true, false])("clipboard requires visibility=%s", visible => {
    dom([element("Clipboard Access", visible)])
    expect(isClipboardPromptOpen()).toBe(visible)
  })
  it("ignores unrelated popup content", () => {
    dom([element("Select values")])
    expect(isClipboardPromptOpen()).toBe(false)
    expect(isModalOpen()).toBe(true)
  })
  it("recognizes the classic block layer", () => {
    dom([], { style: { display: "block" } })
    expect(isModalOpen()).toBe(true)
  })
  it("does not count hidden popup shells", () => {
    dom([element("Selection", false)], { style: { display: "none" } })
    expect(isModalOpen()).toBe(false)
  })
})

describe("SE16N actual ALV DOM extraction", () => {
  function read(
    cells: { id: string; tagName: string; innerText: string; getAttribute: () => string }[]
  ) {
    vi.stubGlobal("document", { querySelectorAll: () => cells })
    const driver = new Se16nDriver({ raw: () => ({}) } as unknown as SapSession, {
      table: "MARA",
      outputFields: "*"
    })
    const internal = driver as unknown as {
      scope: { evaluate: (fn: () => unknown) => Promise<unknown> }
      readResultGrid(): Promise<{ fields: string[]; columns: string[]; rows: string[][] }>
    }
    internal.scope = { evaluate: async fn => fn() }
    return internal.readResultGrid()
  }
  const cell = (row: number, col: number, text: string, metadata = "", prefix = "dynamic") => ({
    id: `grid#${prefix}#${row},${col}`,
    tagName: "TD",
    innerText: text,
    getAttribute: () => metadata
  })
  it.each(['{"SID":"wnd[0]/usr/grid/colMATNR"}', "{SID:'wnd[0]/usr/grid/colMATNR'}"])(
    "reads technical field from metadata variant %s",
    async metadata => {
      const result = await read([cell(0, 1, "Material\nMat.", metadata), cell(1, 1, "000123")])
      expect(result).toEqual({ fields: ["MATNR"], columns: ["Material"], rows: [["000123"]] })
    }
  )
  it("preserves actual output order and ignores selector column/non-cell nodes", async () => {
    const result = await read([
      cell(0, 0, "Select"),
      cell(0, 2, "Material", '{"SID":"x/colMATNR"}'),
      cell(0, 1, "Type", '{"SID":"x/colMTART"}'),
      cell(2, 2, "B"),
      cell(1, 2, "A"),
      cell(1, 1, "FERT"),
      { ...cell(9, 9, "noise"), tagName: "SPAN" }
    ])
    expect(result.fields).toEqual(["MTART", "MATNR"])
    expect(result.rows).toEqual([
      ["FERT", "A"],
      ["", "B"]
    ])
  })
  it("does not invent technical names from display captions", async () => {
    const result = await read([cell(0, 1, "Material"), cell(1, 1, "A")])
    expect(result.fields).toEqual([""])
  })
})
