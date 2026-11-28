import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createRunDir, newRunId, pruneRuns, releaseRun, runsRoot } from "./playwright-run-store"

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
  releaseRun(root, id)
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

  it("protects other active calls even over budget", async () => {
    const dir = await createRunDir(root, "2026-01-01_active")
    await fs.writeFile(path.join(dir, "trace.zip"), "x".repeat(200))
    await makeRun("2026-01-02_current", 200)
    await pruneRuns(root, "2026-01-02_current", { maxRuns: 1, maxBytes: 100 })
    expect((await fs.readdir(runsRoot(root))).sort()).toEqual([
      "2026-01-01_active",
      "2026-01-02_current"
    ])
    releaseRun(root, "2026-01-01_active")
    await pruneRuns(root, "2026-01-02_current", { maxRuns: 1, maxBytes: 100 })
    expect(await fs.readdir(runsRoot(root))).toEqual(["2026-01-02_current"])
  })

  it("rejects reuse of an existing run directory", async () => {
    await makeRun("duplicate")
    await expect(createRunDir(root, "duplicate")).rejects.toThrow()
  })

  it("does nothing when the folder does not exist", async () => {
    await expect(pruneRuns(root)).resolves.toBeUndefined()
  })
})

describe("newRunId", () => {
  it("is unique for same-system calls in the same millisecond", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    expect(new Set(Array.from({ length: 100 }, () => newRunId("dev100", now))).size).toBe(100)
  })

  it("sorts chronologically and is filesystem safe", () => {
    const earlier = newRunId("dev100", new Date("2026-01-01T00:00:00Z"))
    const later = newRunId("a/b c", new Date("2026-01-02T00:00:00Z"))
    expect(earlier < later).toBe(true)
    expect(later).not.toMatch(/[\\/:\s]/)
  })
})
