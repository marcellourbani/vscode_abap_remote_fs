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
