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
  | "failed" // at least one key could not be resolved

export type CheckFixturesResult = {
  total: number
  passed: number
  cached: string[]
  noCacheNeeded: string[]
  envPinned: string[]
  failures: Array<{ tcId: string; message: string }>
}

/** Does this TC declare any requirement that must come from a prepared data.json (sql/seeded)? */
async function needsPreparedCache(dataFile: string): Promise<boolean> {
  try {
    const fm = parseFrontmatter(await fs.readFile(dataFile, "utf8"))
    const requires = Array.isArray(fm?.requires) ? fm!.requires : []
    return requires.some((r: { source?: string }) => r?.source === "sql" || r?.source === "seeded")
  } catch {
    return false
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
  return fs
    .stat(p)
    .then(s => s.isFile())
    .catch(() => false)
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
    let passed = 0

    for (const tcId of tcIds) {
      const dataFile = path.join(testCasesDir, `${tcId}.data.md`)
      const needsCache = await needsPreparedCache(dataFile)
      try {
        // Explicit program scope — without it, resolveTestData would fall back to
        // searching the whole tests/ tree, which is exactly the cross-program TC-ID
        // collision this must not reintroduce.
        await resolveTestData(tcId, program)
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
      } catch (e) {
        failures.push({ tcId, message: (e as Error).message })
      }
    }

    return { total: tcIds.length, passed, cached, noCacheNeeded, envPinned, failures }
  } finally {
    // Restore — this runs inside the long-lived extension host, shared across tool
    // calls, so leaking these env vars would corrupt the NEXT unrelated call.
    if (previousRoot === undefined) delete process.env.SAP_TESTING_ROOT
    else process.env.SAP_TESTING_ROOT = previousRoot
    if (previousSystem === undefined) delete process.env.SAP_SYSTEM
    else process.env.SAP_SYSTEM = previousSystem
  }
}
