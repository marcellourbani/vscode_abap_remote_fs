import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { checkTestData } from "./check-fixtures"
import { CheckTestDataTool } from "../lm-tools/checkTestDataTool"
import { getTestFolder } from "./config"
import { assertToolInvocationAuthorized } from "../lm-tools/toolGuard"

vi.mock("vscode", () => ({
  LanguageModelToolResult: class {
    constructor(public content: unknown[]) {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  }
}))
vi.mock("./config", () => ({ getTestFolder: vi.fn() }))
vi.mock("../../config", () => ({ formatKey: (key: string) => key.toLowerCase() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../lm-tools/toolRegistry", () => ({ registerToolWithRegistry: vi.fn() }))
vi.mock("../lm-tools/toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))

let root: string
let cases: string

async function sidecar(tcId: string, requires: string) {
  await fs.mkdir(cases, { recursive: true })
  await fs.writeFile(path.join(cases, `${tcId}.data.md`), `---\nrequires:\n${requires}\n---\n`)
}

const staticRequirement = `  - key: fixture_value
    source: static
    staticValue: example`
const sqlRequirement = `  - key: unresolved_sql_value
    description: Example SQL value
    source: sql
    sql: SELECT example FROM example`

async function invokeTool(tcIds?: string[]) {
  const tool = new CheckTestDataTool()
  const result = await tool.invoke(
    {
      input: { program: "PROGRAM", connectionId: "example", tcIds }
    } as vscode.LanguageModelToolInvocationOptions<{
      program: string
      connectionId: string
      tcIds?: string[]
    }>,
    {} as vscode.CancellationToken
  )
  return (result.content[0] as vscode.LanguageModelTextPart).value
}

beforeEach(async () => {
  vi.clearAllMocks()
  root = await fs.mkdtemp(path.join(os.tmpdir(), "check-fixtures-"))
  cases = path.join(root, "tests", "PROGRAM", "test-cases")
  vi.mocked(getTestFolder).mockReturnValue(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe("checkTestData scoped managed data", () => {
  it("does not evaluate unrelated sidecars with missing SQL caches", async () => {
    await sidecar("TC-001", staticRequirement)
    await sidecar("TC-002", sqlRequirement)
    const result = await checkTestData(root, "PROGRAM", "example", ["TC-001"])
    expect(result).toMatchObject({
      total: 1,
      passed: 1,
      failures: [],
      noCacheNeeded: ["TC-001"],
      skippedUnmanaged: []
    })
  })

  it("still scans all sidecars by default and preserves real resolver failures", async () => {
    await sidecar("TC-001", staticRequirement)
    await sidecar("TC-002", sqlRequirement)
    const result = await checkTestData(root, "PROGRAM", "example")
    expect(result.total).toBe(2)
    expect(result.passed).toBe(1)
    expect(result.failures).toEqual([
      { tcId: "TC-002", message: expect.stringContaining("Missing test data") }
    ])
    const selected = await checkTestData(root, "PROGRAM", "example", ["TC-002"])
    expect(selected.passed).toBe(0)
    expect(selected.failures).toHaveLength(1)
  })

  it("still validates real file dependencies of selected cases", async () => {
    await sidecar(
      "TC-001",
      `  - key: upload
    description: Required upload
    source: static
    staticValue: ${JSON.stringify(path.join(root, "missing-upload.csv"))}
    expect: file`
    )
    const result = await checkTestData(root, "PROGRAM", "example", ["TC-001"])
    expect(result.passed).toBe(0)
    expect(result.failures).toEqual([
      { tcId: "TC-001", message: expect.stringContaining("upload") }
    ])
  })

  it("treats an absent test-cases directory as zero managed sidecars", async () => {
    expect(await checkTestData(root, "PROGRAM", "example")).toMatchObject({
      total: 0,
      passed: 0,
      skippedUnmanaged: [],
      failures: []
    })
    const text = await invokeTool()
    expect(text).toContain("No managed .data.md sidecars found in scope")
    expect(text).toContain("Inline specs do not require managed data")
    expect(text).toContain("0/0 managed sidecar(s)")
  })

  it("skips selected inline-only IDs without counting them as validated or passed", async () => {
    await fs.mkdir(cases, { recursive: true })
    await fs.writeFile(path.join(cases, "TC-003.md"), "# Inline-only smoke test")
    await sidecar("TC-002", sqlRequirement)
    const result = await checkTestData(root, "PROGRAM", "example", ["TC-003"])
    expect(result).toMatchObject({
      total: 0,
      passed: 0,
      skippedUnmanaged: ["TC-003"],
      failures: []
    })
    const text = await invokeTool(["TC-003"])
    expect(text).toContain("SKIPPED (unmanaged)  TC-003")
    expect(text).toContain("inline values were not validated")
    expect(text).toContain("not counted as passed")
    expect(text).not.toContain("FAIL  TC-002")
  })

  it("reports missing selected IDs even without a test-cases directory", async () => {
    const result = await checkTestData(root, "PROGRAM", "example", ["TC-003"])
    expect(result.skippedUnmanaged).toEqual(["TC-003"])
    expect(result.total).toBe(0)
  })

  it.each([[], [""], ["TC-1"], ["../TC-001"], ["tc-001"], ["TC-001", "bad"]])(
    "rejects unsafe or empty explicit selections: %j",
    async (...ids) => {
      await expect(checkTestData(root, "PROGRAM", "example", ids)).rejects.toThrow(
        "non-empty list of test-case IDs"
      )
    }
  )

  it("deduplicates selected IDs without double counting", async () => {
    await sidecar("TC-001", staticRequirement)
    const result = await checkTestData(root, "PROGRAM", "example", ["TC-001", "TC-001"])
    expect(result.total).toBe(1)
    expect(result.passed).toBe(1)
  })

  it("restores the extension host environment after resolution", async () => {
    const previousRoot = process.env.SAP_TESTING_ROOT
    const previousSystem = process.env.SAP_SYSTEM
    await sidecar("TC-001", sqlRequirement)
    await checkTestData(root, "PROGRAM", "example", ["TC-001"])
    expect(process.env.SAP_TESTING_ROOT).toBe(previousRoot)
    expect(process.env.SAP_SYSTEM).toBe(previousSystem)
  })

  it("passes tool selections through and reports only scoped managed cases", async () => {
    await sidecar("TC-001", staticRequirement)
    await sidecar("TC-002", sqlRequirement)
    const text = await invokeTool(["TC-001"])
    expect(text).toContain("Scope: selected cases — TC-001")
    expect(text).toContain("1/1 managed sidecar(s)")
    expect(text).not.toContain("TC-002")
    expect(assertToolInvocationAuthorized).toHaveBeenCalledOnce()
  })

  it("retains the configured-folder requirement", async () => {
    vi.mocked(getTestFolder).mockReturnValue("")
    await expect(invokeTool(["TC-001"])).rejects.toThrow("No SAP testing folder configured")
  })
})
