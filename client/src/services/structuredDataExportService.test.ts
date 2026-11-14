import {
  buildCsv,
  buildXlsx,
  EXCEL_MAX_DATA_ROWS,
  formatExportCell
} from "./structuredDataExportService"
import { vi } from "vitest"

vi.mock("exceljs", () => ({
  Workbook: vi.fn().mockImplementation(() => ({
    addWorksheet: vi.fn(() => ({
      addRow: vi.fn(() => ({ eachCell: vi.fn() }))
    })),
    xlsx: { writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }
  }))
}))

describe("structuredDataExportService", () => {
  test.each(["America/Sao_Paulo", "UTC", "Asia/Kolkata"])(
    "reads a stringified ADT date back as the same day in %s",
    timeZone => {
      const original = process.env.TZ
      process.env.TZ = timeZone
      try {
        const date = new Date("2024-12-05T00:00:00.000Z")
        expect(formatExportCell(date.toString(), "D")).toBe("05-12-2024")
        expect(formatExportCell(date, "D")).toBe("05-12-2024")
      } finally {
        if (original === undefined) delete process.env.TZ
        else process.env.TZ = original
      }
    }
  )

  it("preserves character values and formats SAP dates and times", () => {
    expect(formatExportCell("00001234", "C")).toBe("00001234")
    expect(formatExportCell("20260918", "D")).toBe("18-09-2026")
    expect(formatExportCell("081530", "T")).toBe("08:15:30")
  })

  it("writes UTF-8 BOM CSV with escaped values", () => {
    const bytes = buildCsv(
      [{ name: "ID" }, { name: "TEXT", header: "Useful Text" }],
      [{ ID: "0001", TEXT: 'A,"B"' }]
    )
    const text = new TextDecoder().decode(bytes)
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(text).toMatch(/^ID,Useful Text/)
    expect(text).toContain('0001,"A,""B"""')
  })

  it("rejects XLSX beyond the worksheet data-row limit", async () => {
    const rows = new Array(EXCEL_MAX_DATA_ROWS + 1) as Array<Record<string, unknown>>
    await expect(buildXlsx([{ name: "ID" }], rows)).rejects.toThrow(/export CSV/)
  })
})
