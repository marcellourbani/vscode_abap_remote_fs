import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildFixture } from "./fixture-builder"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "helper-fixture-"))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe("generated file contents", () => {
  it("escapes commas, quotes, LF and bare CR without altering text identifiers", async () => {
    const file = await buildFixture(
      {
        format: "csv",
        filename: "example.csv",
        columns: ["A", "B"],
        rows: [
          ["00123", "a,b"],
          ['say "hi"', "line\nbreak"],
          ["bare\rreturn", 0]
        ]
      },
      {},
      root
    )
    expect(await readFile(file, "utf8")).toBe(
      'A,B\r\n00123,"a,b"\r\n"say ""hi""","line\nbreak"\r\n"bare\rreturn",0\r\n'
    )
  })
  it("substitutes repeated placeholders and resolves dates freshly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 0, 30, 12))
    const file = await buildFixture(
      {
        format: "csv",
        filename: "dates.csv",
        columns: ["Value"],
        rows: [["{{ key }}-{{key}}"], ["+2d"]],
        dateFormat: "YYYY-MM-DD"
      },
      { key: "sample" },
      root
    )
    expect(await readFile(file, "utf8")).toContain("sample-sample\r\n2030-02-01")
  })
  it("fails on missing context rather than writing literal placeholders", async () => {
    await expect(
      buildFixture(
        { format: "csv", filename: "bad.csv", columns: [], rows: [["{{missing}}"]] },
        {},
        root
      )
    ).rejects.toThrow(/no such key/)
  })
  it("writes a readable xlsx preserving string zeros and numeric cells", async () => {
    const file = await buildFixture(
      {
        format: "xlsx",
        filename: "example.xlsx",
        columns: ["Key", "Count"],
        rows: [["000123", 7]]
      },
      {},
      root
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(file)
    expect(workbook.worksheets[0].getCell("A2").value).toBe("000123")
    expect(workbook.worksheets[0].getCell("B2").value).toBe(7)
  })
})
