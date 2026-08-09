---
name: run-scripts
description: Standalone Phase 7 of SAP UI testing. Rediscovers the configured test folder, program/specs, test cases, prepared data, and target system from disk; then runs Playwright via SAP Testing tools, generates .docx evidence, and diagnoses test script failures. Use when the user asks to execute tests, run TC-XXX, generate evidence, or debug a failed test.
---

# Run Scripts — Phase 7 (of 7)

Phase order: analyze-and-plan (1) → explore-ui (2) → design-cases (3) → define-data (4) → prepare-data (5) → build-scripts (6) → **run-scripts (7)**.

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide tools until searched for, and this is exactly where it bites: `playwright_test` is frequently NOT in the default active toolset, and smaller models fail to find it and waste turns trying `run_in_terminal`/`runTests` instead. Before Step 0, make sure `playwright_test`, `get_test_folder`, `get_connected_systems`, `check_test_data`, and `build_evidence_report` are available; if any is missing, search your available tools for it by name. **Never use VS Code's generic `runTests` tool for SAP specs** — it expects Vitest/Jest and returns "No tests found" for Playwright specs. If `playwright_test` cannot be found after searching, tell the user rather than improvising.

## The `playwright_test` prerequisite gate

`playwright_test` is a GATED tool: it refuses to run unless you pass the mandatory `prerequisiteConfirmation` field. Only pass it after you have completed Step 0 (artifacts present AND `check_test_data` clean for the selected cases). The exact text to pass is: `I verified all upstream phase gates and test data readiness for this program`. It is valid only once that gate is genuinely complete; the run is rejected otherwise.

## Non-negotiable execution gate

The `playwright_test` tool gates the run on all required upstream steps and artifacts from `analyze-and-plan`, `explore-ui`, `design-cases`, `define-data`, `prepare-data`, and `build-scripts`. It **will reject the run** if you have not completed the Step 0 readiness gate (it enforces this through the mandatory `prerequisiteConfirmation` field). Before calling it, complete every prerequisite; calling it early cannot bypass validation.

## Why

A test run is only useful if its results are trusted. Rerunning until green, silently retrying flaky tests, or dismissing failures as "environmental" is how bugs reach prod with a passing test suite behind them. Diagnose every failure. A red result is a signal — either the code is wrong, the test is wrong, or the environment is wrong. All three matter. The docx evidence is what auditors, business owners, and post-mortems will look at; if it's incomplete or misleading, the whole exercise was for nothing.

Goal: execute tests, produce one aggregated evidence `.docx` per program and connection, and turn failures into actionable diagnoses.

## Tools this phase uses

| Task                                      | Tool                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Run one spec                              | `playwright_test` with `program`, `tcId`                                       |
| Run every spec in a program               | `playwright_test` with `program` only (omit `tcId`)                            |
| Watch it run visibly                      | `playwright_test` with `headed: true` — do this the first time a new spec runs |
| Pre-flight data readiness                 | `check_test_data` with `program`, `connectionId`                               |
| Build the .docx report                    | `build_evidence_report` with `program`, `connectionId`                         |
| Override one data value for this run only | not a tool — re-run `prepare-data` to fix the underlying cache instead         |

There is no terminal command for SAP Testing execution or evidence generation — no `npx playwright test`, no `npm run`. Use the tools below. Optional external trace viewing is the only terminal exception described later.

## Process

### Step 0 — Standalone bootstrap and execution gate (mandatory)

> **Say before acting:** "Starting Step 0: standalone bootstrap and execution gate."

Run these actions in this exact order in every chat:

