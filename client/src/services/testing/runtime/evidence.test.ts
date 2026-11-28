import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page, TestInfo } from "@playwright/test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Evidence } from "./evidence"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "helper-evidence-"))
  vi.stubEnv("SAP_SYSTEM", "EXAMPLE")
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
function setup() {
  const page = {
    screenshot: vi.fn(async ({ path }: { path: string }) => {
      await writeFile(path, "image")
    })
  }
  const info = { file: join(root, "tests/PROGRAM/test-scripts/TC-001.spec.ts"), attach: vi.fn() }
  const evidence = new Evidence(
    page as unknown as Page,
    "TC-001",
    "Example title",
    info as unknown as TestInfo
  )
  return { evidence, page, info, dir: evidence.getDir() }
}
async function manifest(dir: string) {
  return JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"))
}

describe("evidence correctness", () => {
  it("records numbered steps, attaches screenshots and closes the manifest", async () => {
    const { evidence, dir, info } = setup()
    await evidence.step("First")
    await evidence.step("Second", "Observation")
    await evidence.finish("pass")
    const result = await manifest(dir)
    expect(result.status).toBe("pass")
    expect(result.finishedAt).toBeTruthy()
    expect(result.steps.map((s: { n: number }) => s.n)).toEqual([1, 2])
    expect(result.steps[1]).toMatchObject({
      description: "Second",
      notes: "Observation",
      screenshot: "step-02.png"
    })
    expect(info.attach).toHaveBeenCalledTimes(2)
  })
  it("records screenshot failure without inventing a screenshot", async () => {
    const { evidence, page, dir } = setup()
    page.screenshot.mockRejectedValue(new Error("Page gone"))
    await evidence.step("Missing image")
    expect((await manifest(dir)).steps[0]).toMatchObject({
      screenshot: null,
      notes: expect.stringContaining("Page gone")
    })
  })
  it("captures the failing state before finishing a failure", async () => {
    const { evidence, dir } = setup()
    await evidence.finish("fail", "Wrong result")
    const result = await manifest(dir)
    expect(result).toMatchObject({ status: "fail", errorMessage: "Wrong result" })
    expect(result.steps[0].description).toContain("FAILED: Wrong result")
  })
  it("archives prior output but preserves prepared data and fixtures", async () => {
    const previous = setup()
    await previous.evidence.step("Old step")
    await previous.evidence.finish("pass")
    await writeFile(join(previous.dir, "data.json"), "prepared")
    await writeFile(join(previous.dir, "verification.json"), "old verification")
    await writeFile(join(previous.dir, "fixture.csv"), "fixture")
    const current = setup()
    await current.evidence.step("New step")
    const runs = await readdir(join(current.dir, "runs"))
    expect(runs).toHaveLength(1)
    const archived = await manifest(join(current.dir, "runs", runs[0]))
    expect(archived.steps[0].description).toBe("Old step")
    expect((await manifest(current.dir)).steps[0].description).toBe("New step")
    expect(await readFile(join(current.dir, "data.json"), "utf8")).toBe("prepared")
    expect(await readFile(join(current.dir, "fixture.csv"), "utf8")).toBe("fixture")
  })
  it("keeps systems isolated", async () => {
    const one = setup()
    await one.evidence.finish("pass")
    vi.stubEnv("SAP_SYSTEM", "OTHER")
    const two = setup()
    await two.evidence.finish("fail", "Other system")
    expect(two.dir).not.toBe(one.dir)
    expect((await manifest(one.dir)).status).toBe("pass")
  })
})
