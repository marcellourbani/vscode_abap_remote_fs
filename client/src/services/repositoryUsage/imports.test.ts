import { describe, expect, it } from "vitest"
import { normalizeRows, jobObservations, discoveryInventory } from "./imports"
import { readInput } from "./imports"
import { buildXlsx } from "../structuredDataExportService"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("usage evidence spreadsheets", () => {
  it("accepts direct TADIR and ENLFDIR exports and inherits each FM's package", () => {
    const objects = normalizeRows(
      [
        ["PGMID", "OBJECT", "OBJ_NAME", "DEVCLASS"],
        ["R3TR", "FUGR", "ZGROUP", "ZPACKAGE"]
      ],
      "tadir"
    )
    const functions = normalizeRows(
      [
        ["AREA", "FUNCNAME"],
        ["ZGROUP", "Z_FIRST"]
      ],
      "enlfdir"
    )
    const result = discoveryInventory(objects, functions)
    expect(result.inventory).toContainEqual({
      pgmid: "LIMU",
      objectType: "FUNC",
      objectName: "Z_FIRST",
      packageName: "ZPACKAGE",
      functionGroup: "ZGROUP"
    })
    expect(result.functions).toEqual([{ name: "Z_FIRST", group: "ZGROUP" }])
    expect(result.issues).toEqual([])
  })
  it("reports missing FM owners instead of inventing package membership", () => {
    const result = discoveryInventory([], [{ AREA: "ZMISSING", FUNCNAME: "Z_FIRST" }])
    expect(result.inventory).toEqual([])
    expect(result.issues[0]).toContain("ZMISSING")
  })
  it("reduces repeated job runs to the latest observation per program", () => {
    const result = jobObservations(
      [
        { JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: "20260101", STATUS: "F" },
        { JOBNAME: "JOB", JOBCOUNT: "2", STRTDATE: "20260103", STATUS: "A" }
      ],
      [
        { JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "ZTEST" },
        { JOBNAME: "JOB", JOBCOUNT: "2", PROGNAME: "ZTEST" }
      ],
      [],
      []
    )
    expect(result.observations).toHaveLength(1)
    expect(result.observations[0].date).toBe("2026-01-03")
    expect(result.observations[0].reason).toContain("A")
  })
  it("normalizes and deduplicates one-column names without inferring types", () => {
    expect(
      normalizeRows([["Object Name"], [" z_example "], ["Z_EXAMPLE"], [""]], "transaction")
    ).toEqual([{ OBJECTNAME: "Z_EXAMPLE" }])
  })
  it("rejects unexpected columns and missing job join keys", () => {
    expect(() =>
      normalizeRows(
        [
          ["ObjectName", "Type"],
          ["ZTEST", "PROG"]
        ],
        "transaction"
      )
    ).toThrow(/column/i)
    expect(() =>
      normalizeRows(
        [
          ["JOBNAME", "PROGNAME"],
          ["JOB", "ZTEST"]
        ],
        "tbtcp"
      )
    ).toThrow(/JOBCOUNT/)
  })
  it("preserves job identities and normalizes numeric job counts", () => {
    expect(
      normalizeRows(
        [
          ["JOBNAME", "JOBCOUNT", "PROGNAME"],
          ["JOB", 12, "z_test"]
        ],
        "tbtcp"
      )[0]
    ).toEqual({ JOBNAME: "JOB", JOBCOUNT: "00000012", PROGNAME: "Z_TEST" })
  })
  it("joins multiple steps and accepts failed jobs without a user lookup", () => {
    const result = jobObservations(
      [{ JOBNAME: "JOB", JOBCOUNT: "00000012", STRTDATE: "20260103", STATUS: "A" }],
      [
        { JOBNAME: "JOB", JOBCOUNT: "00000012", PROGNAME: "ZFIRST", STEPCOUNT: "1" },
        { JOBNAME: "JOB", JOBCOUNT: "00000012", PROGNAME: "ZSECOND", STEPCOUNT: "2" },
        { JOBNAME: "OTHER", JOBCOUNT: "00000012", PROGNAME: "ZMISSING" }
      ],
      [],
      []
    )
    expect(result.observations).toHaveLength(2)
    expect(result.observations[0].date).toBe("2026-01-03")
    expect(result.observations[0].reason).toContain("A")
    expect(result.issues).toHaveLength(1)
  })
  it.each(["", "00000000"])("ignores matching jobs with missing start date %s", raw => {
    const result = jobObservations(
      [{ JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: raw }],
      [{ JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "ZTEST" }],
      [],
      []
    )
    expect(result.observations).toEqual([])
    expect(result.issues[0]).toContain("Missing job start date")
  })
  it.each(["S", "P"])("only includes pending status %s when its option is enabled", status => {
    const headers = [{ JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: "20260103", STATUS: status }]
    const steps = [{ JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "ZTEST" }]
    expect(jobObservations(headers, steps, [], []).observations).toEqual([])
    const options = { includeReleasedJobs: status === "S", includeScheduledJobs: status === "P" }
    expect(jobObservations(headers, steps, [], [], options).observations).toHaveLength(1)
    const opposite = { includeReleasedJobs: status === "P", includeScheduledJobs: status === "S" }
    expect(jobObservations(headers, steps, [], [], opposite).observations).toEqual([])
  })
  it.each(["S", "P"])("accepts missing and invalid dates for enabled pending status %s", status => {
    for (const raw of ["", "00000000", "20260231"]) {
      const result = jobObservations(
        [{ JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: raw, STATUS: status }],
        [{ JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "ZTEST" }],
        [],
        [],
        { includeReleasedJobs: true, includeScheduledJobs: true }
      )
      expect(result.observations).toHaveLength(1)
      expect(result.observations[0].date).toBeUndefined()
      expect(result.observations[0].reason).toContain(`status ${status}`)
      expect(result.issues).toEqual([])
    }
  })
  it("still rejects invalid dates for other statuses when both pending options are enabled", () => {
    const result = jobObservations(
      [{ JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: "00000000", STATUS: "F" }],
      [{ JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "ZTEST" }],
      [],
      [],
      { includeReleasedJobs: true, includeScheduledJobs: true }
    )
    expect(result.observations).toEqual([])
    expect(result.issues[0]).toContain("Missing job start date")
  })
  it("reads actual XLSX templates including valid empty extracts and stable checksums", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-import-"))
    try {
      const file = path.join(root, "extract.xlsx")
      await fs.writeFile(file, await buildXlsx([{ name: "ObjectName" }], [{ ObjectName: "ZTEST" }]))
      const first = await readInput(file, "transaction", "2026-01")
      const second = await readInput(file, "transaction", "2026-01")
      expect(first.input.id).toBe(second.input.id)
      expect(first.input.rows).toEqual([{ OBJECTNAME: "ZTEST" }])
      await fs.writeFile(file, await buildXlsx([{ name: "ObjectName" }], []))
      expect((await readInput(file, "transaction", "")).input.rows).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
  it("ignores jobs with an impossible start date", () => {
    const result = jobObservations(
      [{ JOBNAME: "JOB", JOBCOUNT: "1", STRTDATE: "20260231" }],
      [{ JOBNAME: "JOB", JOBCOUNT: "1", PROGNAME: "ZTEST" }],
      [],
      []
    )
    expect(result.observations).toEqual([])
    expect(result.issues[0]).toContain("Invalid job date")
  })
})
