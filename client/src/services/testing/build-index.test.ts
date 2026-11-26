import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { buildTestIndex } from "./build-index"
import { parseFrontmatter } from "./runtime/frontmatter"

const scoped = { skipWorkflowValidation: true }
const snapshot = "tests/PROGRAM/sources/snapshot"
let root: string
let cases: string

async function writeCase(extra = "verification: manual", dataRequired = "no") {
  await fs.writeFile(
    path.join(cases, "TC-001.md"),
    `---
tcId: TC-001
title: Execute report
description: Verify the requested behavior
category: happy-path
runnable: runnable
dataRequired: ${dataRequired}
${extra}
---
# Execute report
`
  )
}

async function writeSnapshot() {
  await fs.mkdir(path.join(root, snapshot), { recursive: true })
  await fs.writeFile(path.join(root, snapshot, "report.abap"), "REPORT example.")
}

async function indexContent() {
  return fs.readFile(path.join(cases, "_index.md"), "utf8")
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "build-index-"))
  cases = path.join(root, "tests", "PROGRAM", "test-cases")
  await fs.mkdir(cases, { recursive: true })
  await writeCase()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe("buildTestIndex workflow validation", () => {
  it("requires a source snapshot by default even with explicit false options", async () => {
    await expect(buildTestIndex(root, "PROGRAM")).rejects.toThrow("sourceSnapshot is required")
    await expect(
      buildTestIndex(root, "PROGRAM", undefined, { skipWorkflowValidation: false })
    ).rejects.toThrow("sourceSnapshot is required")
  })

  it("retains snapshot existence and content validation by default", async () => {
    await expect(buildTestIndex(root, "PROGRAM", snapshot)).rejects.toThrow("does not exist")
    await fs.mkdir(path.join(root, snapshot), { recursive: true })
    await expect(buildTestIndex(root, "PROGRAM", snapshot)).rejects.toThrow("is empty")
    await fs.writeFile(path.join(root, snapshot, "empty.abap"), "")
    await expect(buildTestIndex(root, "PROGRAM", snapshot)).rejects.toThrow("no non-empty files")
  })

  it.each(["sql", "mixed"])("requires se16nTables for %s by default", async verification => {
    await writeSnapshot()
    await writeCase(`verification: ${verification}`)
    await expect(buildTestIndex(root, "PROGRAM", snapshot)).rejects.toThrow("no se16nTables")
  })

  it("builds without sources or SQL tables under override and marks the scope honestly", async () => {
    await writeCase("verification: sql")
    const result = await buildTestIndex(root, "PROGRAM", undefined, scoped)
    expect(result).toMatchObject({ analyzedOn: "", sourceSnapshot: "", caseCount: 1 })
    const content = await indexContent()
    expect(parseFrontmatter(content)).toMatchObject({
      analyzedOn: "",
      sourceSnapshot: "",
      workflowValidation: "bypassed",
      sourceSnapshotStatus: "unverified"
    })
    expect(content).toContain("WORKFLOW VALIDATION BYPASSED")
    expect(content).toContain("does not certify the full workflow")
    expect(content).toContain("| TC-001 | Execute report |")
    expect(result.warnings).toContainEqual(expect.stringContaining("were not verified"))
  })

  it("treats an explicitly supplied bypass snapshot as unverified provenance, not a disk prerequisite", async () => {
    const provenance = "user supplied: snapshot #1"
    const result = await buildTestIndex(root, "PROGRAM", provenance, scoped)
    expect(result.sourceSnapshot).toBe(provenance)
    expect(result.analyzedOn).toBe("")
    expect(parseFrontmatter(await indexContent())?.sourceSnapshot).toBe(provenance)
  })

  it("preserves historical metadata and notes when the snapshot is omitted under override", async () => {
    await writeSnapshot()
    const original = await buildTestIndex(root, "PROGRAM", snapshot)
    await fs.appendFile(path.join(cases, "_index.md"), "\nHistorical note.\n")
    await fs.rm(path.join(root, "tests", "PROGRAM", "sources"), { recursive: true })
    const result = await buildTestIndex(root, "PROGRAM", undefined, scoped)
    expect(result.analyzedOn).toBe(original.analyzedOn)
    expect(result.sourceSnapshot).toBe(snapshot)
    expect(parseFrontmatter(await indexContent())).toMatchObject({
      sourceSnapshotStatus: "historical-not-revalidated"
    })
    expect(await indexContent()).toContain("Historical note.")
    expect(await indexContent()).toContain("historical and was not revalidated")
  })

  it("does not transfer historical analysis certification to a changed snapshot", async () => {
    await writeSnapshot()
    await buildTestIndex(root, "PROGRAM", snapshot)
    const result = await buildTestIndex(root, "PROGRAM", "different provenance", scoped)
    expect(result.analyzedOn).toBe("")
    expect(result.sourceSnapshot).toBe("different provenance")
  })

  it("does not certify previously unverified provenance during another scoped rebuild", async () => {
    await buildTestIndex(root, "PROGRAM", "unverified provenance", scoped)
    expect((await buildTestIndex(root, "PROGRAM", undefined, scoped)).analyzedOn).toBe("")
  })

  it("removes the bypass marker after a successful default rebuild", async () => {
    await buildTestIndex(root, "PROGRAM", snapshot, scoped)
    await writeSnapshot()
    const result = await buildTestIndex(root, "PROGRAM", snapshot)
    expect(result.analyzedOn).not.toBe("")
    expect(parseFrontmatter(await indexContent())?.workflowValidation).toBeUndefined()
    expect(await indexContent()).not.toContain("WORKFLOW VALIDATION BYPASSED")
  })

  it("still rejects malformed sidecar data under override", async () => {
    await writeCase("verification: sql", "yes")
    await fs.writeFile(path.join(cases, "TC-001.data.md"), "# Not frontmatter\nrequires: []")
    await expect(buildTestIndex(root, "PROGRAM", undefined, scoped)).rejects.toThrow(
      'no parseable "requires:" frontmatter'
    )
  })

  it("still rejects mismatched case IDs and malformed filenames under override", async () => {
    await fs.rename(path.join(cases, "TC-001.md"), path.join(cases, "TC-002.md"))
    await expect(buildTestIndex(root, "PROGRAM", undefined, scoped)).rejects.toThrow(
      "tcId must match the filename"
    )
    await fs.rename(path.join(cases, "TC-002.md"), path.join(cases, "TC-001-002.md"))
    await expect(buildTestIndex(root, "PROGRAM", undefined, scoped)).rejects.toThrow(
      "Invalid test-case filename"
    )
  })

  it("still rejects an invalid category under override", async () => {
    const file = path.join(cases, "TC-001.md")
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace("happy-path", "invalid-category")
    )
    await expect(buildTestIndex(root, "PROGRAM", undefined, scoped)).rejects.toThrow(
      "unrecognized category"
    )
  })
})
