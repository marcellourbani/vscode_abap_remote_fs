/**
 * Evidence recorder — captures screenshots + step metadata per test case, into
 * `tests/<program>/test-results/<TC-ID>/`. A separate post-run script
 * (`scripts/build-evidence.ts`) turns each folder into a .docx test report.
 *
 * The output folder is derived from the spec file location:
 *   .../tests/<program>/test-scripts/TC-001.spec.ts
 *   → .../tests/<program>/test-results/TC-001/
 *
 * Specs at tests/ root (e.g. tests/_smoke.spec.ts) fall back to tests/_shared/test-results/<TC>.
 *
 * Re-running a test archives the prior run into `<TC-ID>/runs/<timestamp>/` rather than
 * overwriting it. The most recent run always stays at the top level, so consumers need no
 * knowledge of the history.
 *
 * Manifest schema (test-results/<TC-ID>/manifest.json):
 *   {
 *     tcId: "TC-001",
 *     title: "...",
 *     startedAt: ISO, finishedAt: ISO, status: "pass"|"fail",
 *     steps: [ { n, description, screenshot, timestamp, notes? } ]
 *   }
 */
import type { Page, TestInfo } from "@playwright/test"
import * as fs from "fs/promises"
import * as path from "path"

export type StepRecord = {
  n: number
  description: string
  screenshot: string | null
  timestamp: string
  notes?: string
}

export type Manifest = {
  tcId: string
  title: string
  startedAt: string
  finishedAt?: string
  status: "pass" | "fail" | "running"
  steps: StepRecord[]
  errorMessage?: string
}

/**
 * Given the spec file path, return the program's test-results/<SYSTEM>/<TC-ID> folder.
 * Same program tested against multiple systems (DEV, QAS, PRD) never overwrites
 * another system's results.
 *
 * If the spec is at tests/ root (smoke etc.), use tests/_shared/test-results/<SYSTEM>/<TC-ID>.
 */
export function resultsDirFor(specFilePath: string | undefined, tcId: string): string {
  const projectRoot = path.resolve(".")
  const system = (process.env.SAP_SYSTEM ?? "DEV").toUpperCase()
  if (!specFilePath) {
    return path.join(projectRoot, "tests", "_shared", "test-results", system, tcId)
  }
  const dir = path.dirname(specFilePath)
  const parent = path.basename(dir)
  if (parent === "test-scripts") {
    const programDir = path.dirname(dir)
    return path.join(programDir, "test-results", system, tcId)
  }
  // Spec is directly under tests/ — smoke etc.
  return path.join(projectRoot, "tests", "_shared", "test-results", system, tcId)
}

export class Evidence {
  private steps: StepRecord[] = []
  private counter = 0
  private startedAt = new Date().toISOString()
  private dir: string
  private archiving?: Promise<void>

  constructor(
    private page: Page,
    private tcId: string,
    private title: string,
    private info?: TestInfo
  ) {
    this.dir = resultsDirFor(info?.file, tcId)
  }

  /** Return the test-results directory for this evidence — useful for data cache location. */
  getDir(): string {
    return this.dir
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    // Memoized, so concurrent steps archive exactly once per run.
    this.archiving ??= this.archivePreviousRun()
    await this.archiving
  }

  /**
   * Move the previous run's artifacts into `runs/<timestamp>/` so re-running a test no longer
   * overwrites its history. The latest run stays at the top level, which is where
   * build_evidence_report and every other consumer looks.
   *
   * Only files this class produces are moved. Anything else in the folder — above all the
   * prepared `data.json` cache, which is run INPUT — must stay where it is.
   */
  private async archivePreviousRun(): Promise<void> {
    const archivable = /^(manifest|verification)\.json$|^step-\d+\.png$/
    let entries: string[]
    try {
      entries = (await fs.readdir(this.dir)).filter(e => archivable.test(e))
    } catch {
      return
    }
    if (!entries.length) return // nothing from a previous run to preserve

    const runDir = path.join(this.dir, "runs", await this.previousRunStamp(entries))
    await fs.mkdir(runDir, { recursive: true })
    for (const entry of entries) {
      await fs.rename(path.join(this.dir, entry), path.join(runDir, entry)).catch(() => {})
    }
  }

  /**
   * When the PREVIOUS run happened — never now, or a month-old run would look like today's.
   * Its manifest is the source of truth; a crashed run may not have one, so fall back to the
   * newest artifact's mtime rather than leaving its screenshots to mix into this run.
   */
  private async previousRunStamp(entries: string[]): Promise<string> {
    try {
      const raw = await fs.readFile(path.join(this.dir, "manifest.json"), "utf8")
      const previous: Manifest = JSON.parse(raw)
      const iso = previous.finishedAt ?? previous.startedAt
      if (iso) return iso.replace(/[:.]/g, "-")
    } catch {
      // missing or unparsable manifest — fall through to file times
    }
    const times = await Promise.all(
      entries.map(e =>
        fs
          .stat(path.join(this.dir, e))
          .then(s => s.mtimeMs)
          .catch(() => 0)
      )
    )
    return new Date(Math.max(...times, 0)).toISOString().replace(/[:.]/g, "-")
  }

  async step(description: string, notes?: string): Promise<void> {
    await this.ensureDir()
    this.counter += 1
    const filename = `step-${String(this.counter).padStart(2, "0")}.png`
    const filepath = path.join(this.dir, filename)
    let screenshot: string | null = null
    try {
      await this.page.screenshot({ path: filepath, fullPage: false })
      screenshot = filename
      if (this.info)
        await this.info.attach(description, {
          path: filepath,
          contentType: "image/png"
        })
    } catch (e) {
      // Screenshot failed — continue but note it
      notes = `${notes ?? ""} [screenshot failed: ${(e as Error).message}]`.trim()
    }
    this.steps.push({
      n: this.counter,
      description,
      screenshot,
      timestamp: new Date().toISOString(),
      notes
    })
    await this.writeManifest("running")
  }

  async finish(status: "pass" | "fail", errorMessage?: string): Promise<void> {
    // On failure, capture a final screenshot so the last evidence image IS the failing
    // state. Without this the newest screenshot predates the throwing assertion, which is
    // what makes a failure "impossible to diagnose from the manifest" (see the alert bug).
    // Best-effort: the page may already be gone; never let evidence capture mask the real error.
    if (status === "fail") {
      await this.step(errorMessage ? `FAILED: ${errorMessage}` : "FAILED").catch(() => {})
    }
    await this.writeManifest(status, errorMessage)
  }

  private async writeManifest(status: Manifest["status"], errorMessage?: string): Promise<void> {
    await this.ensureDir()
    const m: Manifest = {
      tcId: this.tcId,
      title: this.title,
      startedAt: this.startedAt,
      finishedAt: status === "running" ? undefined : new Date().toISOString(),
      status,
      steps: this.steps,
      errorMessage
    }
    await fs.writeFile(path.join(this.dir, "manifest.json"), JSON.stringify(m, null, 2), "utf8")
  }
}