1. Call `get_test_folder` **before reading any test artifact or invoking another SAP Testing tool**. Treat the returned absolute path as `<TEST_FOLDER>`; never infer it from the workspace or a prior chat.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If the folder is not open in the workspace, STOP and ask the user to add it via File > Add Folder to Workspace.
3. Resolve `<PROGRAM>` and requested TC-IDs from the request. If omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_index.md` and `test-scripts/*.spec.ts`. Auto-select only when exactly one valid candidate exists; otherwise ask. Treat `_index.md`'s `Data required?` field as authoritative.
4. Enforce the artifact gate for every selected TC-ID:
   - `test-cases/TC-XXX.md` exists
   - `test-scripts/TC-XXX.spec.ts` exists
   - `test-cases/_screens.md` and `_index.md` exist
   - matching `.data.md` exists exactly when `_index.md` says `Data required? = yes`
   If `_findings.md` is missing, STOP and follow `analyze-and-plan`; if `_screens.md` is missing, follow `explore-ui`; if a `TC-XXX.md`/`_index.md` is missing or wrong, follow `design-cases`; if a `.data.md` is missing, follow `define-data`; if specs are missing, follow `build-scripts`. Never reconstruct any of them from conversation memory.
5. Call `get_connected_systems` and identify the exact target `connectionId`; ask only if ambiguous.
6. **Do not run a `runnable-elsewhere` case against the wrong user.** A negative-authorization case is `runnable-elsewhere` because it must run as a user who LACKS the authorization (see `design-cases`/`build-scripts`). Running it against the primary connection — whose user IS authorized — makes it "pass" for the wrong reason (the action was allowed, not blocked). Only run such a case when the target `connectionId` is the SEPARATE connection configured for the required unauthorized user; otherwise skip it and report it as "needs the unauthorized-user connection", not as passed or failed.
7. Call `check_test_data` for the program + exact connectionId. If it reports any FAIL for a selected case, STOP that case and follow `prepare-data` to resolve it. Do not start Playwright hoping runtime resolution will work.

Do not continue until `<TEST_FOLDER>`, `<PROGRAM>`, selected TC-IDs, required artifacts, target `connectionId`, and data readiness are all confirmed.

> **Say before continuing:** "Step 0 completed. Evidence: test folder, program, selected cases, upstream artifacts, connection, and data readiness confirmed. Next: Step 1 — verify authentication."

### Step 1 — Verify authentication

> **Say before acting:** "Starting Step 1: verify the externally authenticated SAP browser session."

The browser session is signed in automatically: before running any spec, `playwright_test` mints a SAP reentrance ticket from the ABAP FS connection, uses it to establish a session, and hands the resulting cookies to every spec. Nothing to do here, and never add credentials or login steps to a spec.

Two cases where that does not happen, both expected:

- The connection sets `webGuiAutoLogin: false` — deliberate, for systems reached through a gateway or proxy that authenticates on the user's behalf.
- The system issues no reentrance ticket. The run continues unauthenticated and will fail on a logon screen; see the diagnosis table in Step 5.

The extension's `ABAP FS` output channel (Debug level) shows `[sso]` lines for the sign-in, including which cookies were saved — the fastest way to tell an auth failure from a test failure.

> **Say before continuing:** "Step 1 completed. Evidence: SAP authentication is available for the target connection. Next: Step 2 — run the selected specs."

### Step 2 — Run the selected specs

> **Say before acting:** "Starting Step 2: execute the selected specs on `<connectionId>`."

Call `playwright_test` with `program`, `connectionId`, the mandatory `prerequisiteConfirmation` (exact text: `I verified all upstream phase gates and test data readiness for this program`), and optionally `tcId` — use `headed: true` on the first execution of a new spec.

> **Say after the tool returns:** "Step 2 completed. Evidence: `playwright_test` results and result-artifact paths recorded for every selected case. Next: Step 3 — perform required post-test verification."

### Step 3 — Perform post-test verification

> **Say before acting:** "Starting Step 3: execute every declared post-test verification for UI-passed cases (run the SQL checks, record the manual ones as pending)."

## Post-test verification

A UI pass only proves the screen was happy — not that the object actually persisted/emitted what it was supposed to. So for each UI-passed TC with a `## Post-test verification` section, complete its checks here. This never runs before the UI-level pass or inside `playwright_test`. Only cases with `verification: none` (pure error/abort cases that persist nothing) skip this.

Each row in the table is tagged `by: sql` or `by: manual`. Handle them differently:

**Relative (delta) checks need a fresh pre-run baseline — capture it yourself, never from `data.json`.** A check like "the target table has N MORE rows after the run" needs the row count taken IMMEDIATELY BEFORE this case runs. That baseline is a per-run MEASUREMENT, not cached test data — a value stored in `data.json` (or a `requires` key) freezes at first-prepare time and every rerun then compares against a stale number. So for any relative verification row: run its baseline query just before you call `playwright_test` for that case, keep the value for the duration of the run, and after the run compute actual-minus-baseline and compare to the expected delta. Record both the baseline and the delta in `verification.json`. Prefer an ABSOLUTE assertion (a `WHERE` that identifies exactly the row(s) this run should have written) when you can — it needs no baseline and can't go stale.

1. After `playwright_test` reports the TC PASSED, read that TC's `## Post-test verification` table and the `verification` frontmatter value.
2. Read the already-resolved values from `tests/<PROGRAM>/test-results/<connectionId>/<TC-ID>/data.json` — substitute the SAME `<data-key: x>` values the spec used. Never re-resolve or guess.
3. **`by: sql` checks — you run them.** Execute each via the ABAP data-query tool against the SAME system the spec ran on, and compare the actual result to `Expected` — judge it like any assertion, not "close enough."
4. **`by: manual` checks — you do NOT run them; you record them as pending for the user.** These are effects the model cannot verify (AL11 file bytes, an SXMB_MONI/SXI_MONITOR payload, an email arrival, an external-system record). Record each with `status: "pending-manual"`, its `tool`, and `instructions`, and explicitly tell the user in your final report exactly what to check and where. Do not mark it passed on the user's behalf.
5. Write `tests/<PROGRAM>/test-results/<connectionId>/<TC-ID>/verification.json`:
   ```json
   {
     "checks": [
       { "label": "Row persisted", "by": "sql", "sql": "SELECT ...", "actual": "1 row, status=53", "expected": "one row inserted", "status": "pass" },
       { "label": "AL11 file", "by": "manual", "tool": "AL11", "instructions": "open /tmp/out.csv and confirm 10 rows", "status": "pending-manual" }
     ],
     "overallStatus": "pending-manual"
   }
   ```
   `overallStatus` = `fail` if any check failed, else `pending-manual` if any manual check is still pending, else `pass`. `build_evidence_report` reads this file and renders each check with its owner and status — a failed SQL check turns the case red; a pending manual check shows the case as "manual verification pending" so nobody mistakes it for fully proven.
6. **If any `by: sql` check fails, the TC's overall result is a FAIL**, even though the UI run passed — a transaction that shows success but persisted the wrong data is exactly what this catches. Do not let a green UI talk you out of a failing check.
7. **A case with pending manual checks is NOT fully verified.** Report it as "UI + automated checks passed; manual verification pending" and list every manual check the user must perform, per TC, in your final handoff. Track these until the user confirms them (re-run `build_evidence_report` after they do, updating the check `status` to `pass`/`fail`).

Skip this step only for `verification: none` cases (see `design-cases`).

> **Say before continuing:** "Step 3 completed. Evidence: every `by: sql` check ran, every `by: manual` check is recorded pending with its tool, and `verification.json` overall statuses reflect both. Next: Step 4 — build the evidence report."

### Step 4 — Build the evidence report

> **Say before acting:** "Starting Step 4: build the aggregated evidence report."

Call `build_evidence_report`. The report is written to `<TEST_FOLDER>/tests/<PROGRAM>/test-results/<PROGRAM>-<CONNECTION-ID>-report.docx`.

> **Say before continuing:** "Step 4 completed. Evidence: aggregated report written at `<absolute-report-path>`. Next: Step 5 — diagnose failures and hand off results."

### Step 5 — Diagnose failures and hand off results

> **Say before acting:** "Starting Step 5: diagnose every failure and produce the final run handoff."

For every UI-level or post-test verification failure, follow the diagnosis playbook below. Do not rerun blindly.

## Failure diagnosis playbook

Order matters:

1. **Read the `playwright_test` tool's output** — it summarizes pass/fail per test, the first lines of any error with its file:line, the failing step, and (on failure) the absolute trace-zip and last-screenshot paths.
2. **Read `tests/<PROGRAM>/test-results/<CONNECTION-ID>/<TC-ID>/manifest.json`** (connectionId UPPERCASE — that's how the framework names the folder; a lowercase guess won't be found on Linux/macOS). The last recorded step shows where progress stopped and names the failing action.
3. **Look at the last screenshot** in `tests/<PROGRAM>/test-results/<CONNECTION-ID>/<TC-ID>/step-*.png`.
3a. **Open the trace** (path from step 1, under `<TEST_FOLDER>/.playwright-artifacts/`) BEFORE theorising — for an assertion that "sees nothing", a locator timeout, or a suspected wrong-value POST, the trace's request bodies and per-step DOM snapshots usually show the cause directly.
4. **Categorize**:

**FAIL vs BLOCKED — do NOT parrot the tool's `FAIL` label.** The `playwright_test` summary reports every non-passing test as `FAIL`, but that lumps together two categorically different outcomes and must NOT be reported to the user that way. Before assigning any case to `FAIL`, check the error text:

- Error starts with `Missing test data for TC-XXX` (or contains `does not exist on disk` / `is empty` / `fixture generation failed` / `requires seeding via TC-YYY`) → **BLOCKED (data not ready)**. This means `resolveTestData` couldn't produce a value; the spec never touched SAP. It is NOT a code defect. Route to `prepare-data` (or `define-data` for the fixture cases) per the table below. In the handoff, list the case under BLOCKED, not FAILED.
- Anything else → real FAIL: assertion failure, locator failure, popup, dump, ITS error, or SAP behaviour bug. Diagnose per the table.

Reporting rule for the final handoff: PASS / BLOCKED / FAIL are three separate buckets — a "0 failed" summary with 6 BLOCKED cases is very different from 6 real failures, and users need to see that distinction to know what to fix next.

| Category                          | Sign                                                                       | Fix location                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing test data (sql/static)    | "Missing test data for TC-XXX" with a plain key name                       | Load `prepare-data` skill                                                                                                                                                                                                                             |
| Missing test data (seeded)        | "Missing test data..." mentions "requires seeding via TC-YYY"              | Load `prepare-data` skill — Step 2b (run TC-YYY's spec first, with approval, then resolve)                                                                                                                                                            |
| Fixture generation failed         | "Missing test data..." mentions "fixture generation failed"                | The `generated` requirement's `args` in `.data.md` is broken (often the wrong format/columns). STOP Phase 7 and follow `define-data` to correct the data specification; this is not a SAP data-resolution failure.                                        |
| Missing/empty fixture file        | "Missing test data..." mentions "does not exist on disk" or "is empty"     | An `expect: "file"` requirement's `static` path was never generated, or a checked-in fixture is missing — provide the file or switch it to `source: generated`                                                                                        |
| Auto-login failed                 | `SAP runtime error detected (logon)`, or a login page in the screenshot     | Auto-login did not produce a usable session. Check the `[sso]` lines in the `ABAP FS` output channel: `AUTO-LOGIN FAILED` names the cause; `no login URL` means the connection has `webGuiAutoLogin: false`. Report it — never add login logic to a spec                                                |
| Assertion sees NOTHING            | `expectAlert`/`expectTitle`/`expectGridHasRow` fails with `Last seen: []` (an EMPTY list) while the thing is clearly on screen | Not a timing gap — an empty "last seen" means the assertion queried the wrong scope (empty outer document / wrong iframe), not that it waited too long. This is a bundled-runtime frame-scoping matter; report it with the exact `Last seen` text and a screenshot. Do NOT add `page.waitForTimeout()` — waiting longer over the wrong scope stays empty forever. |
| Timing                            | An assertion just after a click, or a general timeout (last seen shows real, non-empty text) | This is a bundled-runtime limitation, not something available to patch in the workspace — report it; do not add `page.waitForTimeout()` to the spec as a workaround                                                                                   |
| Unexpected popup                  | Popup in screenshot, action clicked wrong thing                            | Report the popup title — the bundled known-safe-popup list is not workspace-editable; if it is a real part of the flow, handle it explicitly in the spec via `sap.continueDialog()`/`sap.cancelDialog()`                                               |
| Element not found by label        | "could not locate a textbox/checkbox/radio/button/tab/column for X" | Load the `sap-webgui` skill's locator failure patterns. The `setField`/`check`/`selectRadio`/`clickButton`/`clickTab`/`setGridCell` errors now list the controls of that kind actually present as **UNVERIFIED suggestions** (with any `technicalName`) — use them to spot the correct accessible name, but confirm it live and fix `_screens.md` (re-explore via the `explore-ui` skill if needed); never blindly swap in a similar-looking name, a wrong control can pass green. Then follow the `build-scripts` skill to rebuild the spec. |
| Ambiguous locator                 | "strict mode violation: 3 elements"                                        | Load `sap-webgui`. Prefer a verified group/dialog/region scope. Use `nth` only when that duplicate order was already observed and recorded in `_screens.md`; never add it as a positional guess during Phase 7.                                        |
| WebGUI locator instability        | iframe suffix, `M0:...`, `tblNN[...]`, wrong cell after layout change, or repeated tab text | Load `sap-webgui` for the authoritative failure patterns. Generated session IDs, rerendered table IDs, coordinates, and unverified positions require `_screens.md` correction and a rebuilt script, not an ad-hoc rerun.                              |
| SAP short dump (ST22)             | Page shows dump; test fails on next action                                 | Use `analyze_abap_dumps` on connected system, report ST22 to user — real bug, not test bug                                                                                                                                                            |
| Data no longer valid              | SAP says "material not found" for the sample                               | Follow `prepare-data` to refresh the cache                                                                                                                                                                                                             |
| Wrong assertion                   | Screen looks correct but assertion fails                                   | Test case itself may be wrong. STOP and follow `design-cases` to update the `.md` first.                                                                                                                                                              |
| Background artifact wrong/missing | The TC's `## Post-test verification` check came back wrong (see below) | The UI-level run passed but the underlying data is wrong — this is a real bug signal, not a test-writing mistake; report it as such, don't dismiss it because the spec itself was green                                                               |

## Debug tricks

- `playwright_test` with `headed: true` — visible browser window.
- `await page.pause()` in the spec drops into Playwright Inspector when run headed — this still works exactly as documented, since `playwright_test` runs the real `@playwright/test` CLI, not a reimplementation.
- **Traces are captured on failure** (`trace: "retain-on-failure"`) and are the richest failure evidence — they contain every HTTP request/response (including SAP PAI post bodies), a DOM snapshot per action, and the console. They are written under `<TEST_FOLDER>/.playwright-artifacts/`, NOT under `test-results/<connectionId>/<TC-ID>/`. On a failure, `playwright_test` now prints the absolute trace-zip and last-screenshot paths in its summary — use those. Open a trace with the Playwright VS Code extension, or `npx playwright show-trace <path>` if the user has Node (optional). Inspecting the trace should come BEFORE guessing at a cause (it is step 3a in the playbook below).
- If tool output, manifest, screenshot, one evidence-driven headed run, and trace inspection still cannot identify a complex control or interaction sequence, load the `sap-webgui-recording` skill and ask the user for one focused recording. Persist the learned behavior in `_screens.md`, then follow the `build-scripts` skill to rebuild the spec. Never execute the raw recording or patch a generated locator directly into the failing spec from Phase 7.

## Evidence .docx

`build_evidence_report` produces ONE `.docx` per (program, connectionId) at `tests/<PROGRAM>/test-results/<PROGRAM>-<CONNECTION-ID>-report.docx`, aggregating every TC that has a `manifest.json` under that program+connection:

- Title page: pass/fail summary, generation timestamp
- Summary table: TC-ID, title, status (color-coded), start/finish times
- Per-TC section (new page): heading, status, error if any, every step with heading + timestamp + notes + embedded screenshot
- If `verification.json` exists for that TC: a "Post-test Verification" subsection listing every check, its owner (SQL/automated or manual/user), the SQL or tool + instructions, actual versus expected, and pass/fail/pending, so a UI-green/DB-wrong result — or an unconfirmed manual check — stays visible in the audit trail

Rebuild after re-running — cheap, safe to call again.

## Final handoff

Because this phase may also run in a fresh chat, leave a complete result on disk and in the final response:

- Keep `manifest.json`, screenshots, data, fixture, trace, and `verification.json` artifacts under `<TEST_FOLDER>/tests/<PROGRAM>/test-results/<connectionId>/<TC-ID>/`.
- Rebuild the aggregated evidence report after the selected run set is complete.
- Report `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, every selected TC-ID and pass/fail/blocked status, post-test verification status (including any manual checks still pending user confirmation, with the tool for each), and the absolute report path.
- For each failure, classify the required remediation as `analyze-and-plan`, `explore-ui`, `design-cases`, `define-data`, `prepare-data`, `build-scripts`, runtime/environment, or product defect. Persist the diagnosis in an artifact or repeat it in the handoff so a new chat can act on it.

> **Say after the handoff is complete:** "Step 5 completed. Evidence: every selected case has a final status and diagnosis, and the report path was handed off. Phase 7 completed. Next: follow the identified remediation workflow or archive the evidence."

## Rules

- **Never try to modify the bundled runtime (`SapSession`/`SapArtifacts`/etc.) during Phase 7.** Its implementation is not in the workspace. Consult `helpers-reference` if you think it is the actual problem.
- **Never modify `test-cases/<TC-XXX>.md` during Phase 7.** If it is wrong, STOP and follow `design-cases`.
- **Never modify `.data.md`.** If data is wrong, either re-run `prepare-data` or the `.md` needs update.
- **Never delete `tests/<PROGRAM>/test-results/`.** It's the audit trail.
- **Never rerun blindly on failure.** Diagnose first.
