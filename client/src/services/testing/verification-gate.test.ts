import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
  findSqlVerificationGateErrors,
  specSe16nTables,
  sqlVerificationNeedsSe16n,
  sqlVerificationGateError
} from "./verification-gate"

const tc = (verification: string, tables: string[] = []) =>
  `---\nverification: ${verification}\nse16nTables: [${tables.join(", ")}]\n---\n# Case`

describe("SQL verification SE16N gate", () => {
  it("does not require SE16N without case frontmatter", () => {
    expect(sqlVerificationNeedsSe16n("# legacy spec-only case")).toBe(false)
  })

  it("requires every declared SE16N table for sql and mixed cases", () => {
    const spec = 'await sap.se16n({ table: "EKKO", outputFields: ["EBELN"] })'
    expect(sqlVerificationGateError("TC-001", tc("sql", ["EKKO", "EKPO"]), spec)).toMatch(
      /missing EKPO/
    )
    expect(sqlVerificationGateError("TC-001", tc("mixed", ["EKKO"]), spec)).toBeUndefined()
    expect(sqlVerificationGateError("TC-001", tc("sql"), spec)).toMatch(/no se16nTables/)
    expect(sqlVerificationGateError("TC-001", "---\nverification: sql\n---\n", spec)).toMatch(
      /no se16nTables/
    )
  })

  it("ignores comments and non-SQL verification", () => {
    expect(specSe16nTables('// await sap.se16n({ table: "EKKO" })')).toEqual([])
    expect(sqlVerificationGateError("TC-001", tc("manual"), "await sap.finish()")).toBeUndefined()
  })

  it("blocks matching SQL cases but ignores spec-only suites", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "se16n-gate-"))
    const scripts = path.join(root, "tests", "PROGRAM", "test-scripts")
    const cases = path.join(root, "tests", "PROGRAM", "test-cases")
    await fs.mkdir(scripts, { recursive: true })
    await fs.mkdir(cases, { recursive: true })
    await fs.writeFile(path.join(scripts, "TC-001.spec.ts"), "await sap.finish()")
    await fs.writeFile(path.join(cases, "TC-001.md"), tc("sql", ["EKKO"]))
    await fs.writeFile(path.join(scripts, "TC-002.spec.ts"), "await sap.finish()")
    await fs.writeFile(path.join(cases, "TC-003.md"), tc("sql", ["EKKO"]))

    await expect(findSqlVerificationGateErrors(root, "PROGRAM")).resolves.toEqual([
      expect.stringMatching(/^TC-001 requires SE16N proof for EKKO/)
    ])
    await fs.rm(root, { recursive: true, force: true })
  })

  it("checks only requested IDs and ignores missing case markdown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "se16n-selected-"))
    const scripts = path.join(root, "tests", "PROGRAM", "test-scripts")
    const cases = path.join(root, "tests", "PROGRAM", "test-cases")
    await fs.mkdir(scripts, { recursive: true })
    await fs.mkdir(cases, { recursive: true })
    await fs.writeFile(
      path.join(scripts, "TC-001.spec.ts"),
      'await sap.se16n({ table: "EKKO", outputFields: ["EBELN"] })'
    )
    await fs.writeFile(path.join(cases, "TC-001.md"), tc("sql", ["EKKO"]))
    await fs.writeFile(path.join(scripts, "TC-002.spec.ts"), "await sap.finish()")

    await expect(findSqlVerificationGateErrors(root, "PROGRAM", ["TC-001"])).resolves.toEqual([])
    await expect(findSqlVerificationGateErrors(root, "PROGRAM", ["TC-002"])).resolves.toEqual([])
    await expect(findSqlVerificationGateErrors(root, "PROGRAM", ["TC-003"])).resolves.toEqual([])
    await fs.rm(root, { recursive: true, force: true })
  })
})
