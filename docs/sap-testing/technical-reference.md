# SAP Testing Technical Reference

Internals for people who want them. None of this is needed for day-to-day use — see [Getting Started](getting-started.md) and [The Testing Workflow](workflow.md) for that.

## Commands and settings

| Command | Purpose |
|---|---|
| **ABAP FS: Enable SAP UI Testing Features** | Pick the test folder. This is what switches the feature on |
| **ABAP FS: Open SAP UI Test Folder** | Reveal the test folder in your file manager |
| **ABAP FS: Set Models for Subagents** | Choose models for general and testing agents |
| **ABAP FS: Record SAP WebGUI Flow** | Record a reference flow in Edge |
| **ABAP FS: Select System for Playwright Sidebar** | Only for the optional Playwright extension — the sidebar can't ask which system to use |

| Setting | Scope | Purpose |
|---|---|---|
| `abapfs.testing.folder` | User | The test folder. Setting it enables the feature |
| `abapfs.testing.edgePath` | User | Browser executable override; empty means auto-detect Edge |
| `abapfs.subagents.models` | User | Model chosen per general and testing agent — written by the unified panel/tool |
| `abapfs.subagents.enabledAgents` | User | Per-general-agent visibility; testing agents are controlled by testing-folder readiness |
| `webGuiAutoLogin` | Per connection | Defaults to true. Turn off for systems behind a gateway that already authenticates you |

Everything testing-specific is gated behind the `abapfs:testingEnabled` context key, which is set only when `abapfs.testing.folder` resolves to a directory that exists. General agents use one context key per agent and are controlled by `abapfs.subagents.enabledAgents`. Skills, agents, and tools are contributed conditionally according to these states.

## Test folder layout

