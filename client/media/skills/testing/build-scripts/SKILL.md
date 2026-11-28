---
name: build-scripts
description: Standalone Phase 6 of SAP UI testing. Rediscovers the configured test folder, program, approved cases, and primary system from disk; validates upstream inputs; then writes one tests/<PROGRAM>/test-scripts/TC-XXX.spec.ts per case using @sap-testing/runtime. Use when the user asks to write, generate, or convert Playwright scripts from test cases.
---

# Build Scripts — Phase 6 (of 7)

Default: convert approved cases into reusable specs with the artifacts and sidecars below. An explicit request for a sanity open/execute/no-dump check or specific report logic permits a minimal spec without case, index, findings, or screen-map artifacts; verify controls live when no map exists. Scoped specs may inline verified or user-supplied data without `.data.md`, `data.json`, or `resolveTestData`; never store secrets or invent business IDs. Preserve target checks, authorization, safety, executable dependencies, and truthful reporting in either path.

If the scenario crosses SAP connections, load `multi-system-workflows` alongside this
skill. Keep one system per script and implement only the documented explicit JSON handoff
between linked stage cases.

Phase order: analyze-and-plan (1) → explore-ui (2) → design-cases (3) → define-data (4) → prepare-data (5) → **build-scripts (6)** → run-scripts (7).

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, an output contract, and `userIntent` containing the user's requested scope and applicable overrides. **Never delegate the whole phase** (e.g. "write specs for all 30 cases") to `sap-task-helper` — it is a bounded per-file helper and will reject phase-scale work. Convert cases yourself, or delegate at most a small, explicitly-listed batch of disjoint files with a per-file write boundary.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide tools until searched for. Before Step 0, ensure `abapfs_get_test_folder` and `abapfs_get_connected_systems` are available; the default reusable path also needs `abapfs_verify_test_data_usage`. Search for any required missing tool by name. If one cannot be found, tell the user.

## Default validation and scoped execution

The reusable path validates upstream artifacts and generated specs before execution. For explicit reduced scope, hand off the scope and reason to `run-scripts`, which uses `skipWorkflowValidation: true` and `overrideReason`; do not certify skipped phase gates. This bypasses workflow checks, not executable dependencies or safety.

## Why

The test case says what to verify; the spec is the ONLY thing SAP will actually be asked. If the spec drifts from the case — skips a control, ignores a default, uses a hardcoded value instead of the resolved data — the automation reports GREEN while the real bug lives on. Every deviation from the case's state table is a hole in coverage. Every hardcoded material or plant makes the spec unrunnable in the next system. Fidelity here is what turns a plan into protection.

Goal: faithful case → spec conversion by default; for explicit reduced scope, implement only the requested checks using the same runtime API.

## Process

Apply case/state-table/sidecar steps only where relevant to the selected path. Quoted progress messages are examples: never announce a read, check, or artifact as completed unless it actually was.

### Step 0 — Standalone bootstrap and input gate (mandatory)

> **Say before acting:** "Starting Step 0: standalone bootstrap and upstream input gate."

Bootstrap either path below; apply artifact requirements only to the default reusable path:

