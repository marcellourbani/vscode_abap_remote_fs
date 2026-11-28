import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveTestData, saveTestDataCache } from "./test-data"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "helper-data-"))
  vi.stubEnv("SAP_TESTING_ROOT", root)
  vi.stubEnv("SAP_SYSTEM", "EXAMPLE")
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
async function sidecar(requires: unknown[], program = "ONE") {
  const dir = join(root, "tests", program, "test-cases")
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "TC-001.data.md"),
    `---\ntcId: TC-001\nrequires: ${JSON.stringify(requires)}\n---\n`
  )
}
const key = (source: string, extra = {}) => ({
  key: "sample",
  source,
  description: "Example input",
  ...extra
})

describe("test-data resolution and isolation", () => {
  it("keeps same-numbered cases scoped to their program", async () => {
    await sidecar([key("static", { staticValue: "first" })])
    await sidecar([key("static", { staticValue: "second" })], "TWO")
    expect((await resolveTestData("TC-001", "ONE")).sample).toBe("first")
    expect(
      (
        await resolveTestData("TC-001", {
          file: join(root, "tests/TWO/test-scripts/TC-001.spec.ts")
        })
      ).sample
    ).toBe("second")
  })
  it("does not let stale cache shadow static values", async () => {
    await sidecar([key("static", { staticValue: "current" })])
    await saveTestDataCache("TC-001", "EXAMPLE", "ONE", { sample: "stale" })
    expect((await resolveTestData("TC-001", "ONE")).sample).toBe("current")
  })
  it("prefers system-specific environment pins over global pins and cache", async () => {
    await sidecar([key("sql")])
    await saveTestDataCache("TC-001", "EXAMPLE", "ONE", { sample: "cached" })
    vi.stubEnv("TESTDATA_TC_001_sample", "global")
    vi.stubEnv("TESTDATA_TC_001_EXAMPLE_sample", "specific")
    expect((await resolveTestData("TC-001", "ONE")).sample).toBe("specific")
  })
  it("never consumes another system's cache", async () => {
    await sidecar([key("sql")])
    await saveTestDataCache("TC-001", "OTHER", "ONE", { sample: "wrong system" })
    await expect(resolveTestData("TC-001", "ONE")).rejects.toThrow(/Missing test data/)
  })
  it("fails loudly on undeclared reads while allowing JSON and await", async () => {
    await sidecar([key("static", { staticValue: "literal" })])
    const data = await resolveTestData("TC-001", "ONE")
    expect(() => data.misspelled).toThrow(/not a resolved test-data key/)
    expect(JSON.parse(JSON.stringify(data))).toEqual({ sample: "literal" })
    expect(await Promise.resolve(data)).toBe(data)
  })
  it("rebuilds generated fixtures rather than using stale cache", async () => {
    await sidecar([
      key("generated", {
        generator: "fixture-builder",
        args: { format: "csv", filename: "sample.csv", columns: ["Value"], rows: [["new"]] }
      })
    ])
    await saveTestDataCache("TC-001", "EXAMPLE", "ONE", { sample: "missing-stale-file" })
    const first = await resolveTestData("TC-001", "ONE")
    expect(await readFile(first.sample, "utf8")).toContain("new")
    await writeFile(first.sample, "corrupted")
    const second = await resolveTestData("TC-001", "ONE")
    expect(await readFile(second.sample, "utf8")).not.toContain("corrupted")
  })
  it.each(["missing", "empty", "directory"])(
    "rejects unusable file requirement: %s",
    async kind => {
      const file = join(root, "input")
      if (kind === "empty") await writeFile(file, "")
      if (kind === "directory") await mkdir(file)
      await sidecar([key("static", { staticValue: file, expect: "file" })])
      await expect(resolveTestData("TC-001", "ONE")).rejects.toThrow(/Missing test data/)
    }
  )
  it("rejects an empty file path rather than returning an unusable upload input", async () => {
    await sidecar([key("static", { staticValue: "", expect: "file" })])
    await expect(resolveTestData("TC-001", "ONE")).rejects.toThrow(/Missing test data/)
  })
  it("reports all unresolved keys, including seed prerequisites", async () => {
    await sidecar([
      key("sql"),
      { key: "seed", source: "seeded", description: "Seed input", seed: { viaTcId: "TC-002" } }
    ])
    await expect(resolveTestData("TC-001", "ONE")).rejects.toThrow(/sample[\s\S]*TC-002/)
  })
})
