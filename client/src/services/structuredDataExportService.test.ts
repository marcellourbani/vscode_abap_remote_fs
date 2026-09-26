import {
  buildCsv,
  buildXlsx,
  EXCEL_MAX_DATA_ROWS,
  formatExportCell
} from "./structuredDataExportService"

jest.mock("exceljs", () => ({
  Workbook: jest.fn().mockImplementation(() => ({
    addWorksheet: jest.fn(() => ({
      addRow: jest.fn(() => ({ eachCell: jest.fn() }))
    })),
    xlsx: { writeBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)) }
  }))
}))

describe("structuredDataExportService", () => {
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