1. Call `abapfs_get_test_folder` **before reading or writing any artifact**. Treat the returned absolute path as `<TEST_FOLDER>`; never infer it from the workspace or a prior chat.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If the folder is not open in the workspace, STOP and ask the user to add it via File > Add Folder to Workspace.
3. Resolve `<PROGRAM>` and selected spec/TC-IDs from the current request. For reduced scope, choose a spec ID and enumerate existing `test-scripts/*.spec.ts` without requiring a case index. For the default path, if omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_index.md`. Auto-select only when exactly one candidate exists; otherwise ask. Use `_index.md` approval, runnability, and `Data required?` state, not prior-chat memory.
4. Default path: enforce the upstream input gate for the selected program: `_index.md`, `_screens.md`, and every selected `TC-XXX.md` must exist. If `_index.md`/`TC-XXX.md` is missing or inconsistent, STOP and follow `design-cases`; if `_screens.md` is missing, STOP and follow `explore-ui`. Read a matching `TC-XXX.data.md` only when the index says `Data required? = yes` (authored in define-data); `no` means no sidecar may exist.
5. Call `abapfs_get_connected_systems` and confirm the primary `connectionId`. Ask only if ambiguous. The spec remains system-agnostic; this identity is used to check readiness and verify source facts.
6. Default sidecar path only: if a selected case has `Data required? = yes`, inspect `<TEST_FOLDER>/tests/<PROGRAM>/test-results/<connectionId>/<TC-ID>/data.json` or run the available readiness check. Missing prepared data does **not** prevent writing a structurally valid spec, but it must be reported in the handoff as a Phase 5 (prepare-data) blocker before execution.
7. Confirm ABAP tools are available if source verification is needed. Every ABAP-tool call passes explicit `connectionId`.

Continue once the folder, program, selected specs, target connection, and inputs required by the chosen scope are known. Report only checks actually completed; do not recite completion statements for skipped artifacts.

### Step 1 — Read the test case, screens map, and helpers

> **Say before acting:** "Starting Step 1: read every source artifact required for script generation."

Default reusable-path reads (parallel):

- `tests/<PROGRAM>/test-cases/<TC-XXX>.md` (frontmatter + steps + expected)
- `tests/<PROGRAM>/test-cases/<TC-XXX>.data.md` when `_index.md` says `Data required? = yes`
- `tests/<PROGRAM>/test-cases/_screens.md` — authoritative source of labels, groups, dialogs, buttons. If missing in the default path, follow `explore-ui`. Verify that its recorded target context and live control contract match the current target; if absent or different, re-explore before script generation. For reduced scope, inspect controls live instead; do not require a persisted map.
- `tests/<PROGRAM>/test-cases/_index.md` — the reviewer's map of all cases. If a case or its runnability must change, STOP and follow `design-cases` to update the TC source artifact, then rerun `abapfs_build_test_index`; never hand-edit the index tables.
- Every `<TEST_FOLDER>/recordings/*.recording.ts` path explicitly referenced by a screen used in `_screens.md`. Do not scan unrelated recordings or depend on a recording that `_screens.md` has not reconciled.

For reduced scope, read the requested logic/source and any relevant existing artifacts, then verify unmapped labels, groups, defaults, and technical names live. No case, index, findings, or screen-map artifact is required to author the minimal spec. Keep runtime screenshots enabled unless the user explicitly declines them.

The `SapSession`/`SapArtifacts` implementation is not present in the test folder or workspace. Use the method reference in Step 2 and the exposed `@sap-testing/runtime` type declarations as the authoritative API. Load `helpers-reference` before generating `sap.se16n()` proof, and also use it whenever another capability seems missing — you cannot add runtime methods from the test workspace.

WRITE to: `tests/<PROGRAM>/test-scripts/<TC-XXX>.spec.ts` (create `test-scripts/` if it doesn't exist)

**Be restart-safe — never blindly overwrite an existing spec.** This phase can resume in a fresh chat or after a context compaction, so do not rely on memory of what you've written. Before writing `<TC-XXX>.spec.ts`, check whether it already exists:

- If it exists and you are NOT explicitly rebuilding it, treat it as already-built — leave it and move on (re-creating it from scratch silently discards any fix applied to it since).
- If it exists and genuinely needs a change, READ it and EDIT the specific part — do not overwrite the whole file.
- At Step 0, enumerate `test-scripts/*.spec.ts` up front so you know which selected TC-IDs are already done vs still to write; that list, not your memory, is the source of truth for progress.

Rules:

- Labels used in `sap.setField(...)`, `sap.selectRadio(...)`, `sap.clickButton(...)` must come from `_screens.md` or live inspection for a scoped spec.
- **System-specific screen contracts are not interchangeable.** Before generating a script, confirm that live control roles/names/scopes/defaults match the target system, even if a script worked on another ECC or S/4HANA connection.
- If a control is unverified, inspect it live before using it; default reusable cases also update the map via `explore-ui`.
- Do NOT invent helper methods. If a required capability is genuinely missing from the method reference below, follow `helpers-reference`: contain one role/name-based implementation in `sap.raw()`, tell the user the gap exists, and never pretend the runtime itself was extended.
- **Raw locators must use the runtime-selected SAP document.** SAP may render in the top-level page or an ITS frame, and frame IDs/counts differ by system. Use `const root = await sap.contentRoot()` followed by a verified role/name locator. Never hard-code `ITSFRAME1`, choose the first iframe, or query the raw top-level page directly. If `contentRoot()` fails, report the environment/runtime issue rather than guessing.
- Whenever a TC changes runnability status, follow `design-cases` to update its frontmatter and rerun `abapfs_build_test_index`; never edit the generated index row directly.

> Report the sources actually read and any controls verified live, then confirm the runtime API.

### Step 2 — Method reference

> **Say before acting:** "Starting Step 2: confirm every required interaction and assertion exists in the runtime API."

**Load the `sap-webgui` skill before choosing locators or helper scopes.** Follow its guidance for iframes, accessible names, generated IDs, dialogs, ALV, toolbars, uploads, themes, recording interpretation, and known reliability. In this phase, translate the approved case into runtime calls.

Interaction (via `SapSession`):

- `sap.open()`, `sap.openTx(tcode)`, `sap.runReport(programName)`
- `sap.setField(name, value, { group?, nth?, technicalName? })` — use `technicalName: "<ABAP_FIELD>"` (e.g. `"EKORG"`, `"LIFNR"`) when the accessible name is **ambiguous (shared by more than one field) OR absent (a nameless control)**, and the ABAP field name was verified in `_screens.md` or live inspection (read from the live `lsdata` during exploration — see `sap-webgui`). The helper uses the accessible name when unique and the verified technical name when the accessible name is missing or ambiguous. For a nameless control, still pass a human-readable `name` (used only for the step description) plus the `technicalName` that actually locates it — e.g. `sap.setField("Header amount", data.sample_amount, { technicalName: "GV_SAMPLE_FIELD" })`. Never guess the technical name.
- `sap.setRange(name, from, to, { group? })` — handles low/high endpoints even when their labels differ; pass `""` to clear the high endpoint.
- `sap.selectOption(fieldName, optionName, { group? })` — native select and SAP textbox/listbox dropdowns; exact option name, with post-selection verification. Do not select by the option's position.
- `sap.check(name, { group?, value? })`
- `sap.selectRadio(name, { group? })` — supports native and SAP custom radio controls and verifies selection; do not replace it with raw `.check()`.
- `sap.contentRoot()` — for a narrowly scoped raw locator, returns the body of the SAP document selected by the runtime (top-level page or actual ITS frame). Do not reproduce frame discovery in a spec.
- `sap.clickButton(name, { group?, dialog?, nth? })`
- `sap.clickTab(tabName)` — for dynpro header/detail tab strips (Delivery/Invoice, Conditions, Org. Data on ME21N; Where, Detail Data on MIGO; etc.). NEVER use `clickButton` on a tab — the ITS DOM has no `role="tab"` and no `title` on tabs, so the button fallback finds nothing. `sap-webgui` covers the ItemTitle/ItmWidthHelper trap.
- `sap.setGridCell(columnTitle, rowIndex, value)` — for editable ALV/table cells whose inputs have no accessible name (item-overview / posting tables). `columnTitle` is the header title/text; `rowIndex` is 1-based (row 0 is the header). It handles BOTH WebGUI editable-grid renderers — the dynpro table-control and the `CL_GUI_ALV_GRID` grid — finding the column by header, clicking the cell to materialise the editor, filling, and COMMITTING the value (the ALV grid needs a commit/blur to move the value into its buffer, which a bare `fill()` does not do). NEVER use `setField` on a grid-cell input (the input has no accessible name or title), and NEVER hand-roll a `sap.raw()` `input[id$=...].fill(...)` on a grid cell — a raw `fill()` sets the DOM value but skips the event ITS's ALV listens for, so the cell silently reverts and the test passes green on empty data. If `setGridCell` genuinely cannot drive a particular grid, that is a runtime gap to REPORT (see `helpers-reference`), not something to work around in the spec.
- `sap.pressKey(key, description?)`
- `sap.execute()`
- `sap.continueDialog(dialogTitle?)`, `sap.cancelDialog(dialogTitle?)`
- `sap.selectGridRowByText(text)`
- `sap.pickFromValueHelp(fieldName, valueText, { group? })`
- `sap.uploadFile(fieldLabel, absolutePath)` — **Only use for genuine `<input type="file">` elements** (rare in SAP). SAP WebGUI file-path fields (e.g. the local file field on a selection screen) are plain text inputs, not file choosers. Use `sap.setField(fieldLabel, absolutePath)` for those. Using `uploadFile` on a plain text field will silently do nothing or throw.
- `sap.captureDownload(triggerFn, saveAs?)` → returns file path

Assertions (via `SapSession`):

- `sap.expectAlert(text)`, `sap.expectNoAlert()` — assert ordinary success/information messages. An unexpected SAP error status fails the preceding interaction.
- `sap.expectBusinessError(() => sap.pressKey("Enter"), /expected validation message/i)` — assert the business error from exactly one awaited SapSession interaction. Prepare invalid input before this call. A missing/different error, dump, ITS failure, or session loss still fails. Never use broad try/catch suppression or ordinary action → `expectAlert()` for expected error statuses.
- `sap.statusMessage()` → `{ text, isError }` for status inspection, not error suppression.
- `sap.expectTitle(text)`
- `sap.expectDialogOpen(title)`, `sap.expectNoDialog()`
- `sap.expectGridHasRow(text)`, `sap.expectGridEmpty()`
- `sap.expectNoRuntimeError()` — redundant most of the time (SapSession interactions already check for dumps and session loss), but useful as an explicit post-condition after a long batch execution / job step.

Runtime-safety mechanisms (automatic, no explicit call needed unless noted):

- Popup guard runs before and after every action against a curated allow-list (License, System messages, Copyright, Data Privacy, Password). Unknown dialogs are left alone — including "Exit Document" ("Do you want to save?") which tests must handle explicitly with `sap.clickButton("Yes"|"No", { dialog: "Exit Document" })`.
- Multiple Logon fails rather than terminating other sessions. Reduce concurrent runs or ask the user to resolve the SAP policy; never dismiss it by ending another logon.
- Program-specific interrupters go via `new SapSession(page, { tcId, title, extraInterrupters: [{ matchTitle, dismissButton, note }] })` — never edit the built-in list.
- Runtime-error detection catches ABAP short dumps, ITS/ICM errors, and dropped-to-logon states after every action; throws with `kind`, title, URL, and a body snippet.
- `sap.openTx(...)` verifies the transaction actually loaded and throws a specific `S_TCODE`/client-missing message if SAP silently bounces to Easy Access.

Load `helpers-reference` for `sap.se16n()` usage and the auto-mechanism table; load `sap-webgui` for the popup allow-list and dump-signature list.

Background artifacts (via `SapArtifacts`) — only these two methods exist. For anything about job status, IDoc counts, or table rows, use the TC's `## Post-test verification` section instead (see `design-cases` and `run-scripts`) — that covers all DB-backed state now. These two remain because a filesystem path and rendered spool output have no SQL equivalent:

- `artifacts.verifyAL11FilePresent(fullPath)` — does NOT actually use AL11's tree UI (that's fragile to navigate deterministically); it requires a completed CG3Y download as proof; an absent error alone does not count. This downloads a local probe copy and requires the applicable authorization. Slower than it sounds. Still unverified against a real system — suspect this helper first if it misbehaves.
- `artifacts.captureLatestSpoolForUser(user)` → returns text from the SAP document via SP01 only when exactly one user-matching request is rendered; ambiguous/missing requests fail. It cannot establish latest ordering across multiple requests. Also unverified.

Data (default sidecar path only): `resolveTestData(tcId, testInfo)` → returns `{ [key]: string }` from the .data.md + cache. ALWAYS pass `testInfo` (available as the test function's second argument) — it scopes the lookup to THIS program, preventing a same-numbered TC-ID in another program from being resolved by mistake.

> **Say before continuing:** "Step 2 completed. Evidence: required runtime methods and any genuine capability gaps were identified. Next: Step 3 — select the spec template."

### Step 3 — Spec template — follow exactly

> **Say before acting:** "Starting Step 3: select and apply the correct spec template."

**Default reusable path: two variants depending on whether the case needs test data.** Read the case's `_index.md` row first:

- `Data required? = yes` → require `.data.md` and use variant A (imports `resolveTestData`, calls it, references `data.<key>`)
- `Data required? = no` → require no `.data.md` and use variant B (no `resolveTestData` import, no `data` variable)

For reusable cases, `abapfs_build_test_index` verifies that `dataRequired` and `.data.md` existence agree. For explicit reduced scope, use variant B's runtime/lifecycle structure with the requested assertions (including `sap.expectNoRuntimeError()` for a no-dump check); inline verified or user-supplied values directly or in a local constant, noting provenance without secrets. Do not create `.data.md`/`data.json` or call `resolveTestData` for this scoped path. Keep step screenshots enabled by default, including for scoped tests. Only if the user explicitly says screenshots are not needed, construct `SapSession` with `{ tcId: "TC-001", title: "Smoke check", captureSteps: false }`; the runner may still retain failure traces.

#### Variant A — case WITH `.data.md`

```typescript
/**
 * TC-001 <title>
 * Source: tests/<PROGRAM>/test-cases/TC-001.md
 * Data:   tests/<PROGRAM>/test-cases/TC-001.data.md
 */
