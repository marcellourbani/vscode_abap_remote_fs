import { describe, expect, it } from "vitest"
import { exportRows, issueColumns, usageColumns, usageExportName, usageIssueRows } from "./exports"
import type { UsageAnalysis } from "./types"
import { buildCsv, buildXlsx } from "../structuredDataExportService"
import * as ExcelJS from "exceljs"

describe("repository usage exports", () => {
  it("deduplicates input diagnostics and exports structured dependency issues to Excel and CSV", async () => {
    const message =
      "ST03N transaction profile: ZSTART; No matching transaction or discovered program; file input.csv"
    const state = {
      inventory: [
        { pgmid: "R3TR", objectType: "TRAN", objectName: "ZSTART", packageName: "ZPACKAGE" }
      ],
      observations: [
        {
          id: "input:transaction:ZSTART",
          inputId: "input",
          source: "transaction",
          keys: [],
          seeds: [],
          reason: message
        }
      ],
      inputs: [{ id: "input", name: "input.csv", kind: "transaction", issues: [message] }],
      stageIssues: { st03n: [message] },
      issues: [message],
      checks: { "WUL:R3TR:TRAN:ZSTART": { status: "error", error: "Lookup failed\nSecond line" } }
    } as unknown as UsageAnalysis
    const rows = usageIssueRows(state)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      stage: "ST03N",
      file: "input.csv",
      objectName: "ZSTART",
      objectType: "TRAN",
      packageName: "ZPACKAGE"
    })
    expect(rows[1]).toMatchObject({
      stage: "Dependencies",
      source: "Where-used",
      objectName: "ZSTART"
    })
    const values = rows.map(row => ({ ...row }))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      (await buildXlsx(issueColumns, values)) as unknown as Parameters<typeof workbook.xlsx.load>[0]
    )
    expect(workbook.worksheets[0].getRow(1).getCell(7).value).toBe("Issue")
    expect(workbook.worksheets[0].getRow(3).getCell(7).value).toBe("Lookup failed\nSecond line")
    expect(new TextDecoder().decode(buildCsv(issueColumns, values))).toContain(
      '"Lookup failed\nSecond line"'
    )
    state.checks["WUL:R3TR:TRAN:ZSTART"] = { status: "complete", edgeCount: 1 }
    expect(usageIssueRows(state)).toHaveLength(1)
  })
  it("includes a safe analysis name, view, origin and timestamp", () => {
    const name = usageExportName(
      { name: "Example: Usage / Review", connectionId: "example" } as UsageAnalysis,
      "unclear",
      "xlsx",
      new Date("2026-01-03T10:20:00Z")
    )
    expect(name).toBe("Example_Usage_Review_usage-unclear_EXAMPLE_20260103-1020.xlsx")
  })
  it("round-trips multiline reasons and preserves distinct Used/Unclear statuses", async () => {
    const rows = exportRows([
      {
        pgmid: "R3TR",
        key: "R3TR:PROG:ZTEST",
        objectType: "PROG",
        objectName: "ZTEST",
        packageName: "ZPACKAGE",
        status: "used",
        reasons: ["ST03N", "Job"],
        periods: ["2026-01"]
      }
    ])
    const bytes = await buildXlsx(usageColumns, rows)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    expect(workbook.worksheets[0].getRow(2).getCell(7).value).toBe("ST03N\nJob")
    expect(new TextDecoder().decode(buildCsv(usageColumns, rows))).toContain('"ST03N\nJob"')
  })
  it("exports each FM with its function group and its own usage status", async () => {
    const values = exportRows([
      {
        pgmid: "LIMU",
        key: "LIMU:FUNC:Z_FUNCTION",
        objectType: "FUNC",
        objectName: "Z_FUNCTION",
        packageName: "ZPACKAGE",
        functionGroup: "ZGROUP",
        status: "unclear",
        reasons: [],
        periods: []
      }
    ])
    const workbook = new ExcelJS.Workbook()
    const bytes = await buildXlsx(usageColumns, values)
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    expect(workbook.worksheets[0].getRow(1).getCell(5).value).toBe("Function Group")
    expect(workbook.worksheets[0].getRow(2).getCell(5).value).toBe("ZGROUP")
    expect(workbook.worksheets[0].getRow(2).getCell(6).value).toBe("Unclear")
    expect(new TextDecoder().decode(buildCsv(usageColumns, values))).toContain("ZGROUP,Unclear")
  })
})
