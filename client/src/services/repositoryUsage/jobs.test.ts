import { describe, expect, it, vi } from "vitest"
import { collectLatestJobs, jobSql, programObservations } from "./jobs"

describe("portable latest-job-per-program collection", () => {
  it("passes a 100,000-program count directly to the single summary fetch", async () => {
    const values = Array.from({ length: 100000 }, (_, index) => ({
      PROGNAME: `ZPROGRAM_${index}`,
      LAST_RUN: "20260103"
    }))
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "100000" }] })
      .mockResolvedValueOnce({ values })
    expect(
      await collectLatestJobs(
        { runQuery },
        "2026-01-01",
        "2026-12-31",
        new AbortController().signal
      )
    ).toHaveLength(100000)
    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(runQuery.mock.calls[1][1]).toBe(100000)
  })
  it("starts no summary fetch when cancellation happens during the count", async () => {
    const controller = new AbortController()
    const runQuery = vi.fn().mockImplementationOnce(async () => {
      controller.abort()
      return { values: [{ TOTAL: "2" }] }
    })
    await expect(
      collectLatestJobs({ runQuery }, "2026-01-01", "2026-01-31", controller.signal)
    ).rejects.toThrow("Analysis paused")
    expect(runQuery).toHaveBeenCalledTimes(1)
  })
  it.each(["S", "P"] as const)(
    "fetches enabled status %s without a start-date predicate",
    async status => {
      const runQuery = vi
        .fn()
        .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
        .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
        .mockResolvedValueOnce({ values: [{ PROGNAME: "ZMONTHLY" }] })
      const rows = await collectLatestJobs(
        { runQuery },
        "2026-01-01",
        "2026-01-31",
        new AbortController().signal,
        undefined,
        { includeReleasedJobs: status === "S", includeScheduledJobs: status === "P" }
      )
      expect(rows).toEqual([{ program: "ZMONTHLY", status }])
      expect(runQuery).toHaveBeenCalledTimes(3)
      expect(runQuery.mock.calls[0][0]).toBe(jobSql("2026-01-01", "2026-01-31", true))
      for (const [sql] of runQuery.mock.calls.slice(1)) {
        expect(sql).toContain(`h~status = '${status}'`)
        expect(sql).not.toContain("strtdate")
        expect(sql.length).toBeLessThanOrEqual(255)
      }
      const observation = programObservations(rows, [], [])[0]
      expect(observation.date).toBeUndefined()
      expect(observation.reason).toContain(status === "S" ? "released job" : "scheduled job")
      expect(observation.reason).not.toContain("latest job start")
    }
  )
  it("merges both pending statuses with runtime evidence without losing a real last-run date", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "1" }] })
      .mockResolvedValueOnce({ values: [{ PROGNAME: "ZFIRST", LAST_RUN: "20260103" }] })
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ PROGNAME: "ZFIRST" }, { PROGNAME: "ZSECOND" }] })
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ PROGNAME: "ZSECOND" }, { PROGNAME: "ZTHIRD" }] })
    expect(
      await collectLatestJobs(
        { runQuery },
        "2026-01-01",
        "2026-01-31",
        new AbortController().signal,
        undefined,
        { includeReleasedJobs: true, includeScheduledJobs: true }
      )
    ).toEqual([
      { program: "ZFIRST", date: "2026-01-03" },
      { program: "ZSECOND", status: "S" },
      { program: "ZTHIRD", status: "P" }
    ])
  })
  it("does not start another status lookup after cancellation", async () => {
    const controller = new AbortController()
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
      .mockImplementationOnce(async () => {
        controller.abort()
        return { values: [{ TOTAL: "1" }] }
      })
    await expect(
      collectLatestJobs({ runQuery }, "2026-01-01", "2026-01-31", controller.signal, undefined, {
        includeReleasedJobs: true,
        includeScheduledJobs: true
      })
    ).rejects.toThrow("Analysis paused")
    expect(runQuery).toHaveBeenCalledTimes(2)
  })
  it("rejects truncated pending-job summaries", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ PROGNAME: "ZFIRST" }] })
    await expect(
      collectLatestJobs(
        { runQuery },
        "2026-01-01",
        "2026-01-31",
        new AbortController().signal,
        undefined,
        { includeReleasedJobs: true }
      )
    ).rejects.toThrow("Incomplete job summary")
  })
  it("uses grouped Open SQL within ADT's length limit without HANA-only functions", () => {
    for (const sql of [
      jobSql("2026-01-01", "2026-12-31", true),
      jobSql("2026-01-01", "2026-12-31", false)
    ]) {
      expect(sql.length).toBeLessThanOrEqual(255)
      expect(sql).not.toMatch(/OVER\(|CONCAT|WINDOW|LIMIT/i)
      expect(sql).toContain("p~jobcount = h~jobcount")
      expect(sql).toContain("BETWEEN '20260101' AND '20261231'")
    }
    expect(jobSql("2026-01-01", "2026-12-31", false)).toContain("GROUP BY p~progname")
  })
  it("counts distinct programs, fetches only summaries and handles SAP/ISO dates", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({
        values: [
          { PROGNAME: "ZFIRST", LAST_RUN: "20260103" },
          { PROGNAME: "ZSECOND", LAST_RUN: "2026-02-01T00:00:00.000Z" }
        ]
      })
    const rows = await collectLatestJobs(
      { runQuery },
      "2026-01-01",
      "2026-12-31",
      new AbortController().signal
    )
    expect(rows).toEqual([
      { program: "ZFIRST", date: "2026-01-03" },
      { program: "ZSECOND", date: "2026-02-01" }
    ])
    expect(runQuery.mock.calls[1][1]).toBe(2)
    expect(runQuery).toHaveBeenCalledTimes(2)
  })
  it("handles empty results and reports truncated summaries", async () => {
    const runQuery = vi.fn().mockResolvedValueOnce({ values: [{ TOTAL: "0" }] })
    expect(
      await collectLatestJobs(
        { runQuery },
        "2026-01-01",
        "2026-01-31",
        new AbortController().signal
      )
    ).toEqual([])
    runQuery
      .mockResolvedValueOnce({ values: [{ TOTAL: "2" }] })
      .mockResolvedValueOnce({ values: [{ PROGNAME: "ZFIRST", LAST_RUN: "20260101" }] })
    await expect(
      collectLatestJobs({ runQuery }, "2026-01-01", "2026-01-31", new AbortController().signal)
    ).rejects.toThrow(/incomplete|expected/i)
  })
  it("maps summary programs to transaction usage without making up job names", () => {
    const observations = programObservations(
      [{ program: "ZREPORT", date: "2026-01-03" }],
      [],
      [{ transaction: "ZSTART", program: "ZREPORT" }]
    )
    expect(observations[0].keys).toContain("R3TR:TRAN:ZSTART")
    expect(observations[0].date).toBe("2026-01-03")
    expect(observations[0].reason).not.toContain("job undefined")
  })
})