import { test } from "@playwright/test";
import {
  SapSession,
  SapArtifacts,
  resolveTestData,
} from "@sap-testing/runtime";

test("TC-001 <title>", async ({ page }, testInfo) => {
  const sap = new SapSession(
    page,
    { tcId: "TC-001", title: "<title>" },
    testInfo,
  );
  try {
    // Pass testInfo so resolveTestData scopes its search to THIS spec's program —
    // without it, a TC-ID that also exists in another program's test-cases/ could
    // silently resolve the wrong one's data.
    const data = await resolveTestData("TC-001", testInfo);

    await sap.openTx("SE38");
    await sap.setField("Program", "Z_YOUR_REPORT_NAME");
    await sap.pressKey("F8", "Run report");

    // From TC-001.md steps — `{ group: ... }` is emitted ONLY when
    // _screens.md records a real ARIA group. Plain ITS selection screens
    // don't expose one, so most cases just pass the label:
    await sap.setField("Material", data.sample_material);
    await sap.setField("Plant", data.sample_plant);
    await sap.execute();

    // From TC-001.md expected:
    await sap.expectAlert(/completed/i);
    await sap.expectGridHasRow(data.sample_material);

    // SQL still runs later in run-scripts. For verification: sql|mixed, also add
    // sap.se16n() here after the business action to prove the resulting state is
    // visible to business users and capture criteria/output screenshots.

    await sap.finish("pass");
  } catch (err) {
    await sap.finish("fail", (err as Error).message);
    throw err;
  }
});
```

### Default reusable SE16N proof for SQL/mixed cases

For reduced scope, include SQL/SE16N proof only when the requested scope calls for it; do not expand a no-dump or logic check into unrelated database verification. Ordinary step screenshots remain enabled unless explicitly declined. For reusable SQL/mixed cases, retain the defaults below.

Before generating any SE16N block, load the `helpers-reference` skill and follow its
`sap.se16n()` contract, especially the `outputFields` and `expect` decision rules. The
short examples here show translation patterns; `helpers-reference` is the authoritative
usage reference for parameters, operators, result fields, screenshot behavior, and
cardinality assertions.

If TC frontmatter says `verification: sql` or `verification: mixed`, read its mandatory
`se16nTables` list and write a meaningful `sap.se16n()` assertion for EVERY listed table
after the business action, using the same resolved keys. Do not optimize for merely
passing the gate. If a purchase-order case declares `[EKKO, EKPO]`, show the created
header in EKKO and its expected item rows in EKPO. This is supporting screenshot proof:
keep every declared Phase 7 SQL/manual check.

Run `abapfs_verify_test_data_usage` after writing the spec. It compares literal `table` values in
the calls against `se16nTables`; comments and unrelated calls do not count. The run tool
enforces the same coverage by default. For user-waived SE16N proof, pass `skipWorkflowValidation: true` and `overrideReason` to either tool; actual data-key/resolver checks still apply. For complex joins/deltas, each listed table's SE16N assertion
shows its meaningful business-visible state while SQL proves the full technical condition.

Example for a created purchase order:

```typescript
await sap.se16n({
  table: "EKKO",
  outputFields: ["EBELN", "BUKRS", "LIFNR", "BSTYP"],
  where: [{ field: "EBELN", low: data.purchase_order }],
  expect: { exactRows: 1 }
})
await sap.se16n({
  table: "EKPO",
  outputFields: ["EBELN", "EBELP", "MATNR", "WERKS", "MENGE"],
  where: [{ field: "EBELN", low: data.purchase_order }],
  expect: { minRows: 1 }
})
```

In this example, replace EKPO's `minRows: 1` with `exactRows: <expected item count>` when
the TC knows how many items it created. Likewise, keep `outputFields` narrowly focused on
the keys and business values the screenshot must prove; never substitute `"*"` to avoid
identifying technical fields.

#### Variant B — case WITHOUT `.data.md` (no dynamic test data needed)

Use this for cases that only test validation errors, static defaults, mandatory-field messages, or anything that doesn't require live SAP data.

```typescript
/**
 * TC-002 <title>
 * Source: tests/<PROGRAM>/test-cases/TC-002.md
 * No .data.md — this case needs no dynamic test data.
 */