```
<TEST_FOLDER>/
├── tsconfig.json                    managed by ABAP FS
├── package.json                     managed by ABAP FS ("type": "module")
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

**Always:** a `tsconfig.json` that maps the module specifier `@sap-testing/runtime` to the extension's compiled runtime, a `package.json` marking the folder as an ES module, a link to that runtime under `node_modules`, and `.gitignore` entries for all of them. This is what gives the TypeScript language service real IntelliSense and type errors while Copilot writes a spec — checked against the actual runtime signatures rather than prose in a skill — and what lets the test runner resolve the runtime at execution time. The language-service half only applies while the test folder is open in your workspace; the runner half works either way.

The runtime ships as ESM only, so specs have to be ES modules too. Under `node16` module resolution a `.ts` file's format comes from the nearest `package.json`, which is why the scaffold writes one with `"type": "module"`. An explicit `"type": "commonjs"` you set yourself is left alone.

**Only while Microsoft's Playwright extension is installed:** a `playwright.config.mjs`, links to the bundled Playwright, a `.bin` launcher, and `.sap-active-system`. These exist purely so the Test Explorer sidebar can discover and run specs. They're removed again if you uninstall that extension. The `abapfs_run_playwright_tests` tool needs none of them — it passes its own config and sets the target system directly in the runner's environment.

The config is `.mjs` rather than `.js` so it stays an ES module no matter what the folder's `package.json` says. Playwright resolves `.js` ahead of `.mjs`, so a `playwright.config.js` left behind by an older ABAP FS version is deleted before the new one is written.

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

Keys that must differ from each other declare `distinctFrom` on both sides; `abapfs_check_test_data` fails the program if they resolve to the same value. Ordering with `take: first` is not a uniqueness guarantee, because a `SELECT` without `ORDER BY` has no defined row order.

## Quality gates

Three reviewer agents and two tool-level gates define the default comprehensive workflow. Explicit user-directed scope may override methodology requirements, but never safety, authorization, security, or truthful reporting.

**Reviewer agents** run at the end of phases 1, 2, and 3. Each reads the underlying evidence itself rather than trusting the main agent's summary, returns either a pass or an itemised gap list, and the phase does not hand off until every gap is fixed and it passes.

**Gated tools** require the calling agent to certify that a prerequisite genuinely happened, using an exact confirmation string:

| Tool | Requires |
|---|---|
| `abapfs_build_test_index` | Certification that the test plan reviewer already returned a pass |
| `abapfs_run_playwright_tests` | Certification that all upstream phase gates and data readiness were verified |

By default, both reject a missing or incorrect confirmation. A user-directed workflow exception is supported through `skipWorkflowValidation: true` and a nonblank `overrideReason`, instead of a false certification. This skips reviewer certification, source-snapshot validation, and SQL/mixed table-declaration requirements for the index tool, and prerequisite certification plus SE16N workflow proof for the runner. The data-usage tool also supports these flags to skip SE16N proof only; real data-key/resolver dependencies remain enforced. Indexes built with waived checks are labelled, without a new analysis certification. Execution/configuration and structural checks still apply. These are behavioural contracts, not cryptographic authorization: a reason records the user's requested scope, not proof of approval.

Each testing skill documents scope exceptions relevant to its subject. Each testing agent accepts optional `userIntent` from its caller: the user's goal, requested scope, and waived workflow requirements. Without an override, the full workflow remains the default. Scoped reviewer verdicts are not full-suite approvals.

For a smoke check or targeted logic test, user-supplied or verified values may live directly in the spec. Such a spec need not call `resolveTestData()` or have `.data.md`/`data.json` files. The sidecar/cache model remains the default for reusable, cross-system suites; if a spec calls the resolver, its actual data dependencies still apply.

`abapfs_check_test_data` accepts optional `tcIds` to isolate selected cases. Missing sidecars are reported as unmanaged/skipped, never as validated inline data; a missing sidecar directory yields zero managed cases rather than demanding suite artifacts.

`abapfs_build_test_index` also enforces structural rules: valid categories, matching case IDs, parseable frontmatter, and agreement between `dataRequired` and the presence of a `.data.md`. A missing `.data.md` for a case that needs one is a warning during phase 3 (specs come later) and must be zero by the end of phase 4.

## The runtime

Specs import from the fixed specifier `@sap-testing/runtime`, never a relative path. It exposes `SapSession` (the UI driver), `SapArtifacts` (application-server file and spool checks), `resolveTestData`, `buildFixture`, and some formatting helpers.

`SapSession` methods describe SAP mechanics rather than business concepts — `setField`, `setRange`, `check`, `selectRadio`, `clickButton`, `clickTab`, `setGridCell`, `pickFromValueHelp`, `execute`, `captureDownload`, plus assertions like `expectAlert`, `expectTitle`, `expectGridHasRow`. You can't add methods to it, which is what stops business logic leaking into the runtime.

UI helpers handle SAP processing waits, supported notification dialogs, runtime/session checks, and evidence screenshots. Unexpected SAP error statuses fail the action immediately. Expected business-validation errors are supported through a one-action `expectBusinessError` assertion; a missing or different error still fails, as do dumps and lost sessions. Normal success/information messages use `expectAlert`.

The popup guard dismisses only supported notices such as license, system-message, copyright, and data-privacy dialogs. Save confirmations remain for the test to handle deliberately. A Multiple Logon dialog fails safely: ABAP FS does not end your other sessions.

SAP controls may appear in the page or in an ITS frame. The runtime selects the active SAP document; custom interactions use `sap.contentRoot()` rather than assuming a particular iframe.

For visual table verification, `sap.se16n()` opens the table, applies explicit fields and criteria, verifies the selection, and captures criteria/result screenshots. It supports include/exclude values, ranges, patterns, and multiple selection. It rejects an inherited layout unless one is explicitly requested, because layouts can override output columns. Returned rows cover only the visible grid; the hit count describes the fetched result and can be capped by Max. Number of Hits. SE16N screenshots support the evidence report but do not replace authoritative SQL post-validation.

## Authentication

No spec ever contains credentials or a login step.

Each runner process establishes its own SAP session using a reentrance ticket from your ABAP FS connection, posted through a single-use local form. Its specs start from that runner's authenticated storage state; parallel runners do not share one SAP login. The same mechanism produces the pre-authenticated URLs used for browser exploration and recording — those URLs are single-use, which is why they must be opened exactly as issued.

Setting `webGuiAutoLogin: false` on a connection skips all of it, for landscapes where a gateway handles authentication.

## Execution

`abapfs_run_playwright_tests` runs the real `@playwright/test` CLI as a subprocess, using VS Code's own Node runtime and a copy of Playwright vendored into the extension. Nothing is installed into your test folder and no browser is downloaded — it drives your installed Edge.

Defaults: sequential execution, no retries, 120 seconds per test, and a one-hour global timeout per runner process. Tests run headless unless a visible browser is requested. Each call returns a diagnostic folder under `.playwright-runs/`, containing per-worker JSON reports, runner logs, and traces for failures. `keepArtifacts` also records traces for passing tests; ordinary evidence screenshots are independent and remain enabled unless you decline them.

Independent spec files can run in parallel across separate runner processes and SAP sessions. The concurrency setting defaults to 3 when parallel mode is enabled and is capped at 5; it is a ceiling, not a recommendation for your machine or SAP system. Failure stopping applies per runner process (3 failed tests by default, capped at 10), not across the whole call. Dependent cases must run in ordered sequential batches.

Start sequentially and increase concurrency cautiously. Multiple browsers can strain your computer, and multiple SAP sessions can slow server responses. If timeouts appear only under parallel load, reduce concurrency and rerun the affected cases before treating them as application defects. Other active calls and browser sessions also contribute to load. Do not run the same case on the same system concurrently because its evidence and data-cache paths are shared.

Diagnostic cleanup is best effort, targeting 15 call folders and 500 MB total. Active calls in the current extension process and the just-completed call are protected, so these are not hard bounds. Copy diagnostics you need to preserve before later cleanup. Case evidence in `test-results/` is separate from this diagnostic retention.

## Evidence output

Each case run writes `manifest.json` (every step, timestamp, and note) plus numbered screenshots into its results folder. Previous runs are archived into `runs/<timestamp>/` rather than deleted, and the data cache survives.

Post-run checks land in `verification.json`, recording each check, who performed it, the SQL or tool used, actual versus expected, and its status. Checks a machine can't perform stay `pending-manual` until you confirm them.

`abapfs_build_evidence_report` aggregates all of it into one Word document per program and connection: a title page with the pass/fail summary, a colour-coded results table, and one section per case with every step and screenshot. Where a `verification.json` exists, its checks appear too — so a case that passed on screen but failed its database check shows as failed, and a case with unconfirmed manual checks is visibly not fully proven. Rebuilding is cheap and safe to repeat.
