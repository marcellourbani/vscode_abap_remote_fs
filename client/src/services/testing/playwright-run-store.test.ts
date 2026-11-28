import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createRunDir, newRunId, pruneRuns, runsRoot } from "./playwright-run-store"

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "run-store-"))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function makeRun(id: string, bytes = 10) {
  const dir = await createRunDir(root, id)
  await fs.writeFile(path.join(dir, "report.json"), "x".repeat(bytes))
}

describe("pruneRuns", () => {
  it("keeps only the newest runs and never removes the current one", async () => {
    for (const id of ["2026-01-01_a", "2026-01-02_a", "2026-01-03_a", "2026-01-04_a"]) {
      await makeRun(id)
    }
    await pruneRuns(root, "2026-01-04_a", { maxRuns: 2, maxBytes: 1e9 })
    expect((await fs.readdir(runsRoot(root))).sort()).toEqual(["2026-01-03_a", "2026-01-04_a"])
  })

  it("removes oldest runs once the size budget is exceeded", async () => {
    await makeRun("2026-01-01_a", 100)
    await makeRun("2026-01-02_a", 100)
    await makeRun("2026-01-03_a", 100)
    await pruneRuns(root, "2026-01-03_a", { maxRuns: 99, maxBytes: 150 })
    expect(await fs.readdir(runsRoot(root))).toEqual(["2026-01-03_a"])
  })

  it("does nothing when the folder does not exist", async () => {
    await expect(pruneRuns(root)).resolves.toBeUndefined()
  })
})

describe("newRunId", () => {
  it("sorts chronologically and is filesystem safe", () => {
    const earlier = newRunId("ged100", new Date("2026-01-01T00:00:00Z"))
    const later = newRunId("a/b c", new Date("2026-01-02T00:00:00Z"))
    expect(earlier < later).toBe(true)
    expect(later).not.toMatch(/[\\/:\s]/)
  })
})
