/**
 * Deterministically rebuild tests/<PROGRAM>/test-cases/_index.md from the frontmatter
 * of every TC-*.md in that folder.
 *
 * Why this exists: `_index.md` used to be hand-authored and hand-maintained by the AI
 * ("never edit numbers in _index.md without also updating the source case" — easy to
 * say, easy to drift). Every fact this prints (counts, category buckets, .data.md
 * presence) is mechanically derived from the TC files themselves, so it can never
 * silently disagree with them.
 *
 * The free-text "## Notes" section (and anything after it) in an existing _index.md is
 * preserved verbatim across regenerations — that's the one part a human/AI actually
 * writes, not projects.
 *
 * Exposed to the AI as the `build_test_index` language model tool — see
 * src/tools/buildTestIndexTool.ts.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "./runtime/frontmatter"

type CaseRow = {
  tcId: string
  title: string
  description: string
  category: string
  priority: string
  runnable: string
  dataRequired: "yes" | "no"
  hasDataMd: boolean
  verification: string
  messagesExpected: string[]
  created: string
  changed: string
  file: string
}

export type BuildIndexResult = {
  indexPath: string
  analyzedOn: string
  sourceSnapshot: string
  caseCount: number
  warnings: string[]
  counts: {
    runnable: number
    manual: number
    blocked: number
    elsewhere: number
  }
}

export const KNOWN_CATEGORIES = [
  "happy-path",
  "boundary",
  "invalid",
  "mandatory",
  "authorization",
  "empty",
  "large",
  "idempotency",
  "cross-tx",
  "concurrency",
  "background-artifact",
  "discovered-control"
]

async function loadCases(testCasesDir: string, warnings: string[]): Promise<CaseRow[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(testCasesDir)
  } catch {
    throw new Error(`No such directory: ${testCasesDir}`)
  }
  const validCaseFile = /^TC-\d{3}\.md$/
  const validDataFile = /^TC-\d{3}\.data\.md$/
  const malformedTcFiles = entries.filter(
    entry =>
      /^TC-/i.test(entry) &&
      entry.endsWith(".md") &&
      !validCaseFile.test(entry) &&
      !validDataFile.test(entry)
  )
  if (malformedTcFiles.length) {
    throw new Error(
      `Invalid test-case filename(s): ${malformedTcFiles.join(", ")}. ` +
        "Use exactly one case per file named TC-NNN.md; range/group files are forbidden."
    )
  }

  // TC-NNN.md but NOT TC-NNN.data.md
  const tcFiles = entries.filter(entry => validCaseFile.test(entry))
  const rows: CaseRow[] = []
  for (const file of tcFiles) {
    const full = path.join(testCasesDir, file)
    const content = await fs.readFile(full, "utf8")
    const fm = parseFrontmatter(content)
    if (!fm) {
      throw new Error(`${file} has no parseable frontmatter.`)
    }
    const tcId = fm.tcId ?? file.replace(/\.md$/, "")
    const fileTcId = file.replace(/\.md$/, "")
    if (tcId !== fileTcId) {
      throw new Error(`${file} declares tcId="${tcId}". Frontmatter tcId must match the filename.`)
    }
    const dataMdPath = path.join(testCasesDir, `${tcId}.data.md`)
    const hasDataMd = await fs
      .stat(dataMdPath)
      .then(() => true)
      .catch(() => false)
    if (typeof fm.title !== "string" || !fm.title.trim()) {
      throw new Error(`${file} has no non-empty "title" frontmatter field.`)
    }
    if (typeof fm.description !== "string" || !fm.description.trim()) {
      throw new Error(`${file} has no non-empty "description" frontmatter field.`)
    }
    if (fm.dataRequired !== "yes" && fm.dataRequired !== "no") {
      throw new Error(
        `${file} has invalid or missing dataRequired="${fm.dataRequired ?? ""}". ` +
          "Use exactly dataRequired: yes or dataRequired: no."
      )
    }
    if (fm.dataRequired === "yes" && !hasDataMd) {
      // NOT a hard error: data specs (.data.md) are authored in the dedicated
      // define-data phase, which runs AFTER case design. During case design the
      // index is built while these sidecars legitimately do not exist yet. Surface
      // it as a warning so the gap stays visible; the define-data phase's own gate
      // requires this warning to reach zero before it hands off.
      warnings.push(
        `${tcId} declares dataRequired: yes but ${tcId}.data.md does not exist yet ` +
          `(author it in the define-data phase before preparing data or building scripts).`
      )
    }
    if (fm.dataRequired === "no" && hasDataMd) {
      throw new Error(`${file} declares dataRequired: no but ${tcId}.data.md exists.`)
    }
    // If a .data.md exists, its `requires:` MUST be real frontmatter (a --- delimited
    // block at the very top of the file). A misplaced requires — inside a ```yaml /
    // ```markdown code fence, or under a "## Requirements" heading — parses to nothing,
    // so resolveTestData silently returns zero keys and every data.<key> comes back
    // undefined, failing much later with a confusing "value is not a string" in setField.
    // Catch that here, loudly, at build time.
    if (hasDataMd) {
      const dataMdContent = await fs.readFile(dataMdPath, "utf8")
      const dataFm = parseFrontmatter(dataMdContent)
      const requires = dataFm && Array.isArray(dataFm.requires) ? dataFm.requires : null
      if (!requires || requires.length === 0) {
        throw new Error(
          `${tcId}.data.md exists but has no parseable "requires:" frontmatter. The requires ` +
            `block MUST be a "---"-delimited YAML frontmatter at the VERY TOP of the file — not ` +
            'inside a ```yaml / ```markdown code fence, and not under a "## Requirements" heading. ' +
            `As written, resolveTestData reads zero keys and every data.<key> silently resolves ` +
            `to undefined. Move the requires: block into top-of-file frontmatter.`
        )
      }
      const keyless = requires.filter((r: { key?: unknown }) => !r || typeof r.key !== "string")
      if (keyless.length) {
        throw new Error(
          `${tcId}.data.md has ${keyless.length} requires entr(y/ies) with no "key:" field. ` +
            `Every requirement needs a string key that the spec references as data.<key>.`
        )
      }
      // Key-alignment check: every `<data-key: k>` placeholder in the TC body (state table,
      // steps, expected result, post-test verification SQL, absence preconditions) MUST have a
      // matching `requires` entry — otherwise resolveTestData throws only much later, in Phase 6.
      const declaredKeys = new Set(
        requires
          .map((r: { key?: unknown }) => (typeof r.key === "string" ? r.key : ""))
          .filter(Boolean)
      )
      const placeholderKeys = new Set<string>()
      for (const m of content.matchAll(/<data-key:\s*([A-Za-z0-9_]+)\s*>/g)) {
        placeholderKeys.add(m[1])
      }
      const undeclared = [...placeholderKeys].filter(k => !declaredKeys.has(k))
      if (undeclared.length) {
        throw new Error(
          `${tcId}.md references <data-key: …> placeholder(s) not declared in ${tcId}.data.md: ` +
            `${undeclared.join(", ")}. Add a matching "requires:" entry (define-data) — otherwise ` +
            `resolveTestData resolves undefined and the spec fails at run time.`
        )
      }
      const unreferenced = [...declaredKeys].filter(k => !placeholderKeys.has(k))
      if (unreferenced.length) {
        // Not an error: post-test-verification-only keys and seeding references are legitimately
        // declared without a <data-key:> in the body. Surface as a warning to catch typos.
        warnings.push(
          `${tcId}.data.md declares key(s) not referenced by any <data-key: …> in ${tcId}.md: ` +
            `${unreferenced.join(", ")} (expected for post-test-verification-only or seeding keys; ` +
            `otherwise a typo).`
        )
      }
    }
    rows.push({
      tcId,
      title: fm.title.trim(),
      description: fm.description.trim(),
      category: fm.category ?? "uncategorized",
      priority: fm.priority ?? "medium",
      runnable: fm.runnable ?? "unspecified",
      dataRequired: fm.dataRequired,
      hasDataMd,
      verification: typeof fm.verification === "string" ? fm.verification : "unspecified",
      messagesExpected: Array.isArray(fm.messagesExpected) ? fm.messagesExpected : [],
      created: fm.created ?? "",
      changed: fm.changed ?? "",
      file
    })
  }
  rows.sort((a, b) => a.tcId.localeCompare(b.tcId, undefined, { numeric: true }))
  return rows
}

function coverageTable(rows: CaseRow[]): string {
  const byCategory = new Map<string, CaseRow[]>()
  for (const r of rows) {
    const list = byCategory.get(r.category) ?? []
    list.push(r)
    byCategory.set(r.category, list)
  }
  const lines = ["| Category | Count | TC-IDs |", "| --- | --- | --- |"]
  // Known categories first (in canonical order), even if zero, so gaps are visible.
  const seen = new Set<string>()
  for (const cat of KNOWN_CATEGORIES) {
    const list = byCategory.get(cat) ?? []
    seen.add(cat)
    lines.push(
      `| ${cat} | ${list.length} | ${list.length ? list.map(r => r.tcId).join(", ") : "—"} |`
    )
  }
  // Any category present in the data but not in the known list (e.g. a typo, or a
  // legitimately new category) is still shown, not silently dropped.
  for (const [cat, list] of byCategory) {
    if (seen.has(cat)) continue
    lines.push(`| ${cat} (unrecognized) | ${list.length} | ${list.map(r => r.tcId).join(", ")} |`)
  }
  return lines.join("\n")
}

function casesTable(rows: CaseRow[]): string {
  const cell = (value: string): string => value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|")
  const lines = [
    "| TC-ID | Title | Description | Category | Priority | Runnable? | Data required? | .data.md? | Verification | Messages expected | Created | Changed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ]
  for (const r of rows) {
    lines.push(
      `| ${r.tcId} | ${cell(r.title)} | ${cell(r.description)} | ${r.category} | ${r.priority} | ${r.runnable} | ${r.dataRequired} | ${r.hasDataMd ? "yes" : "no"} | ${r.verification} | ${cell(r.messagesExpected.join(", ") || "—")} | ${r.created || "—"} | ${r.changed || "—"} |`
    )
  }
  return lines.join("\n")
}

/** Reads analyzedOn and sourceSnapshot from existing _index.md frontmatter, if present. */
async function extractExistingIndexFrontmatter(
  indexPath: string
): Promise<{ analyzedOn: string; sourceSnapshot: string }> {
  try {
    const existing = await fs.readFile(indexPath, "utf8")
    const fm = parseFrontmatter(existing)
    return {
      analyzedOn: fm?.analyzedOn ?? "",
      sourceSnapshot: fm?.sourceSnapshot ?? ""
    }
  } catch {
    return { analyzedOn: "", sourceSnapshot: "" }
  }
}

