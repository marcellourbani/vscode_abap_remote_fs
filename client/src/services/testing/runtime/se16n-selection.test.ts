import type { SapSession } from "./sap-session"
import { describe, expect, it, vi } from "vitest"
import { runSe16n, Se16nDriver, type Se16nCriterion, type Se16nSpec } from "./se16n"

function setup(spec: Partial<Se16nSpec> = {}) {
  const sap = {
    raw: () => ({}),
    openTx: vi.fn(),
    contentScope: vi.fn(async () => ({})),
    note: vi.fn()
  }
  const value = new Se16nDriver(sap as unknown as SapSession, {
    table: "MARA",
    outputFields: ["MATNR"],
    ...spec
  })
  const internal = value as unknown as {
    run(): Promise<unknown>
    applyCriterion(c: Se16nCriterion): Promise<void>
    loc: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    placeFields: ReturnType<typeof vi.fn>
    setOutputColumns: ReturnType<typeof vi.fn>
    fieldRow: Map<string, number>
    setHeaderField: ReturnType<typeof vi.fn>
    execute: ReturnType<typeof vi.fn>
  }
  const events: string[] = []
  const locator = {
    first: () => locator,
    last: () => locator,
    count: async () => 1,
    waitFor: vi.fn(async () => {})
  }
  internal.loc = vi.fn(() => locator)
  internal.reset = vi.fn(async () => {
    events.push("reset")
  })
  internal.placeFields = vi.fn(async () => {
    events.push("place")
  })
  internal.setOutputColumns = vi.fn(async () => {
    events.push("output")
  })
  internal.applyCriterion = vi.fn(async c => {
    events.push(c.field)
  })
  internal.setHeaderField = vi.fn()
  internal.execute = vi.fn(async () => ({ hits: 7 }))
  return { sap, internal, events }
}

describe("SE16N run sequencing", () => {
  it("resets before selecting output or applying criteria, then executes exactly once", async () => {
    const { internal, events, sap } = setup({
      where: [{ field: "MTART", low: "FERT" }],
      maxHits: 7
    })
    expect(await internal.run()).toEqual({ hits: 7 })
    expect(events).toEqual(["reset", "place", "output", "MTART"])
    expect(sap.openTx).toHaveBeenCalledWith("SE16N", { captureEvidence: false })
    expect(internal.setHeaderField).toHaveBeenCalledWith("txtGD-MAX_LINES", "7")
    expect(internal.execute).toHaveBeenCalledOnce()
    expect(sap.note).toHaveBeenCalledWith("SE16N MARA: selection criteria")
  })
  it("orders criteria by actual located row without reordering caller input", async () => {
    const where = [
      { field: "MTART", low: "FERT" },
      { field: "MATNR", low: "1" }
    ]
    const { internal, events } = setup({ where })
    internal.fieldRow = new Map([
      ["MATNR", 1],
      ["MTART", 20]
    ])
    await internal.run()
    expect(events.slice(-2)).toEqual(["MATNR", "MTART"])
    expect(where.map(c => c.field)).toEqual(["MTART", "MATNR"])
  })
  it("stops on reset failure rather than running with remembered criteria", async () => {
    const { internal } = setup()
    internal.reset.mockRejectedValue(new Error("Reset failed"))
    await expect(internal.run()).rejects.toThrow("Reset failed")
    expect(internal.execute).not.toHaveBeenCalled()
    expect(internal.setOutputColumns).not.toHaveBeenCalled()
  })
  it("stops on a rejected criterion without producing result evidence", async () => {
    const { internal, sap } = setup({ where: [{ field: "MATNR", low: "1" }] })
    vi.mocked(internal.applyCriterion).mockRejectedValue(new Error("Value did not stick"))
    await expect(internal.run()).rejects.toThrow("Value did not stick")
    expect(internal.execute).not.toHaveBeenCalled()
    expect(sap.note).not.toHaveBeenCalled()
  })
  it("allows criteria screenshot opt-out, retaining real criteria and execution", async () => {
    const { internal, sap } = setup({
      evidence: { criteria: false },
      where: [{ field: "MATNR", low: "1" }]
    })
    await internal.run()
    expect(internal.applyCriterion).toHaveBeenCalledOnce()
    expect(internal.execute).toHaveBeenCalledOnce()
    expect(sap.note).not.toHaveBeenCalled()
  })
})

describe("SE16N malformed bounds must fail before touching SAP", () => {
  it.each([-1, 1.5, NaN, Infinity])("rejects invalid maxHits %s", async maxHits => {
    const { sap } = setup()
    await expect(
      runSe16n(sap as unknown as SapSession, { table: "MARA", outputFields: ["MATNR"], maxHits })
    ).rejects.toThrow(/maxHits/)
    expect(sap.openTx).not.toHaveBeenCalled()
  })
  it.each(["exactRows", "minRows", "maxRows"] as const)(
    "rejects negative expectation %s",
    async name => {
      const { sap } = setup()
      await expect(
        runSe16n(sap as unknown as SapSession, {
          table: "MARA",
          outputFields: ["MATNR"],
          expect: { [name]: -1 }
        })
      ).rejects.toThrow(/expect/)
      expect(sap.openTx).not.toHaveBeenCalled()
    }
  )
  it("rejects mutually impossible count bounds", async () => {
    const { sap } = setup()
    await expect(
      runSe16n(sap as unknown as SapSession, {
        table: "MARA",
        outputFields: ["MATNR"],
        expect: { minRows: 4, maxRows: 2 }
      })
    ).rejects.toThrow(/expect/)
    expect(sap.openTx).not.toHaveBeenCalled()
  })
})
