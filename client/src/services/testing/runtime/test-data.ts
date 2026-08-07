/**
 * TestData — resolves test-data at runtime from a sidecar file, per test case.
 *
 * Convention: each test case may have a companion  test-cases/<TC-ID>.data.md  file.
 * At the top of the .data.md is a YAML frontmatter block declaring the data the spec
 * needs, plus SQL/static/generated/seeded instructions describing HOW to obtain it in
 * ANY SAP system (not just the system where it was originally authored).
 *
 * Example  test-cases/TC-042.data.md:
 *
 *   ---
 *   tcId: TC-042
 *   requires:
 *     - key: sample_material
 *       description: A material of type FERT with plant assignment
 *       source: sql
 *       sql: |
 *         SELECT matnr FROM mara WHERE mtart = 'FERT'
 *         AND EXISTS (SELECT 1 FROM marc WHERE marc.matnr = mara.matnr)
 *       take: first
 *     - key: sample_plant
 *       description: A plant with at least 10 materials
 *       source: sql
 *       sql: |
 *         SELECT werks FROM marc GROUP BY werks HAVING COUNT(*) > 10
 *       take: first
 *     - key: upload_fixture
 *       description: Excel file with one valid row for sample_material/sample_plant
 *       source: generated
 *       generator: fixture-builder
 *       args:
 *         format: xlsx
 *         filename: upload_valid.xlsx
 *         columns: [Material, Plant, Start Date, End Date]
 *         rows:
 *           - ["{{sample_material}}", "{{sample_plant}}", "+30d", "+31d"]
 *   ---
 *
 *   ## Manual override
 *   You can pin values by setting env vars TESTDATA_TC_042_sample_material=... before running.
 *
 * At runtime, the test calls (passing `testInfo` so the lookup is scoped to THIS
 * program, not the whole tests/ tree — see resolveTestData's own doc below):
 *   const data = await resolveTestData("TC-042", testInfo)
 *   await sap.setField("Material", data.sample_material)
 *
 * Resolution order per requirement (first match wins):
 *   1. process.env["TESTDATA_" + tcId + "_" + system + "_" + key]  (system-specific pin)
 *      or process.env["TESTDATA_" + tcId + "_" + key]               (cross-system pin)
 *   2. source: "generated"  -> built FRESH on every call via helpers/fixture-builder.ts.
 *      Never cached — the whole point of this source is that it's cheap enough to
 *      rebuild every run, so baked-in absolute dates can never go stale.
 *   3. per-system cache file: tests/<program>/test-results/<SYSTEM>/<TC-ID>/data.json
 *      (written by the `prepare-data` skill — this is where source: "sql" and
 *      source: "seeded" values actually come from; this process never runs SQL or
 *      writes to SAP itself)
 *   4. source: "static"  ->  staticValue straight out of the .data.md
 *   5. otherwise -> throws, naming every missing key
 *
 * Any requirement resolved to a filesystem path (source: "generated", or any source
 * with `expect: "file"`) is verified to exist and be non-empty before being returned —
 * a missing/empty fixture fails here, with the same actionable message as any other
 * missing key, instead of surfacing later as an opaque Playwright upload error.
 *
 * Rationale: the Playwright test process should not talk to SAP DB directly. Data
 * preparation (source: "sql" / "seeded") is a separate concern, owned by the
 * `prepare-data` skill, using the ABAP tools
 * available to the AI/human running it. This module's job is only to reliably CONSUME
 * the resolved values (and deterministically build file fixtures) inside the spec.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "./frontmatter"
import { buildFixture, FixtureSpec } from "./fixture-builder"

export type DataRequirementSource = "sql" | "static" | "user" | "generated" | "seeded"

export type DataRequirement = {
  key: string
  description: string
  source: DataRequirementSource
  /** source: "sql" */
  sql?: string
  take?: "first" | "last" | "any"
  /** source: "static" */
  staticValue?: string
  /**
   * Optional on ANY source: this requirement resolves to a filesystem path.
   * Verified to exist and be non-empty before resolveTestData returns it.
   * Implied automatically for source: "generated".
   */
  expect?: "file"
  /** source: "generated" — built via helpers/fixture-builder.ts, never cached. */
  generator?: "fixture-builder"
  args?: FixtureSpec
  /**
   * source: "seeded" — this precondition can only be created by running another
   * already-automated TC's spec first (e.g. a report that needs a DB row that only
   * the report itself can write). Resolving this is the `prepare-data` skill's job:
   * run the referenced spec once (explicit user approval — it performs a real write),
   * then read the resulting value back (typically via `sql`) and cache it like any
   * other resolved value. This module does not run specs itself; a `seeded` key with
   * no cache entry is reported as missing, same as an unresolved `sql` key.
   */
  seed?: { viaTcId: string; manualSteps?: string }
  /**
   * Cross-key uniqueness: the names of other requirement keys this value MUST differ from.
   * Declared on BOTH keys of a pair. Not enforced at run time here (resolveTestData handles
   * one TC at a time); it is enforced during prepare-data by check_test_data, which resolves
   * the whole program and fails on a collision. Carried in the type so tooling can read it.
   */
  distinctFrom?: string[]
}