async function validateSourceSnapshot(
  testFolder: string,
  program: string,
  sourceSnapshot: string
): Promise<{ absolutePath: string; storedPath: string }> {
  if (!sourceSnapshot.trim()) {
    throw new Error("sourceSnapshot is required.")
  }

  const absolutePath = path.resolve(testFolder, sourceSnapshot)
  const sourcesRoot = path.resolve(testFolder, "tests", program, "sources")
  const relativeToSources = path.relative(sourcesRoot, absolutePath)
  if (
    !relativeToSources ||
    relativeToSources.startsWith("..") ||
    path.isAbsolute(relativeToSources)
  ) {
    throw new Error(`sourceSnapshot must name a snapshot folder under tests/${program}/sources/.`)
  }

  let entries: string[]
  try {
    entries = await fs.readdir(absolutePath)
  } catch {
    throw new Error(`Source snapshot folder does not exist: ${absolutePath}`)
  }
  if (!entries.length) {
    throw new Error(`Source snapshot folder is empty: ${absolutePath}`)
  }

  const sourceFiles = await Promise.all(
    entries.map(async entry => {
      const fullPath = path.join(absolutePath, entry)
      const stat = await fs.stat(fullPath)
      return stat.isFile() && stat.size > 0
    })
  )
  if (!sourceFiles.some(Boolean)) {
    throw new Error(`Source snapshot has no non-empty files: ${absolutePath}`)
  }

  return {
    absolutePath,
    storedPath: path.relative(testFolder, absolutePath).replace(/\\/g, "/")
  }
}

