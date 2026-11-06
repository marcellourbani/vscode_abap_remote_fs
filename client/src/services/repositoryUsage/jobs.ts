import { validDate } from "./imports"
import { resolveEntries } from "./analysis"
import { abortIfNeeded, type QueryClient } from "./query"
import type { InventoryObject, JobOptions, JobProgram, TransactionMapping } from "./types"

export function jobSql(from: string, to: string, count: boolean, status?: "S" | "P") {
  if (!validDate(from) || !validDate(to) || from > to)
    throw new Error("Choose a valid job start-date range")
  const fields = count
    ? "COUNT( DISTINCT p~progname ) AS total"
    : status
      ? "p~progname"
      : "p~progname,MAX( h~strtdate ) AS last_run"
  const condition = status
    ? `h~status = '${status}'`
    : `h~strtdate BETWEEN '${from.replace(/-/g, "")}' AND '${to.replace(/-/g, "")}'`
  const sql = `SELECT ${fields} FROM tbtcp AS p INNER JOIN tbtco AS h ON p~jobname = h~jobname AND p~jobcount = h~jobcount WHERE ${condition}${count ? "" : " GROUP BY p~progname"}`
  if (sql.length > 255) throw new Error("Job summary query exceeds the SAP query-length limit")
  return sql
}

export async function collectLatestJobs(
  client: QueryClient,
  from: string,
  to: string,
  signal: AbortSignal,
  progress?: (done: number, total: number) => Promise<void>,
  options: JobOptions = {}
): Promise<JobProgram[]> {
  const statuses: ("S" | "P" | undefined)[] = [undefined]
  if (options.includeReleasedJobs) statuses.push("S")
  if (options.includeScheduledJobs) statuses.push("P")
  const programs = new Map<string, JobProgram>()
  let completed = 0
  for (const status of statuses) {
    abortIfNeeded(signal)
    const count = await client.runQuery(jobSql(from, to, true, status), 1, true)
    abortIfNeeded(signal)
    const total = Number(count.values?.[0]?.TOTAL)
    if (!Number.isSafeInteger(total) || total < 0)
      throw new Error("SAP returned an invalid program count")
    await progress?.(completed, completed + total)
    abortIfNeeded(signal)
    if (!total) continue
    const result = await client.runQuery(jobSql(from, to, false, status), total, true)
    abortIfNeeded(signal)
    if (result.values?.length !== total)
      throw new Error(
        `Incomplete job summary: expected ${total} programs, received ${result.values?.length || 0}`
      )
    for (const row of result.values) {
      const program = String(row.PROGNAME || "").trim()
      if (!program || programs.has(program)) continue
      if (status) programs.set(program, { program, status })
      else {
        const raw = String(row.LAST_RUN || "").trim()
        const date = /^\d{8}$/.test(raw)
          ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
          : raw.slice(0, 10)
        programs.set(program, { program, date: validDate(date) ? date : undefined })
      }
    }
    completed += total
    await progress?.(completed, completed)
  }
  return [...programs.values()]
}

export function programObservations(
  programs: JobProgram[],
  inventory: InventoryObject[],
  mappings: TransactionMapping[]
) {
  return programs.map(item => {
    const observation = resolveEntries([item.program], "jobs", inventory, mappings, [])[0]
    return {
      ...observation,
      id: `jobs:${item.program}`,
      date: item.date,
      reason: item.status
        ? `${observation.reason}; ${item.status === "S" ? "released" : "scheduled"} job (status ${item.status}); actual start not required`
        : `${observation.reason}; latest job start${item.date ? ` ${item.date}` : " date unavailable"}`
    }
  })
}
