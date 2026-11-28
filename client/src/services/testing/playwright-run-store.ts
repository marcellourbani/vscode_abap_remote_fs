/**
 * Per-call storage for Playwright runs: the full JSON report, runner output and traces.
 *
 * Each tool call gets a unique output folder. Active calls in this extension process
 * are protected from housekeeping. Retention is best effort: active/current runs can
 * temporarily exceed the count and size budgets.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { randomUUID } from "crypto"

const activeRuns = new Set<string>()

export const RUNS_DIR_NAME = ".playwright-runs"
/** Newest call folders to keep. */
export const MAX_KEPT_RUNS = 15
/** Total size budget; oldest folders go first once exceeded. */
export const MAX_RUNS_BYTES = 500 * 1024 * 1024
/** Runner output is only a diagnostic aid, so it is capped. */
const MAX_LOG_CHARS = 200_000

export function runsRoot(testFolder: string): string {
  return path.join(testFolder, RUNS_DIR_NAME)
}

export function newRunId(connectionId: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  return `${stamp}_${connectionId.replace(/[^\w-]/g, "_")}_${randomUUID()}`
}

export async function createRunDir(testFolder: string, runId: string): Promise<string> {
  const dir = path.join(runsRoot(testFolder), runId)
  if (activeRuns.has(dir)) throw new Error("A Playwright call already owns this run directory.")
  activeRuns.add(dir)
  try {
    await fs.mkdir(runsRoot(testFolder), { recursive: true })
    await fs.mkdir(dir)
    return dir
  } catch (error) {
    activeRuns.delete(dir)
    throw error
  }
}

export async function writeRunLog(workerDir: string, stdout: string, stderr: string) {
  const text = `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`
  const clipped =
    text.length > MAX_LOG_CHARS ? `${text.slice(0, MAX_LOG_CHARS)}\n[truncated]\n` : text
  await fs.writeFile(path.join(workerDir, "runner.log"), clipped, "utf8").catch(() => {})
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else total += (await fs.stat(full).catch(() => undefined))?.size ?? 0
  }
  return total
}

/** Release a completed call before pruning. Always release in the runner's finally block. */
export function releaseRun(testFolder: string, runId: string): void {
  activeRuns.delete(path.join(runsRoot(testFolder), runId))
}

/** Best-effort retention; active calls and the protected current call are never deleted. */
export async function pruneRuns(
  testFolder: string,
  keepRunId?: string,
  limits = { maxRuns: MAX_KEPT_RUNS, maxBytes: MAX_RUNS_BYTES }
): Promise<void> {
  try {
    const root = runsRoot(testFolder)
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    // The ISO-timestamp prefix makes name order chronological.
    const runs = names.filter(name => name !== keepRunId).sort()
    const sizes = new Map<string, number>()
    let total = keepRunId ? await dirSize(path.join(root, keepRunId)) : 0
    for (const name of runs) {
      const size = await dirSize(path.join(root, name))
      sizes.set(name, size)
      total += size
    }
    let count = runs.length + (keepRunId ? 1 : 0)
    for (const name of runs) {
      if (count <= limits.maxRuns && total <= limits.maxBytes) break
      if (activeRuns.has(path.join(root, name))) continue
      try {
        await fs.rm(path.join(root, name), { recursive: true, force: true })
      } catch {
        continue
      }
      count--
      total -= sizes.get(name) ?? 0
    }
  } catch {
    // Pruning is housekeeping; it must never fail a test run.
  }
}
