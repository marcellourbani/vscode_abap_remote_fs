/**
 * Deterministically cross-check a Playwright spec against its data spec: every
 * `data.<key>` referenced in the .spec.ts must have a matching entry in the
 * .data.md's `requires:` list, and vice versa.
 *
 * Why this exists: `prepare-data/SKILL.md`'s "verify the spec can now run" step used
 * to be an optional, AI-memory-dependent manual read-through. This makes it a real,
 * deterministic check that either passes or lists exactly what's wrong.
 *
 * Exposed to the AI as the `verify_test_data_usage` language model tool — see
 * src/tools/verifyTestDataUsageTool.ts.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "./runtime/frontmatter"

export type VerifyResult = {
  ok: boolean
  /** True when no .data.md exists and the spec doesn't call resolveTestData — nothing to check. */
  skipped: boolean
  usedNotDeclared: string[]
  declaredNotUsed: string[]
  messages: string[]
}

export async function verifyTestDataUsage(
  testFolder: string,
  program: string,
  tcId: string
): Promise<VerifyResult> {
  const specPath = path.resolve(testFolder, "tests", program, "test-scripts", `${tcId}.spec.ts`)
  const dataMdPath = path.resolve(testFolder, "tests", program, "test-cases", `${tcId}.data.md`)

  const specContent = await fs.readFile(specPath, "utf8").catch(() => null)
  if (specContent === null) {
    throw new Error(`No spec found at ${specPath}`)
  }

  const dataMdContent = await fs.readFile(dataMdPath, "utf8").catch(() => null)
  const callsResolveTestData = /resolveTestData\s*\(/.test(specContent)

  if (!callsResolveTestData) {
    if (dataMdContent !== null) {
      return {
        ok: true,
        skipped: true,
        usedNotDeclared: [],
        declaredNotUsed: [],
        messages: [
          `${tcId}.data.md exists but the spec never calls resolveTestData() — ` +
            `either the spec should use it, or the .data.md is stale.`
        ]
      }
    }
    return {
      ok: true,
      skipped: true,
      usedNotDeclared: [],
      declaredNotUsed: [],
      messages: [`${tcId} needs no test data (no .data.md, spec doesn't call resolveTestData).`]
    }
  }

  if (dataMdContent === null) {
    throw new Error(
      `${specPath} calls resolveTestData("${tcId}") but ${dataMdPath} does not exist. ` +
        `resolveTestData will throw at runtime because there is nothing to resolve.`
    )
  }

  const fm = parseFrontmatter(dataMdContent)
  const hasRequiresFrontmatter = Array.isArray(fm?.requires)
  const declared: string[] = hasRequiresFrontmatter
    ? fm!.requires.map((r: any) => r.key).filter(Boolean)
    : []

  // Common, silent failure: the requires block is present in the file but NOT as
  // top-of-file frontmatter (it's in a ```yaml/```markdown fence or under a heading).
  // parseFrontmatter then returns no requires, resolveTestData resolves zero keys, and
  // every data.<key> comes back undefined at runtime. Detect and name it precisely.
  if (!hasRequiresFrontmatter && /(^|\n)\s*requires\s*:/.test(dataMdContent)) {
    return {
      ok: false,
      skipped: false,
      usedNotDeclared: [],
      declaredNotUsed: [],
      messages: [
        `FAIL: ${tcId}.data.md contains a "requires:" block but NOT as top-of-file frontmatter, ` +
          `so it parses to zero requirements and resolveTestData will resolve nothing. Move the ` +
          `requires: block into a "---"-delimited YAML frontmatter at the VERY TOP of the file ` +
          '(not inside a ```yaml / ```markdown code fence, not under a "## Requirements" heading).'
      ]
    }
  }

  // data.<key> and data["key"] / data['key']
  // Strip comments first to avoid false-positives on lines like:
  //   // DataSpec: TC-001.data.md            ("data.md" would match as key "md")
  //   /** ... TC-001.data.md ... */         (the JSDoc header emitted by build-scripts)
  // Order matters: strip block comments (which may span multiple lines including newlines)
  // BEFORE splitting on newlines to strip line comments.
  const strippedSpec = specContent
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map(line => line.replace(/\/\/.*$/, ""))
    .join("\n")
  const usedSet = new Set<string>()
  for (const m of strippedSpec.matchAll(/\bdata\.([A-Za-z0-9_]+)/g)) usedSet.add(m[1])
  for (const m of strippedSpec.matchAll(/\bdata\[["']([A-Za-z0-9_]+)["']\]/g)) usedSet.add(m[1])
  const used = [...usedSet]

  const declaredSet = new Set(declared)
  const usedNotDeclared = used.filter(k => !declaredSet.has(k))
  const declaredNotUsed = declared.filter(k => !usedSet.has(k))

  // A declared key the SPEC doesn't use is not automatically stale — it may be consumed
  // outside the spec: as a `<data-key: k>` placeholder in the TC's `## Post-test verification`
  // SQL, its `## Absence preconditions`, or as a seeding reference. Read the TC-XXX.md and
  // treat any declared-not-used key that IS referenced there as legitimate (informational),
  // and warn only about keys referenced NOWHERE.
  const tcMdPath = path.resolve(testFolder, "tests", program, "test-cases", `${tcId}.md`)
  const tcMdContent = await fs.readFile(tcMdPath, "utf8").catch(() => "")
  const tcBodyKeys = new Set<string>()
  for (const m of tcMdContent.matchAll(/<data-key:\s*([A-Za-z0-9_]+)\s*>/g)) tcBodyKeys.add(m[1])
  const usedElsewhere = declaredNotUsed.filter(k => tcBodyKeys.has(k))
  const trulyUnused = declaredNotUsed.filter(k => !tcBodyKeys.has(k))

  const messages: string[] = []
  let ok = true
  if (usedNotDeclared.length) {
    ok = false
    messages.push(
      `FAIL: ${tcId}.spec.ts references data.<key> not declared in ${tcId}.data.md: ` +
        usedNotDeclared.join(", ")
    )
  }
  if (usedElsewhere.length) {
    messages.push(
      `INFO: ${tcId}.data.md declares keys the spec doesn't use but ${tcId}.md references ` +
        `(post-test verification / absence precondition / seeding) — these are expected: ` +
        usedElsewhere.join(", ")
    )
  }
  if (trulyUnused.length) {
    messages.push(
      `WARNING: ${tcId}.data.md declares keys used neither in the spec nor in ${tcId}.md: ` +
        trulyUnused.join(", ")
    )
  }
  if (ok) {
    messages.push(
      `OK: every data.<key> in the spec is declared in .data.md (${used.length} key(s)).`
    )
  }

  return { ok, skipped: false, usedNotDeclared, declaredNotUsed, messages }
}
