/**
 * Pre-flight check: for every TC-*.data.md under a program, resolve its test data
 * against a given system using the EXACT SAME resolveTestData() the Playwright specs
 * use at run time — so this can never drift from what a real run would see. Reports
 * every missing key (unresolved SQL cache, unprepared static/generated fixture, etc.)
 * before spending time on a real test run.
 *
 * It ALSO classifies every PASSING case so a green result can't be misread as "all
 * data is prepared". A case that resolves purely from `static`/`generated` sources
 * needs no per-system cache and would pass on a brand-new system with zero prep — that
 * is very different from a case whose `sql`/`seeded` values were actually resolved from
 * a prepared `data.json`. The old tool collapsed both into one "N/N resolvable" number,
 * which gave false confidence that data preparation had happened when, for the
 * cache-free cases, there was nothing to prepare in the first place.
 *
 * Exposed to the AI as the `check_test_data` language model tool — see
 * src/tools/checkTestDataTool.ts.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "./runtime/frontmatter"
// resolveTestData reads SAP_TESTING_ROOT / SAP_SYSTEM at call time, not module load,
// so a static import is safe despite checkTestData setting them just before calling.
import { resolveTestData } from "./runtime/test-data"

export type CaseDataStatus =
  | "cached" // needs a data.json (sql/seeded keys) AND one is present and resolved
  | "no-cache-needed" // resolves from static/generated only — no per-system prep required
  | "env-pinned" // needs a cache but resolved from a TESTDATA_* env override instead
  | "seed-pending" // a seeded requirement can't resolve yet (its viaTcId spec/run isn't done)
  | "failed" // at least one key could not be resolved

export type CheckFixturesResult = {
  total: number
  passed: number
  cached: string[]
  noCacheNeeded: string[]
  envPinned: string[]
  /** seeded cases whose precondition hasn't been produced yet — deferred, NOT a hard failure */
  seedPending: string[]
  failures: Array<{ tcId: string; message: string }>
  /** two keys in one case that must differ (distinctFrom) resolved to the SAME value */
  distinctViolations: Array<{ tcId: string; message: string }>
  /** a data.json holds a static/generated key it shouldn't — the cache shadows the spec */
  shadowWarnings: Array<{ tcId: string; message: string }>
}

type Requirement = {
  key?: string
  source?: string
  distinctFrom?: string[]
}

/** Read a .data.md's `requires:` array (empty on any parse problem). */
async function readRequires(dataFile: string): Promise<Requirement[]> {
  try {
    const fm = parseFrontmatter(await fs.readFile(dataFile, "utf8"))
    return Array.isArray(fm?.requires) ? (fm!.requires as Requirement[]) : []
  } catch {
    return []
  }
}

/** Does this TC declare any requirement that must come from a prepared data.json (sql/seeded)? */
function needsPreparedCache(requires: Requirement[]): boolean {
  return requires.some(r => r?.source === "sql" || r?.source === "seeded")
}

/** Load a case's data.json values (keys only), or null if absent/unparseable. */
async function loadDataJson(
  testFolder: string,
  program: string,
  system: string,
  tcId: string
): Promise<Record<string, unknown> | null> {
  const p = path.resolve(
    testFolder,
    "tests",
    program,
    "test-results",
    system.toUpperCase(),
    tcId,
    "data.json"
  )
  try {
    const parsed = JSON.parse(await fs.readFile(p, "utf8"))
    const { _meta, ...values } = parsed
    void _meta
    return values
  } catch {
    return null
  }
}

async function dataJsonExists(
  testFolder: string,
  program: string,
  system: string,
  tcId: string
): Promise<boolean> {
  const p = path.resolve(
    testFolder,
    "tests",
    program,
    "test-results",
    system.toUpperCase(),
    tcId,
    "data.json"
  )
  if (
    await fs
      .stat(p)
      .then(s => s.isFile())
      .catch(() => false)
  ) {
    return true
  }
  // Case-insensitive fallback: a hand-written folder may not match the uppercased system.
  const resultsRoot = path.resolve(testFolder, "tests", program, "test-results")
  try {
    const entries = await fs.readdir(resultsRoot)
    const match = entries.find(e => e.toUpperCase() === system.toUpperCase())
    if (match) {
      return fs
        .stat(path.join(resultsRoot, match, tcId, "data.json"))
        .then(s => s.isFile())
        .catch(() => false)
    }
  } catch {
    // no results root
  }
  return false
}