import { test } from "@playwright/test";
import { SapSession } from "@sap-testing/runtime";

test("TC-002 <title>", async ({ page }, testInfo) => {
  const sap = new SapSession(
    page,
    { tcId: "TC-002", title: "<title>" },
    testInfo,
  );
  try {
    await sap.openTx("Z_MY_TCODE");
    await sap.selectRadio("Some Mode");
    await sap.expectBusinessError(() => sap.execute(), /required/i);
    await sap.finish("pass");
  } catch (err) {
    await sap.finish("fail", (err as Error).message);
    throw err;
  }
});
```

> **Say before continuing:** "Step 3 completed. Evidence: the correct with-data or no-data template was selected for each case. Next: Step 4 — translate the case."

### Step 4 — Rules for translating steps

> **Say before acting:** "Starting Step 4: translate every case state, action, and expected result into runtime calls."

#### Step 4a — Selection screen state table — translate first

> **Say before acting:** "Starting Step 4a: translate every selection-screen state row."

For reusable cases, read the `## Selection screen state at Execute` table in the `.md`. For reduced scope, implement only the requested inputs and assertions, verifying relevant defaults live. For each applicable state-table row, emit ONE helper call according to `Vs default`:

| `Vs default` value                      | Emit                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `changed from empty` / `changed from X` | The action to set the new value (setField / check / selectRadio)             |
| `RESET from default X`                  | An explicit clear/uncheck/select-other action — do NOT omit                  |
| `at default`                            | Nothing (no action) — unless the row also says `confirm` (see below)         |
| `at default (confirm)`                  | An ASSERTION verifying the control is at the expected default before Execute |

