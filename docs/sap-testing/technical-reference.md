# SAP Testing Technical Reference

Internals for people who want them. None of this is needed for day-to-day use — see [Getting Started](getting-started.md) and [The Testing Workflow](workflow.md) for that.

## Commands and settings

| Command | Purpose |
|---|---|
| **ABAP FS: Enable SAP UI Testing Features** | Pick the test folder. This is what switches the feature on |
| **ABAP FS: Open SAP UI Test Folder** | Reveal the test folder in your file manager |
| **ABAP FS: Set Models for SAP Testing Subagents** | Choose the model backing each subagent |
| **ABAP FS: Record SAP WebGUI Flow** | Record a reference flow in Edge |
| **ABAP FS: Select System for Playwright Sidebar** | Only for the optional Playwright extension — the sidebar can't ask which system to use |

| Setting | Scope | Purpose |
|---|---|---|
| `abapfs.testing.folder` | User | The test folder. Setting it enables the feature |
| `abapfs.testing.edgePath` | User | Browser executable override; empty means auto-detect Edge |
| `abapfs.testing.subagentModels` | User | Model chosen per subagent — written by the panel, not by hand |
| `webGuiAutoLogin` | Per connection | Defaults to true. Turn off for systems behind a gateway that already authenticates you |

Everything is gated behind the `abapfs:testingEnabled` context key, which is set only when `abapfs.testing.folder` resolves to a directory that exists. Skills, subagents, and tools are all contributed conditionally on it.

## Test folder layout

```
<TEST_FOLDER>/
├── tsconfig.json                    managed by ABAP FS
├── node_modules/@sap-testing/runtime  managed by ABAP FS
├── recordings/                      reference recordings, never runnable specs
├── .playwright-artifacts/           Playwright traces (kept on failure)
└── tests/
    └── <PROGRAM>/                   one folder per object under test
        ├── sources/<timestamp>/     downloaded ABAP source snapshot
        ├── sources/anst/            ANST exports, if any
        ├── test-cases/
        │     _flow.md  _units.md  _findings.md  _screens.md
        │     TC-001.md  TC-001.data.md  …
        │     _index.md  _index.docx
        ├── test-scripts/
        │     TC-001.spec.ts  …
        └── test-results/
              <CONNECTION-ID>/TC-001/   data.json, step-NN.png,
              │                          manifest.json, verification.json,
              │                          fixtures/, runs/<timestamp>/
              └── <PROGRAM>-<CONNECTION-ID>-report.docx
```

Two conventions that matter:

- **Everything for one program is siblings.** A case, its data spec, its script, and its results all live under `tests/<PROGRAM>/`.
- **The results folder is the connection ID in uppercase.** The framework uppercases it at run time, so a hand-written lowercase folder is silently not found on Linux and macOS, and only appears to work on Windows.

## Managed scaffolding

ABAP FS writes a small amount of infrastructure into the test folder and re-applies it on every activation, because the extension's install path changes with each version.

**Always:** a `tsconfig.json` that maps the module specifier `@sap-testing/runtime` to the extension's compiled runtime, a link to that runtime under `node_modules`, and a `.gitignore` entry for both. This is what gives the TypeScript language service real IntelliSense and type errors while Copilot writes a spec — checked against the actual runtime signatures rather than prose in a skill — and what lets the test runner resolve the runtime at execution time. The language-service half only applies while the test folder is open in your workspace; the runner half works either way.

**Only while Microsoft's Playwright extension is installed:** a `playwright.config.js`, links to the bundled Playwright, a `.bin` launcher, and `.sap-active-system`. These exist purely so the Test Explorer sidebar can discover and run specs. They're removed again if you uninstall that extension. The `playwright_test` tool needs none of them — it passes its own config and sets the target system directly in the runner's environment.

All of it is gitignored, because it hardcodes machine-specific absolute paths.

## Artifact fields

Each `TC-NNN.md` carries frontmatter that the index builder validates. The values that are checked against a fixed list:

**`category`** — `happy-path`, `boundary`, `invalid`, `mandatory`, `authorization`, `empty`, `large`, `idempotency`, `cross-tx`, `concurrency`, `background-artifact`, `discovered-control`. Phase 3 walks all twelve and any the program genuinely can't exhibit must be justified in writing, so nothing is silently dropped.

**`runnable`** — `runnable`, `manual`, `blocked-by-data`, `runnable-elsewhere`. The last one covers cases that need a different SAP user; a test run authenticates one session as the connection's own user and there's no way to switch mid-run, so negative-authorization cases must run against a separate connection.

**`verification`** — `sql`, `manual`, `mixed`, `none`. How the case is proven after the UI passes. `none` is only valid when the path can't have written anything.

**`dataRequired`** — `yes` or `no`, and it must agree with whether a `.data.md` exists. Both mismatches are errors.

`_index.md` is a mechanical projection of all that frontmatter and should never be hand-edited — the only section preserved across rebuilds is `## Notes` at the bottom.

One recurring trap: YAML frontmatter must be the literal first bytes of the file, not inside a code fence or under a heading. Misplaced frontmatter in a `.data.md` parses to zero requirements, so every data value silently resolves to undefined.

## The test data model

A `.data.md` declares requirements by shape, not value. Each has a `source`:

| Source | Resolved by |
|---|---|
| `sql` | Querying the target system during phase 5, with your approval |
| `static` | A fixed value written in the spec |
| `user` | Asking you |
| `generated` | Building an xlsx or CSV fixture from a declarative column/row spec |
| `seeded` | Running another test case's script once as an approved setup step, then reading the result back |