export async function checkTestData(
  testFolder: string,
  program: string,
  system: string
): Promise<CheckFixturesResult> {
  const previousRoot = process.env.SAP_TESTING_ROOT
  const previousSystem = process.env.SAP_SYSTEM
  process.env.SAP_TESTING_ROOT = testFolder
  process.env.SAP_SYSTEM = system.toUpperCase()

  try {
    const testCasesDir = path.resolve(testFolder, "tests", program, "test-cases")
    let entries: string[]
    try {
      entries = await fs.readdir(testCasesDir)
    } catch {
      throw new Error(`No such directory: ${testCasesDir}`)
    }

    const tcIds = entries
      .filter(e => e.endsWith(".data.md"))
      .map(e => e.replace(/\.data\.md$/, ""))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

    const failures: Array<{ tcId: string; message: string }> = []
    const cached: string[] = []
    const noCacheNeeded: string[] = []
    const envPinned: string[] = []
    const seedPending: string[] = []
    const distinctViolations: Array<{ tcId: string; message: string }> = []
    const shadowWarnings: Array<{ tcId: string; message: string }> = []
    let passed = 0

    for (const tcId of tcIds) {
      const dataFile = path.join(testCasesDir, `${tcId}.data.md`)
      const requires = await readRequires(dataFile)
      const needsCache = needsPreparedCache(requires)
      try {
        // Explicit program scope — without it, resolveTestData would fall back to
        // searching the whole tests/ tree, which is exactly the cross-program TC-ID
        // collision this must not reintroduce.
        const resolved = await resolveTestData(tcId, program)
        passed++
        if (!needsCache) {
          noCacheNeeded.push(tcId)
        } else if (await dataJsonExists(testFolder, program, system, tcId)) {
          cached.push(tcId)
        } else {
          // It needed a cache and none exists on disk, yet it resolved — the only way
          // that happens is a TESTDATA_* env override. Flag it so nobody assumes the
          // repo/system is self-sufficient.
          envPinned.push(tcId)
        }

        // Cross-key uniqueness (distinctFrom): two keys in this case that must differ but
        // resolved to the same value. resolveTestData can't check this (one TC at a time),
        // so it's enforced here where we have every key's resolved value.
        for (const r of requires) {
          if (!r.key || !Array.isArray(r.distinctFrom)) continue
          for (const other of r.distinctFrom) {
            if (
              resolved[r.key] !== undefined &&
              resolved[other] !== undefined &&
              resolved[r.key] === resolved[other]
            ) {
              distinctViolations.push({
                tcId,
                message: `keys "${r.key}" and "${other}" must differ (distinctFrom) but both resolved to "${resolved[r.key]}"`
              })
            }
          }
        }

        // Shadow warning: a static/generated key that was nonetheless written into data.json —
        // the cached copy overrides the spec at run time, so later edits to the .data.md silently
        // have no effect. prepare-data must cache only sql/seeded keys.
        const dj = await loadDataJson(testFolder, program, system, tcId)
        if (dj) {
          for (const r of requires) {
            if (!r.key) continue
            if ((r.source === "static" || r.source === "generated") && r.key in dj) {
              shadowWarnings.push({
                tcId,
                message: `"${r.key}" (source: ${r.source}) is cached in data.json — it shadows the spec; remove it so the .data.md stays authoritative`
              })
            }
          }
        }
      } catch (e) {
        const message = (e as Error).message
        // A seeded precondition that hasn't been produced yet is DEFERRED, not a hard
        // failure — it resolves after its viaTcId spec exists and runs (see prepare-data
        // Step 2b). Classify it separately so a first-pass check isn't reported as broken.
        if (/requires seeding via/i.test(message)) {
          seedPending.push(tcId)
        } else {
          failures.push({ tcId, message })
        }
      }
    }

    return {
      total: tcIds.length,
      passed,
      cached,
      noCacheNeeded,
      envPinned,
      seedPending,
      failures,
      distinctViolations,
      shadowWarnings
    }
  } finally {
    // Restore — this runs inside the long-lived extension host, shared across tool
    // calls, so leaking these env vars would corrupt the NEXT unrelated call.
    if (previousRoot === undefined) delete process.env.SAP_TESTING_ROOT
    else process.env.SAP_TESTING_ROOT = previousRoot
    if (previousSystem === undefined) delete process.env.SAP_SYSTEM
    else process.env.SAP_SYSTEM = previousSystem
  }
}