Cross-check each applicable row against `_screens.md` or live inspection for a scoped spec. On mismatch, re-explore before generating the interaction.

**Two common mistranslations — do NOT make them:**

- **`{ group: "..." }` is NOT unconditional.** Emit it ONLY when the map or live inspection verifies that control inside an ARIA `group` role. Most SAP ITS selection screens render as an HTML `<table>` and expose NO `role="group"` container — passing `{ group: "Selection" }` there makes every helper timeout because the group scope never matches. Without verified evidence of a group role wrapping the control, OMIT the option entirely. Dynpro screens (ME21N, MIGO, VA01) that DO expose real groups/regions are the exception, not the rule.
- **A SELECT-OPTIONS row = `sap.setRange`, never `sap.setField`.** Use it when live inspection identifies a low/high pair, even if the labels differ across the two endpoints. The helper resolves different labels from verified SID metadata. Emit `sap.setRange(name, from, to)`; pass `""` for high when only the low end is part of the case. Never hand-build the pair using guessed labels or positions.

Examples:

| State-table row                                                                     | Emit                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Article \| Article Selection \| <data-key: sample_article> \| changed from empty`  | `await sap.setField("Article", data.sample_article, { group: "Article Selection" })`                                                  |
| `Article Type \| Article Selection \| (leave empty) \| RESET from default \`FERT\`` | `await sap.setField("Article Type", "", { group: "Article Selection" })`                                                              |
| `Include archived \| Article Selection \| unchecked \| RESET from default CHECKED`  | `await sap.check("Include archived", { group: "Article Selection", value: false })`                                                   |
| `ALV Output \| Output Mode \| selected \| at default`                               | (no action)                                                                                                                           |
| `Excel Download \| Output Mode \| not selected \| at default (confirm)`             | Use a runtime assertion when available; otherwise flag the helper gap and use one narrow assertion rooted at `await sap.contentRoot()` |

