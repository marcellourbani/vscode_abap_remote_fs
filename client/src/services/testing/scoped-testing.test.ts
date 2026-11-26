import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { verifyTestDataUsage } from "./verify-test-data"

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "scoped-testing-"))
  await fs.mkdir(path.join(root, "tests", "PROGRAM", "test-scripts"), { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

it("accepts inline inputs without case documents, data sidecars, or caches", async () => {
  await fs.writeFile(
    path.join(root, "tests", "PROGRAM", "test-scripts", "TC-001.spec.ts"),
    'const data = { sample_value: "example" }; await sap.setField("Input", data.sample_value)'
  )
  const result = await verifyTestDataUsage(root, "PROGRAM", "TC-001")
  expect(result.ok).toBe(true)
  expect(result.skipped).toBe(true)
  expect(result.messages.join(" ")).toContain("inline inputs are not validated")
  expect(result.messages.join(" ")).not.toContain("needs no test data")
})

it("keeps SE16N proof strict by default but permits scoped data-only validation", async () => {
  const cases = path.join(root, "tests", "PROGRAM", "test-cases")
  await fs.mkdir(cases, { recursive: true })
  await fs.writeFile(path.join(cases, "TC-001.md"), "---\nverification: sql\n---\n")
  await fs.writeFile(
    path.join(root, "tests", "PROGRAM", "test-scripts", "TC-001.spec.ts"),
    'const data = { example: "input" }'
  )
  expect((await verifyTestDataUsage(root, "PROGRAM", "TC-001")).ok).toBe(false)
  const scoped = await verifyTestDataUsage(root, "PROGRAM", "TC-001", {
    skipWorkflowValidation: true
  })
  expect(scoped.ok).toBe(true)
  expect(scoped.skipped).toBe(true)
  expect(scoped.messages.join(" ")).toContain("inline inputs are not validated")
})

it.each([false, true])(
  "retains resolver dependencies with override=%s",
  async skipWorkflowValidation => {
    await fs.writeFile(
      path.join(root, "tests", "PROGRAM", "test-scripts", "TC-001.spec.ts"),
      'const data = await resolveTestData("TC-001", testInfo)'
    )
    await expect(
      verifyTestDataUsage(root, "PROGRAM", "TC-001", { skipWorkflowValidation })
    ).rejects.toThrow("does not exist")
  }
)