export type ResolvedData = Record<string, string>

/** Current target system (DEV/QAS/PRD/...) — from SAP_SYSTEM env, defaults to DEV. */
function currentSystem(): string {
  return (process.env.SAP_SYSTEM ?? "DEV").toUpperCase()
}

/**
 * Root of the test folder (contains `tests/<program>/...`). When `playwright_test`
 * spawns a spec, it sets both `cwd` AND `SAP_TESTING_ROOT` to the configured test
 * folder, so this works whether or not the caller happens to also be running with
 * that cwd. Extension-host code (the maintenance tools, which run inside the
 * long-lived extension process, not a spawned spec) always has a different cwd, so
 * it MUST go through `SAP_TESTING_ROOT` — set it before calling into this module.
 */
function testRoot(): string {
  return process.env.SAP_TESTING_ROOT ?? process.cwd()
}

/**
 * Data cache is scoped per (test-case, system). Same test can have different valid
 * material numbers / plants / orders in DEV vs QAS vs PRD, so caches never cross systems.
 * Files:  tests/<program>/test-results/<SYSTEM>/<TC-ID>/data.json
 * Env override:  TESTDATA_<TCID>_<key>       — applies to all systems (use with care)
 *                TESTDATA_<TCID>_<SYSTEM>_<key> — system-specific (preferred)
 *
 * `scope` disambiguates WHICH program's `<TC-ID>.data.md` to use. Every program's test
 * cases restart numbering at TC-001, so without a scope, two programs sharing a TC-ID
 * would silently resolve whichever one the filesystem walk happens to hit first — a
 * real cross-program data leak, not a hypothetical one. Pass either:
 *   - Playwright's `testInfo` (has a `.file` pointing at the calling spec) — the normal
 *     case, since every spec already receives `testInfo` as its second test argument, or
 *   - a plain program-name string (for tooling that isn't a running spec, e.g. scripts/check-fixtures.ts)
 * Omitting `scope` falls back to the old whole-`tests/`-tree search, kept only for
 * backward compatibility with any caller that predates this parameter — always prefer
 * passing it.
 */
export async function resolveTestData(
  tcId: string,
  scope?: { file?: string } | string
): Promise<ResolvedData> {
  const system = currentSystem()
  const programDir = resolveProgramDir(scope)
  const dataFile = await findDataFile(tcId, programDir)
  const cache = await loadCache(dataFile, tcId, system)
  const requirements = await loadRequirementsFromFile(dataFile)
  const tcSlug = tcId.replace(/[^A-Z0-9]/gi, "_")
  const resultsDir = resultsDirFor(dataFile, tcId)

  const out: ResolvedData = {}
  const missing: string[] = []

  for (const req of requirements) {
    const systemEnvKey = `TESTDATA_${tcSlug}_${system}_${req.key}`
    const globalEnvKey = `TESTDATA_${tcSlug}_${req.key}`
    const envVal = process.env[systemEnvKey] ?? process.env[globalEnvKey]

    let value: string | undefined
    if (envVal) {
      value = envVal
    } else if (req.source === "generated") {
      try {
        value = await resolveGenerated(req, out, resultsDir)
      } catch (e) {
        missing.push(
          `${req.key} (${req.description}) — fixture generation failed: ${(e as Error).message}`
        )
        continue
      }
    } else if (req.source !== "static" && cache[req.key]) {
      // Only sql/seeded/user values come from the prepared cache. A `static` value must come
      // from the spec's staticValue (below), and `generated` is built fresh (handled above,
      // so it never reaches here) — never let a stale cached copy SHADOW the spec (editing the
      // .data.md would then silently have no effect). prepare-data is told not to cache these,
      // but this guards against an older cache written before that rule.
      value = cache[req.key]
    } else if (req.source === "static" && req.staticValue !== undefined) {
      value = req.staticValue
    }

    if (value === undefined) {
      missing.push(describeMissing(req))
      continue
    }

    if ((req.expect === "file" || req.source === "generated") && value) {
      const fileError = await checkFileResolvable(value)
      if (fileError) {
        missing.push(`${req.key} (${req.description}) — ${fileError}`)
        continue
      }
    }

    out[req.key] = value
  }

  if (missing.length) {
    throw new Error(
      `Missing test data for ${tcId} on system ${system}:\n  - ${missing.join("\n  - ")}\n` +
        `Prepare data for ${system} (load the prepare-data skill) or set env vars ` +
        `TESTDATA_${tcSlug}_${system}_<key>.`
    )
  }
  return guardUndeclaredKeys(out, tcId)
}