> **Say before continuing:** "Step 4a completed. Evidence: every state-table row maps to an action, assertion, or documented default. Next: Step 4b — translate the Steps section."

#### Step 4b — Translate the Steps section

> **Say before acting:** "Starting Step 4b: translate navigation, actions, and expected results."

Once state-table actions are emitted, Steps become mostly nav + Execute + follow-ups.

| .md sentence                                                                       | helper call                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Open transaction X"                                                               | `sap.openTx("X")`                                                                                                                                                    |
| "Start program X"                                                                  | `sap.runReport("X")` OR `sap.openTx("SE38")` + `sap.setField("Program", "X")` + `sap.pressKey("F8")`                                                                 |
| "Set field F in section S to <data-key: k>"                                        | `sap.setField("F", data.k, { group: "S" })`                                                                                                                          |
| "Set field F to a literal constant"                                                | `sap.setField("F", "LITERAL")` — static constants by default; scoped specs may inline verified/user-supplied non-secret business data                                                           |
| "Set field F (duplicate label; ABAP field N) to V"                                 | `sap.setField("F", V, { technicalName: "N" })` — last resort; verify the duplicate/absent label and `technicalName` in the map or live for scoped specs                               |
| "CLEAR field F in section S"                                                       | `sap.setField("F", "", { group: "S" })`                                                                                                                              |
| "Range F from A to B"                                                              | `sap.setRange("F", data.a, data.b, { group: "S" })`                                                                                                                  |
| "Check C in section S"                                                             | `sap.check("C", { group: "S" })`                                                                                                                                     |
| "UNCHECK C in section S"                                                           | `sap.check("C", { group: "S", value: false })`                                                                                                                       |
| "Select radio R in section S"                                                      | `sap.selectRadio("R", { group: "S" })`                                                                                                                               |
| "Switch to tab T" / "On the T tab, …"                                              | `sap.clickTab("T")` — tab labels are case- and punctuation-sensitive; match the verified map/live label exactly                                                                    |
| "Set column C in row R of the item overview to V"                                  | `sap.setGridCell("C", R, V)` — R is 1-based; use for editable ALV cells (ME21N items, MIGO items, VF01 items). Do NOT use `setField` on grid cells                   |
| "Set column C in row R to <data-key: k>"                                           | `sap.setGridCell("C", R, data.k)`                                                                                                                                    |
| "Click Execute"                                                                    | `sap.execute()`                                                                                                                                                      |
| "Click button B in dialog D"                                                       | `sap.clickButton("B", { dialog: "D" })`                                                                                                                              |
| "On Exit Document dialog, discard changes" / "Leave without saving"                | `sap.clickButton("No", { dialog: "Exit Document" })` — NOT auto-dismissed; must be explicit                                                                          |
| "On Exit Document dialog, save changes"                                            | `sap.clickButton("Yes", { dialog: "Exit Document" })`                                                                                                                |
| "Press F4 and pick V"                                                              | `sap.pickFromValueHelp("F", "V", { group })`                                                                                                                         |
| "Upload file P"                                                                    | Native `<input type="file">` → `sap.uploadFile(...)`; SAP path textbox → `sap.setField(...)`, as verified in the map or live                                           |
| "Download Excel"                                                                   | `const p = await sap.captureDownload(() => sap.clickButton("Export"))`                                                                                               |
| "Expected: success/information message M appears"                                 | `sap.expectAlert("M")`                                                                                                                                               |
| "Submit and expect SAP validation error M" | `await sap.expectBusinessError(() => sap.execute(), "M")` — wrap only the triggering action, not setup |
| "Expected: title Y"                                                                | `sap.expectTitle("Y")`                                                                                                                                               |
| "Expected: job J finishes" / "IDoc of type T created" / "row in table T where K=V" | Default reusable path: keep SQL in `## Post-test verification` and SE16N for `sql|mixed`; scoped path: verify only the requested outcome |
| "Expected: file P on app server"                                                   | `await artifacts.verifyAL11FilePresent("P")`                                                                                                                         |
| "Expected: message M is NOT shown"                                                 | `sap.expectNoAlert(/M/)` — pass the pattern so it asserts THAT message is absent. The bare `sap.expectNoAlert()` fails on ANY status text (e.g. a leftover message from the prior round-trip) → false negatives; use it only for "status bar completely clear". |
| "Expected: exactly N rows in the grid"                                             | Do NOT use `expectGridHasRow` for a count — it is an unanchored substring match (see anti-patterns). Assert on a business-unique value, or add the count as a `by: sql` `## Post-test verification` check |

