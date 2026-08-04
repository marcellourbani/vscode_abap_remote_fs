import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "./runtime/frontmatter"
import { KNOWN_CATEGORIES } from "./build-index"

const BLOCK_PATTERN = /<sap-test-case id="(TC-\d{3})">\s*\r?\n([\s\S]*?)\r?\n<\/sap-test-case>/g
const VALID_RUNNABLE = new Set(["runnable", "manual", "blocked-by-data", "runnable-elsewhere"])

type ParsedCase = {
  tcId: string
  content: string
  outputPath: string
}

export type SplitTestCasesResult = {
  sourcePath: string
  outputPaths: string[]
}

function assertInsideTestFolder(testFolder: string, sourcePath: string): void {
  const relative = path.relative(path.resolve(testFolder), sourcePath)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Source file must be inside the configured SAP Testing folder.")
  }
}

function validateBlock(tcId: string, rawContent: string, outputDir: string): ParsedCase {
  const content = `${rawContent.trim()}\n`
  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) {
    throw new Error(`${tcId} has no parseable frontmatter.`)
  }
  if (frontmatter.tcId !== tcId) {
    throw new Error(`${tcId} block declares tcId="${frontmatter.tcId ?? ""}". IDs must match.`)
  }
  if (!KNOWN_CATEGORIES.includes(frontmatter.category)) {
    throw new Error(
      `${tcId} has invalid category="${frontmatter.category ?? ""}". ` +
        `Valid: ${KNOWN_CATEGORIES.join(" | ")}.`
    )
  }
  if (!frontmatter.title) {
    throw new Error(`${tcId} has no title in frontmatter.`)
  }
  if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    throw new Error(`${tcId} has no non-empty description in frontmatter.`)
  }
  if (frontmatter.dataRequired !== "yes" && frontmatter.dataRequired !== "no") {
    throw new Error(
      `${tcId} has invalid or missing dataRequired="${frontmatter.dataRequired ?? ""}".`
    )
  }
  if (!VALID_RUNNABLE.has(frontmatter.runnable)) {
    throw new Error(`${tcId} has invalid runnable="${frontmatter.runnable ?? ""}".`)
  }

  const headings = content.match(/^# TC-\d{3}\b/gm) ?? []
  if (headings.length !== 1 || headings[0] !== `# ${tcId}`) {
    throw new Error(`${tcId} must contain exactly one "# ${tcId}" heading.`)
  }

  return {
    tcId,
    content,
    outputPath: path.join(outputDir, `${tcId}.md`)
  }
}

function parseCases(source: string, outputDir: string): ParsedCase[] {
  const cases: ParsedCase[] = []
  const seen = new Set<string>()
  let unmatched = ""
  let cursor = 0

  for (const match of source.matchAll(BLOCK_PATTERN)) {
    const index = match.index ?? 0
    unmatched += source.slice(cursor, index)
    cursor = index + match[0].length

    const tcId = match[1]
    if (seen.has(tcId)) {
      throw new Error(`Duplicate test-case block: ${tcId}.`)
    }
    seen.add(tcId)
    cases.push(validateBlock(tcId, match[2], outputDir))
  }
  unmatched += source.slice(cursor)

  if (unmatched.trim()) {
    throw new Error("Aggregate file contains content outside <sap-test-case> blocks.")
  }
  if (!cases.length) {
    throw new Error("Aggregate file contains no valid <sap-test-case> blocks.")
  }
  return cases
}

async function assertOutputsDoNotExist(cases: ParsedCase[]): Promise<void> {
  const conflicts: string[] = []
  for (const testCase of cases) {
    try {
      await fs.access(testCase.outputPath)
      conflicts.push(testCase.outputPath)
    } catch {
      // Expected: the destination does not exist.
    }
  }
  if (conflicts.length) {
    throw new Error(`Refusing to overwrite existing files: ${conflicts.join(", ")}`)
  }
}

export async function splitTestCases(
  testFolder: string,
  inputPath: string
): Promise<SplitTestCasesResult> {
  if (!path.isAbsolute(inputPath)) {
    throw new Error("sourcePath must be an absolute path.")
  }

  const sourcePath = path.resolve(inputPath)
  assertInsideTestFolder(testFolder, sourcePath)
  if (path.basename(path.dirname(sourcePath)) !== "test-cases") {
    throw new Error("Source file must be directly inside a test-cases folder.")
  }
  if (!/^_bulk-[^\\/]+\.md$/.test(path.basename(sourcePath))) {
    throw new Error("Aggregate filename must match _bulk-*.md.")
  }

  const source = await fs.readFile(sourcePath, "utf8")
  if (!source.trim()) {
    throw new Error("Aggregate file is blank.")
  }

  const outputDir = path.dirname(sourcePath)
  const cases = parseCases(source, outputDir)
  await assertOutputsDoNotExist(cases)

  const nonce = `${process.pid}-${Date.now()}`
  const tempPaths = cases.map(testCase => `${testCase.outputPath}.${nonce}.tmp`)
  const writtenOutputs: string[] = []

  try {
    await Promise.all(
      cases.map((testCase, index) => fs.writeFile(tempPaths[index], testCase.content, "utf8"))
    )
    for (let index = 0; index < cases.length; index += 1) {
      await fs.rename(tempPaths[index], cases[index].outputPath)
      writtenOutputs.push(cases[index].outputPath)
    }
    await fs.unlink(sourcePath)
  } catch (error) {
    await Promise.allSettled([
      ...tempPaths.map(tempPath => fs.rm(tempPath, { force: true })),
      ...writtenOutputs.map(outputPath => fs.rm(outputPath, { force: true }))
    ])
    throw error
  }

  return {
    sourcePath,
    outputPaths: cases.map(testCase => testCase.outputPath)
  }
}