/**
 * Wrap the resolved data so that reading a key the `.data.md` never declared throws a
 * precise error AT THE POINT OF ACCESS, instead of silently returning `undefined` and
 * failing much later with a confusing "value is not a string" inside setField.
 *
 * Only DECLARED requirements are populated into `out`; an undeclared `data.foo` access
 * is always a spec/`.data.md` mismatch (the exact thing `verify_test_data_usage` checks
 * at build time — this is the run-time backstop). We deliberately let a small set of
 * framework/inspection accessors (await, JSON, logging, test matchers) and all symbols
 * through so wrapping the object never breaks normal handling.
 */
const PASS_THROUGH_PROPS = new Set([
  "then",
  "catch",
  "finally",
  "toJSON",
  "toString",
  "valueOf",
  "constructor",
  "inspect",
  "asymmetricMatch",
  "$$typeof"
])

function guardUndeclaredKeys(out: ResolvedData, tcId: string): ResolvedData {
  return new Proxy(out, {
    get(target, prop, receiver) {
      if (
        typeof prop === "string" &&
        !(prop in target) &&
        !PASS_THROUGH_PROPS.has(prop) &&
        !(prop in Object.prototype)
      ) {
        throw new Error(
          `${tcId} spec read data.${prop}, but "${prop}" is not a resolved test-data key. ` +
            `Declare it in ${tcId}.data.md under "requires:" (define-data skill) and prepare it ` +
            `(prepare-data skill), or remove the data.${prop} reference from the spec. ` +
            `Run verify_test_data_usage to catch this at build time. ` +
            `Resolved keys: ${Object.keys(target).join(", ") || "(none)"}.`
        )
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}

function describeMissing(req: DataRequirement): string {
  if (req.source === "seeded" && req.seed?.viaTcId) {
    return (
      `${req.key} (${req.description}) — requires seeding via ${req.seed.viaTcId} ` +
      `(prepare-data must run that spec once as a setup step, then cache the result)`
    )
  }
  return `${req.key} (${req.description})`
}

/** Build a `source: "generated"` requirement fresh, using already-resolved keys as template context. */
async function resolveGenerated(
  req: DataRequirement,
  contextSoFar: ResolvedData,
  resultsDir: string
): Promise<string> {
  if (!req.args) {
    throw new Error(`source: "generated" but no "args" fixture spec provided`)
  }
  const outDir = path.join(resultsDir, "fixtures")
  return buildFixture(req.args, contextSoFar, outDir)
}

/** Returns an error string if `value` is not a usable, non-empty file path; null if it's fine. */
async function checkFileResolvable(value: string): Promise<string | null> {
  try {
    const stat = await fs.stat(value)
    if (!stat.isFile()) return `resolved to "${value}", which is not a file`
    if (stat.size === 0) return `resolved to "${value}", which is empty (0 bytes)`
    return null
  } catch {
    return `resolved to "${value}", which does not exist on disk`
  }
}

/**
 * Save resolved data to the per-system cache — call from prepare-data flow, NOT from tests.
 * The `system` argument is required to prevent accidentally overwriting another landscape's cache.
 * The `programName` argument tells us which tests/<program>/test-results/ folder to use.
 *
 * Do NOT call this for `source: "generated"` keys — they are intentionally never cached
 * (see module docs). Caching them would reintroduce exactly the staleness problem
 * `generated` exists to eliminate.
 */
export async function saveTestDataCache(
  tcId: string,
  system: string,
  programName: string,
  data: ResolvedData
): Promise<void> {
  const dir = path.resolve(
    testRoot(),
    "tests",
    programName,
    "test-results",
    system.toUpperCase(),
    tcId
  )
  await fs.mkdir(dir, { recursive: true })
  const payload = {
    ...data,
    _meta: {
      system: system.toUpperCase(),
      resolvedAt: new Date().toISOString()
    }
  }
  await fs.writeFile(path.join(dir, "data.json"), JSON.stringify(payload, null, 2), "utf8")
}

/**
 * Derive the program's test-results/<SYSTEM>/<TC-ID> directory from the .data.md
 * file path. System comes from process.env.SAP_SYSTEM (defaults to DEV).
 *   .../tests/<program>/test-cases/TC-001.data.md
 *   → .../tests/<program>/test-results/<SYSTEM>/TC-001
 */
function resultsDirFor(dataFile: string | null, tcId: string): string {
  const system = (process.env.SAP_SYSTEM ?? "DEV").toUpperCase()
  if (!dataFile) {
    return path.resolve(testRoot(), "tests", "_shared", "test-results", system, tcId)
  }
  const casesDir = path.dirname(dataFile) // .../tests/<program>/test-cases
  const programDir = path.dirname(casesDir) // .../tests/<program>
  return path.join(programDir, "test-results", system, tcId)
}

async function loadCache(
  dataFile: string | null,
  tcId: string,
  system: string
): Promise<ResolvedData> {
  const dir = resultsDirFor(dataFile, tcId)
  const candidates = [
    // Current layout: folder is already system-scoped, cache file is plain data.json
    path.join(dir, "data.json"),
    // Backward-compat: legacy per-file suffix inside a non-system-scoped folder
    path.join(dir, `data.${system.toUpperCase()}.json`),
    // Backward-compat: pre-refactor top-level evidence/ location
    path.resolve(testRoot(), "evidence", tcId, `data.${system.toUpperCase()}.json`),
    path.resolve(testRoot(), "evidence", tcId, "data.json")
  ]
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8")
      const parsed = JSON.parse(raw)
      const { _meta, ...values } = parsed
      void _meta
      return values
    } catch {
      // try next
    }
  }

  // Case-insensitive fallback: the framework writes/reads the results folder using the
  // system name uppercased, but a hand-written cache may use a different case (e.g. the
  // lowercase connectionId). On a case-sensitive filesystem (Linux/macOS) that folder is
  // otherwise never found. Scan test-results/ for a directory matching the system name
  // ignoring case and try its data.json.
  const resultsRoot = path.dirname(path.dirname(dir)) // .../tests/<program>/test-results
  const wantSystem = system.toUpperCase()
  try {
    const entries = await fs.readdir(resultsRoot)
    const match = entries.find(e => e.toUpperCase() === wantSystem)
    if (match) {
      const raw = await fs.readFile(path.join(resultsRoot, match, tcId, "data.json"), "utf8")
      const { _meta, ...values } = JSON.parse(raw)
      void _meta
      return values
    }
  } catch {
    // no results root, or no match — fall through
  }
  return {}
}

async function loadRequirementsFromFile(dataFile: string | null): Promise<DataRequirement[]> {
  if (!dataFile) return []
  const content = await fs.readFile(dataFile, "utf8")
  const fm = parseFrontmatter(content)
  if (!fm || !Array.isArray(fm.requires)) return []
  return fm.requires as DataRequirement[]
}

/**
 * Derive the program directory (`tests/<program>`) to scope the data-file search to,
 * from either a Playwright TestInfo-like object (`.file` = the calling spec's absolute
 * path, e.g. `.../tests/<program>/test-scripts/TC-001.spec.ts`) or an explicit program
 * name string. Returns null (meaning "search everywhere," the legacy behavior) if
 * `scope` is omitted or doesn't resolve to a recognizable program folder.
 */
function resolveProgramDir(scope?: { file?: string } | string): string | null {
  if (!scope) return null
  if (typeof scope === "string") {
    return path.resolve(testRoot(), "tests", scope)
  }
  if (scope.file) {
    // .../tests/<program>/test-scripts/TC-XXX.spec.ts -> .../tests/<program>
    const dir = path.dirname(scope.file)
    const parent = path.basename(dir)
    if (parent === "test-scripts") return path.dirname(dir)
  }
  return null
}

async function findDataFile(tcId: string, programDir: string | null): Promise<string | null> {
  // Scoped: only this program's test-cases/ (and any nested subfolder, for legacy
  // layouts that group cases into subdirectories).
  if (programDir) {
    const scopedRoot = path.join(programDir, "test-cases")
    const hit = await walkForFile(scopedRoot, `${tcId}.data.md`)
    if (hit) return hit
    // Fall through to the unscoped search below ONLY if nothing was found under the
    // resolved program — e.g. a legacy .data.md that hasn't been migrated yet.
  }
  // Unscoped (legacy) fallback: tests/<program>/test-cases/<TC-ID>.data.md
  // Legacy layout: test-cases/<...>/<TC-ID>.data.md
  const roots = [path.resolve(testRoot(), "tests"), path.resolve(testRoot(), "test-cases")]
  const target = `${tcId}.data.md`
  for (const root of roots) {
    const hit = await walkForFile(root, target)
    if (hit) return hit
  }
  return null
}

/** Recursively search `dir` for a file literally named `target`. */
async function walkForFile(dir: string, target: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return null
  }
  for (const e of entries) {
    const p = path.join(dir, e)
    let stat
    try {
      stat = await fs.stat(p)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      // Skip Playwright's own output folders — no test data lives there
      if (e === "test-results" || e === ".playwright-artifacts") continue
      const hit = await walkForFile(p, target)
      if (hit) return hit
    } else if (e === target) {
      return p
    }
  }
  return null
}