When `_screens.md` cites a recording, use it only to clarify validated interaction order and control behavior. Apply the recording classification from `sap-webgui`; never copy a raw generated locator. Map recorded business literals to declared `data.<key>` values (or verified/user-supplied inline values for reduced scope), remove recorder noise such as a redundant click before `fill`, preserve intentional Enter/server-roundtrip behavior through helpers, and author assertions from the TC because codegen records actions only. If a required interaction still has no stable semantic contract, STOP, load the `sap-webgui-recording` skill, and request focused exploration; do not manufacture a locator.

> **Say before continuing:** "Step 4b completed. Evidence: every case step and expected result maps to an allowed runtime operation or post-test verification check. Next: finish Step 4."

> **Say before continuing:** "Step 4 completed. Evidence: each selected case was translated without omitted controls or invented helpers. Next: Step 5 — validate data keys."

### Step 5 — Data-key naming

> **Say before acting:** "Starting Step 5: validate every `data.<key>` reference against its data specification."

For sidecar-backed specs, keys in `data.k` must match `.data.md`; fix undeclared keys via `define-data`. Scoped inline specs instead check each value's verified/user-supplied provenance and local references; no sidecar or cache is required.

Run the deterministic sidecar check for reusable specs; scoped inline specs use direct validation (Step 7).

> Report either sidecar-key validation or scoped inline-value validation, whichever was actually performed.

### Step 6 — Anti-pattern review

> **Say before acting:** "Starting Step 6: review generated scripts for prohibited patterns."

