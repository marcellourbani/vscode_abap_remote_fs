import { describe, expect, it, vi } from "vitest"
import { runSe16n, Se16nDriver, type Se16nSpec, type Se16nValue } from "./se16n"
import type { SapSession } from "./sap-session"

// Exercise driver decisions directly. Only browser/SAP boundaries are replaced;
// validation, operator lookup, comparisons, and assertions are production code.
function driver(spec: Partial<Se16nSpec> = {}) {
  const sap = { raw: vi.fn(() => ({})), openTx: vi.fn() }
  const value = new Se16nDriver(sap as unknown as SapSession, {
    table: "MARA",
    outputFields: ["MATNR"],
    ...spec
  })
  return {
    sap,
    value: value as unknown as {
      validateSpec(): void
      wantedFields(): string[]
      optionKey(value: Se16nValue): string
      valuesMatch(written: string, echoed: string): boolean
      assertExpectations(result: { hits: number; message: string }): void
      assertOutputFields(fields: string[]): void
    }
  }
}

describe("SE16N preflight", () => {
  it.each([
    { outputFields: [""] },
    { outputFields: ["   "] },
    { outputFields: ["MANDT"] },
    { where: [{ field: "MANDT", low: "100" }] },
    { where: [{ field: "", low: "x" }] },
    { where: [{ field: "MATNR" }] },
    { where: [{ field: "MATNR", low: "a", high: "b", option: "EQ" }] },
    { where: [{ field: "MATNR", values: [{ low: "a", option: "BAD" }] }] }
  ])("rejects unsafe input before opening SAP: %j", async spec => {
    const { sap } = driver()
    await expect(
      runSe16n(
        sap as unknown as SapSession,
        {
          table: "MARA",
          outputFields: ["MATNR"],
          ...spec
        } as Se16nSpec
      )
    ).rejects.toThrow()
    expect(sap.openTx).not.toHaveBeenCalled()
  })

  it("deduplicates requested/filter fields case-insensitively", () => {
    expect(
      driver({
        outputFields: ["matnr", "MTART", "MATNR"],
        where: [{ field: "mtart", low: "X" }]
      }).value.wantedFields()
    ).toEqual(["MATNR", "MTART"])
  })

  it.each(["EQ", "NE", "BT", "NB", "CP", "NP", "GT", "LT", "GE", "LE"] as const)(
    "resolves include and exclude %s independently",
    option => {
      const { value } = driver()
      for (const sign of ["I", "E"] as const) {
        expect(value.optionKey({ low: "x", option, sign })).toBe(`${sign}:${option}`)
      }
    }
  )

  it("defaults to EQ or BT, without mutating the caller", () => {
    const { value } = driver()
    const input = { low: "a", high: "z" }
    expect(value.optionKey(input)).toBe("I:BT")
    expect(value.optionKey({ low: "a" })).toBe("I:EQ")
    expect(input).toEqual({ low: "a", high: "z" })
  })
})

describe("SE16N criterion echo comparison across user formats", () => {
  it.each([
    ["0", " 0.000 "],
    ["1234.56", "1.234,56"],
    ["1234.56", "1,234.56"],
    ["000012", "12"],
    ["-12.5", "-12,50"],
    ["ABC", " ABC "],
    ["", "   "]
  ])("accepts equivalent %s / %s", (written, echoed) => {
    expect(driver().value.valuesMatch(written, echoed)).toBe(true)
  })
  it.each([
    ["8", "18"],
    ["80", "8"],
    ["", "0"],
    ["ABC", "ABCD"],
    ["12.5", "12.6"],
    ["1", "NaN"],
    ["1", ""],
    ["-1", "1"]
  ])("rejects changed values %s / %s", (written, echoed) => {
    expect(driver().value.valuesMatch(written, echoed)).toBe(false)
  })
})

describe("SE16N assertions", () => {
  it.each([
    [{ exactRows: 1 }, 0],
    [{ minRows: 2 }, 1],
    [{ maxRows: 2 }, 3],
    [{ empty: true }, 1]
  ])("rejects wrong count %j / %s", (expectation, hits) => {
    expect(() =>
      driver({ expect: expectation }).value.assertExpectations({ hits, message: "Example status" })
    ).toThrow(/Example status/)
  })
  it.each([
    [{ exactRows: 0 }, 0],
    [{ minRows: 2, maxRows: 2 }, 2],
    [{ empty: true }, 0],
    [{}, 10]
  ])("accepts boundary count %j / %s", (expectation, hits) => {
    expect(() =>
      driver({ expect: expectation }).value.assertExpectations({ hits, message: "" })
    ).not.toThrow()
  })
  it("uses technical fields, not display order, and refuses missing columns", () => {
    const { value } = driver({ outputFields: ["MATNR", "MTART"] })
    expect(() => value.assertOutputFields(["mtart", "matnr"])).not.toThrow()
    expect(() => value.assertOutputFields(["MATNR", "Material Type"])).toThrow(/MTART/)
    expect(() => value.assertOutputFields([])).toThrow(/missing/)
    expect(() => driver({ outputFields: "*" }).value.assertOutputFields([])).not.toThrow()
  })
})