async function extractExistingNotes(indexPath: string): Promise<string> {
  try {
    const existing = await fs.readFile(indexPath, "utf8")
    const idx = existing.indexOf("\n## Notes")
    if (idx >= 0) return existing.slice(idx + 1) // keep the "## Notes" heading itself
  } catch {
    // no existing file
  }
  return (
    "## Notes\n\n" +
    "_(no notes yet — explain any missing category or manually-triaged case here; " +
    "this section is preserved across future rebuilds)_\n"
  )
}

/**
 * Rebuild `<testFolder>/tests/<program>/test-cases/_index.md`.
 * Throws if the program's test-cases directory doesn't exist or has no TC-*.md files.
 */
export async function buildTestIndex(
  testFolder: string,
  program: string,
  sourceSnapshot: string
): Promise<BuildIndexResult> {
  const testCasesDir = path.resolve(testFolder, "tests", program, "test-cases")
  const indexPath = path.join(testCasesDir, "_index.md")
  const warnings: string[] = []

  const rows = await loadCases(testCasesDir, warnings)
  if (!rows.length) {
    throw new Error(`No TC-*.md files found under ${testCasesDir}`)
  }

  // _screens.md is a Phase 2 output that Phases 3–7 all depend on. Nothing else validates it,
  // yet it must exist with parseable top-of-file frontmatter (target/targetType/exploredOn/
  // exploredSystem). Surface a warning here rather than let a missing/malformed one surface as
  // a broken locator much later. (Warning, not a hard error: the index itself is still valid.)
  const screensPath = path.join(testCasesDir, "_screens.md")
  const screensRaw = await fs.readFile(screensPath, "utf8").catch(() => null)
  if (screensRaw === null) {
    warnings.push(
      `_screens.md is missing under ${testCasesDir} — explore-ui (Phase 2) must produce it ` +
        `before scripts can be built. Every later phase depends on it.`
    )
  } else if (!parseFrontmatter(screensRaw)) {
    warnings.push(
      `_screens.md has no parseable top-of-file YAML frontmatter (expected target/targetType/` +
        `exploredOn/exploredSystem as the first "---" block). Fix its frontmatter placement.`
    )
  }

  const unspecified = rows.filter(r => r.runnable === "unspecified")
  if (unspecified.length) {
    warnings.push(
      `${unspecified.length} case(s) have no "runnable" frontmatter field ` +
        `(treated as "unspecified"): ${unspecified.map(r => r.tcId).join(", ")}`
    )
  }

  const validRunnableValues = new Set([
    "runnable",
    "manual",
    "blocked-by-data",
    "runnable-elsewhere"
  ])
  const wrongRunnable = rows.filter(
    r => r.runnable !== "unspecified" && !validRunnableValues.has(r.runnable)
  )
  if (wrongRunnable.length) {
    warnings.push(
      `${wrongRunnable.length} case(s) have an invalid "runnable" value — ` +
        `valid: runnable | manual | blocked-by-data | runnable-elsewhere. ` +
        `These cases count as "unspecified" in summary totals: ` +
        wrongRunnable.map(r => `${r.tcId}="${r.runnable}"`).join(", ")
    )
  }

  const validVerificationValues = new Set(["sql", "manual", "mixed", "none"])
  const missingVerification = rows.filter(r => r.verification === "unspecified")
  if (missingVerification.length) {
    warnings.push(
      `${missingVerification.length} case(s) have no "verification" frontmatter field ` +
        `(sql | manual | mixed | none). Every runnable case that changes system state must ` +
        `declare how its post-test verification happens: ${missingVerification.map(r => r.tcId).join(", ")}`
    )
  }
  const wrongVerification = rows.filter(
    r => r.verification !== "unspecified" && !validVerificationValues.has(r.verification)
  )
  if (wrongVerification.length) {
    warnings.push(
      `${wrongVerification.length} case(s) have an invalid "verification" value — ` +
        `valid: sql | manual | mixed | none: ` +
        wrongVerification.map(r => `${r.tcId}="${r.verification}"`).join(", ")
    )
  }

  const knownCategorySet = new Set(KNOWN_CATEGORIES)
  const unrecognizedCategories = rows.filter(r => !knownCategorySet.has(r.category))
  if (unrecognizedCategories.length) {
    throw new Error(
      `${unrecognizedCategories.length} case(s) use unrecognized category values — ` +
        `valid: ${KNOWN_CATEGORIES.join(" | ")}. ` +
        `Invalid cases: ` +
        unrecognizedCategories.map(r => `${r.tcId}="${r.category}"`).join(", ")
    )
  }

  const counts = {
    runnable: rows.filter(r => r.runnable === "runnable").length,
    manual: rows.filter(r => r.runnable === "manual").length,
    blocked: rows.filter(r => r.runnable === "blocked-by-data").length,
    elsewhere: rows.filter(r => r.runnable === "runnable-elsewhere").length
  }

  const notes = await extractExistingNotes(indexPath)
  const existing = await extractExistingIndexFrontmatter(indexPath)
  const validatedSnapshot = await validateSourceSnapshot(testFolder, program, sourceSnapshot)
  const analyzedOn =
    existing.sourceSnapshot === validatedSnapshot.storedPath && existing.analyzedOn
      ? existing.analyzedOn
      : new Date().toISOString()

  const frontmatter = [
    "---",
    `program: ${program}`,
    `analyzedOn: ${analyzedOn}`,
    `sourceSnapshot: ${validatedSnapshot.storedPath}`,
    "---"
  ].join("\n")

  const content = `${frontmatter}

# Test-case index — ${program}

Auto-generated by the build_test_index tool — do not hand-edit the tables below (the "## Notes" section at the bottom IS preserved and safe to edit).

Last built: ${new Date().toISOString()} | Total cases: ${rows.length} | Runnable: ${counts.runnable} | Manual: ${counts.manual} | Blocked: ${counts.blocked} | Runnable-elsewhere: ${counts.elsewhere}

## Coverage overview

${coverageTable(rows)}

## Cases

${casesTable(rows)}

${notes}`

  await fs.writeFile(indexPath, content, "utf8")

  return {
    indexPath,
    analyzedOn,
    sourceSnapshot: validatedSnapshot.storedPath,
    caseCount: rows.length,
    warnings,
    counts
  }
}