- ❌ `await page.click(...)` — always via `sap.*`
- ❌ `await page.waitForTimeout(...)` — helpers wait; if a step needs extra wait, that's a helper bug
- ❌ `await page.locator('.something').click()` — no CSS selectors
- ❌ Manual `await page.screenshot()` — evidence is automatic
-  Invented business IDs or secrets. Reusable specs use sidecar `data.<key>` values; scoped specs may inline verified or user-supplied non-secret values.
- ❌ Multiple test cases in one spec — one file per TC-ID
- ❌ **Skipping any row of the state table.** Every row must produce either an action, an assertion, or nothing (documented via `at default`). Silent omission = hidden assumption.
- ❌ **Trusting Steps alone without cross-checking the state table.** If Steps say "Set Article to X and Execute" but the state table says another field must be RESET from a default, the state table wins.
-  Emitting an action for an unverified control — use the map or inspect it live for reduced scope.
- ❌ Using `sap.clickButton(tabName)` for a header tab — tabs have no `role="button"` and no `title`, so the button fallback silently finds a lookalike element or throws. Use `sap.clickTab(tabName)`.
- ❌ Using `sap.setField(columnTitle, ..., ...)` for an editable ALV grid cell — the cell input has no accessible name and no title, so the lookup fails. Use `sap.setGridCell(columnTitle, rowIndex, value)`.
- ❌ Hand-rolling a grid-cell fill via `sap.raw()` (e.g. `frameLocator(...).locator('input[id$="#R,C#if"]').fill(...)`) — a raw `fill()` sets the DOM value but skips the change/blur event ITS's ALV grid listens for, so the cell reverts and the case passes green on empty data. Use `sap.setGridCell` (it commits the value); if it can't drive the grid, report a runtime gap, don't hand-roll.
- ❌ Hardcoding `tbl<N>` prefixes, `[row,col]` / `#R,C#` coordinates, or `M0:...` IDs in a `sap.raw()` block — those change across sessions AND across tab switches. If `setGridCell` doesn't fit the case, stop and re-explore.
- ❌ Using `expectGridHasRow` to assert a ROW COUNT or match a short numeric literal — it is an UNANCHORED, case-insensitive substring match over cell text, so asserting "4" and "5" appear also matches "14", "45", or an amount of "400". Assert on a business-unique value or pass an anchored regex; use a reliable UI count assertion if available, or SQL when within scope (the default reusable path records it in `## Post-test verification`).
- ❌ Writing a spec, or a second Playwright project, that logs in as a different user for a negative-authorization case — there is NO spec/config mechanism to switch users mid-run (`abapfs_run_playwright_tests` authenticates one session as the connection's own user; universal rule 5). A negative-auth case runs against a SEPARATE ABAP FS connection (an unauthorized user) and is `runnable-elsewhere`; it is not scriptable here. If a case marked `runnable` actually needs a different user, STOP and follow `design-cases` to re-triage it, don't invent an auth workaround.
- ❌ Adding `{ technicalName: "..." }` to every `setField` "just in case" — only add it for an ambiguous or absent accessible name after verifying the ABAP field name in the map or live inspection.
- ❌ Working around a `Popup guard: recognised interrupter "X" but could not click its "Y" button` error by wrapping the action in `try/catch` — the guard is telling you the SAP-version button label changed. Add an `extraInterrupters` entry with the correct label.
- ❌ Working around a `SAP runtime error detected (dump|its|logon)` error the same way — that's a REAL bug in SAP, not a helper problem. Investigate the SAP-side cause (ST22, SM21, SMICM) before touching the spec.
- ❌ Working around a `openTx("...") silently bounced` error by chaining another `openTx` — the transaction doesn't exist in this client OR the user lacks `S_TCODE`. Fix the environment/authorisation, don't hide the symptom.

> **Say before continuing:** "Step 6 completed. Evidence: generated scripts contain no prohibited selectors, waits, screenshots, unverified business data, or omitted applicable state rows. Next: Step 7 — verify written specs."

### Step 7 — After writing

> **Say before acting:** "Starting Step 7: run deterministic verification for every written spec."

For reusable specs, call `abapfs_verify_test_data_usage` before handing off. For scoped inline specs, validate runtime imports, syntax, value provenance, and requested assertions directly; do not force sidecar verification.

This fails loudly if the spec references a `data.<key>` that `<TC-XXX>.data.md` never declared (the exact mistake that lets `resolveTestData` throw at run time), and warns about any declared key the spec never ended up using.

Hand off to `run-scripts` for execution (`headed: true` is recommended the first time). If the user already requested build-and-run, continue with that skill in the same chat; do not require another chat.

> Report the validation actually performed, including any skipped workflow checks and blockers.

### Step 8 — Write the next-chat handoff

> **Say before acting:** "Starting Step 8: write the Phase 6 handoff."

Before ending Phase 6, make the disk state sufficient for a brand-new `run-scripts` chat:

- One `.spec.ts` exists per selected TC-ID under `<TEST_FOLDER>/tests/<PROGRAM>/test-scripts/`.
- Default reusable specs have `abapfs_verify_test_data_usage` results; scoped specs have direct validation results and the explicit scope/override reason.
- List actual execution blockers; scoped verified/user-supplied inline data is allowed, not a missing-sidecar blocker.
- Your final response names `<TEST_FOLDER>`, `<PROGRAM>`, primary `connectionId`, built TC-IDs, verification results, and cases not yet runnable.

Name `run-scripts` as the execution workflow and carry forward the user's requested scope and overrides. Continue immediately if execution was already requested; otherwise offer it as the next step without requiring a fresh chat.