At run time each key resolves in this order:

1. Environment pin `TESTDATA_<TCID>_<SYSTEM>_<key>`, then `TESTDATA_<TCID>_<key>`
2. `generated` — rebuilt fresh on every run, never cached, so date fields can't go stale
3. The `data.json` cache for this connection
4. `static` values from the spec

Only `sql` and `seeded` values belong in `data.json`. Caching a `static` value shadows the spec so later edits to it do nothing; caching a `generated` one reintroduces the stale-fixture problem.

Fixtures support `{{other_key}}` substitution and relative date tokens (`today`, `+30d`, `-5d`) resolved against the current run time, so a fixture never carries an absolute date.

Keys that must differ from each other declare `distinctFrom` on both sides; `check_test_data` fails the program if they resolve to the same value. Ordering with `take: first` is not a uniqueness guarantee, because a `SELECT` without `ORDER BY` has no defined row order.

## Quality gates

Three reviewer agents and two tool-level gates keep the workflow honest.

**Reviewer agents** run at the end of phases 1, 2, and 3. Each reads the underlying evidence itself rather than trusting the main agent's summary, returns either a pass or an itemised gap list, and the phase does not hand off until every gap is fixed and it passes.

**Gated tools** require the calling agent to certify that a prerequisite genuinely happened, using an exact confirmation string:

| Tool | Requires |
|---|---|
| `build_test_index` | Certification that the test plan reviewer already returned a pass |
| `playwright_test` | Certification that all upstream phase gates and data readiness were verified |

Both reject the call if the confirmation is missing or wrong, which means an agent that skipped a phase cannot produce the case index or run a test. The gate is a behavioural contract rather than a cryptographic one — its purpose is to stop a model from quietly cutting a corner under pressure, not to defend against a determined attacker.

`build_test_index` also enforces structural rules: valid categories, matching case IDs, parseable frontmatter, and agreement between `dataRequired` and the presence of a `.data.md`. A missing `.data.md` for a case that needs one is a warning during phase 3 (specs come later) and must be zero by the end of phase 4.

## The runtime

Specs import from the fixed specifier `@sap-testing/runtime`, never a relative path. It exposes `SapSession` (the UI driver), `SapArtifacts` (application-server file and spool checks), `resolveTestData`, `buildFixture`, and some formatting helpers.

`SapSession` methods describe SAP mechanics rather than business concepts — `setField`, `setRange`, `check`, `selectRadio`, `clickButton`, `clickTab`, `setGridCell`, `pickFromValueHelp`, `execute`, `captureDownload`, plus assertions like `expectAlert`, `expectTitle`, `expectGridHasRow`. You can't add methods to it, which is what stops business logic leaking into the runtime.

Every action goes through the same guarded cycle:

```
dismiss known popups → perform the action → wait for the server round-trip
→ wait for the DOM to settle → dismiss popups again
→ check for a dump, ITS error, or logon screen → capture an evidence screenshot
```

That's why specs contain no manual waits and no explicit screenshots, and why a short dump surfaces as a clear failure instead of a confusing timeout on the next step.

The popup guard dismisses a curated allow-list only — license notices, system messages, multiple-logon, copyright, data privacy. Anything else, including "do you want to save?", is left alone for the test to handle deliberately.

For anything the runtime doesn't cover, `sap.raw()` returns the real Playwright page. All SAP content lives inside the ITS iframe, so raw locators must be scoped through it or they query an empty document and can pass vacuously.

## Authentication

No spec ever contains credentials or a login step.

Before running, the tool mints a SAP reentrance ticket from your ABAP FS connection and posts it through a single-use local form (tickets can't travel in a URL query string). The resulting session cookies are saved and handed to every spec, so tests start already signed in. The same mechanism produces the pre-authenticated URLs used for browser exploration and recording — those URLs are single-use, which is why they must be opened exactly as issued.

Setting `webGuiAutoLogin: false` on a connection skips all of it, for landscapes where a gateway handles authentication.

## Execution

`playwright_test` runs the real `@playwright/test` CLI as a subprocess, using VS Code's own Node runtime and a copy of Playwright vendored into the extension. Nothing is installed into your test folder and no browser is downloaded — it drives your installed Edge.

Defaults: one worker, no retries, 60 seconds per test, 10 minutes overall, traces retained on failure under `.playwright-artifacts/`. Tests run headless unless asked for a headed run, which is worth doing the first time a new spec runs.

Serial execution with no retries is deliberate. Parallel SAP sessions interfere with each other, and automatic retries hide flakiness that usually turns out to be a real timing or data problem.

## Evidence output

Each case run writes `manifest.json` (every step, timestamp, and note) plus numbered screenshots into its results folder. Previous runs are archived into `runs/<timestamp>/` rather than deleted, and the data cache survives.

Post-run checks land in `verification.json`, recording each check, who performed it, the SQL or tool used, actual versus expected, and its status. Checks a machine can't perform stay `pending-manual` until you confirm them.

`build_evidence_report` aggregates all of it into one Word document per program and connection: a title page with the pass/fail summary, a colour-coded results table, and one section per case with every step and screenshot. Where a `verification.json` exists, its checks appear too — so a case that passed on screen but failed its database check shows as failed, and a case with unconfirmed manual checks is visibly not fully proven. Rebuilding is cheap and safe to repeat.
