---
name: analyze-and-plan
description: Standalone Phase 1 of SAP UI testing. Discovers the configured test folder and target system, downloads one complete ABAP source snapshot, then READS that source and captures the full picture in three reference artifacts — _flow.md (functional flow), _units.md (per-unit input/output inventory), and _findings.md (the fully de-bucketed decision surface with one row per branch/message plus a target-minimum case count). Does NOT explore the live UI, write test cases, or author data specs. Use when the user asks to analyse an ABAP object or plan its test coverage.
---

# Analyze & Plan — Phase 1 (of 7)

The SAP UI testing workflow is split into seven standalone phases so no single step is rushed:

1. **analyze-and-plan** (this skill) — read the source → `_flow.md` + `_units.md` + `_findings.md`.
2. **explore-ui** — explore the live WebGUI in a browser → `_screens.md`.
3. **design-cases** — write one `TC-XXX.md` per candidate case, reviewed and indexed.
4. **define-data** — write each `TC-XXX.data.md` requirement spec.
5. **prepare-data** — resolve those specs into per-system `data.json` caches.
6. **build-scripts** — write one `TC-XXX.spec.ts` per runnable case.
7. **run-scripts** — execute, verify, and produce evidence.

This phase produces THREE reference artifacts under `tests/<PROGRAM>/test-cases/`: `_flow.md`, `_units.md`, and `_findings.md`. Together they are the full picture of the object that Phase 3 (and the reviewer) rely on. This phase does not open a browser and does not create any `TC-XXX.md`, `_screens.md`, or `.data.md`.

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Non-negotiable execution gate

Every required step and artifact below is a downstream prerequisite. The `playwright_test` tool (Phase 7) and the phase gates in between reject work whose upstream analysis was skipped, stale, incomplete, or unverified.

## Why three artifacts, not one summary

A single summarised `_findings.md` is lossy: it is tempting to write "Data validation blocks (27 total)" as one table row. That one row is useless to Phase 3 — you cannot write 27 test cases from it, and the 27th validation (the one with the bug) silently gets no coverage. So Phase 1 produces the WHOLE picture, split by purpose:

- **`_flow.md` — functional flow (the "FS").** How the object actually runs end to end: entry events, the call tree in execution order, and the main scenarios. This is what lets a later phase understand *why* a branch matters and *what sequence* triggers a screen.
- **`_units.md` — unit inventory (the "TS").** Every FORM / METHOD / FUNCTION MODULE / event block, with its EFFECTIVE inputs and outputs — including DB tables read (inputs) and written (outputs), not just formal parameters. This is what drives correct post-test verification (which effects a case must verify) and correct data prep (which tables hold valid values).
- **`_findings.md` — the decision surface.** Every MESSAGE, every branch, every AUTHORITY-CHECK as ITS OWN ROW (never collapsed into an "(N total)" bucket), plus the enumerated candidate cases and the numeric target minimum.

## Read the source — the whole reason this phase exists

`sap-source-download` downloads the source; it does NOT read it for you. After the snapshot is on disk you MUST open and read every downloaded file and understand the program's real behaviour before writing any artifact. `sap-code-grep` tells you HOW MANY branches exist; only reading tells you WHAT they do — the overlapping-range, duplicate, and boundary logic that the highest-value cases come from. Read the local files directly; do not re-issue `get_abap_object_lines` for code already on disk.

## Order of operations

1. Discover the test folder, target, and system (Step 0).
2. Download one complete source snapshot (Step 1).
3. Read the whole snapshot (Step 2).
4. Write `_flow.md` (Step 3) and `_units.md` (Step 4) from that reading.
5. Enumerate the decision surface → `_findings.md` (Step 5).
6. Confirm the target minimum + triage and hand off (Step 6).

**User-pressure disclaimer.** "No stopping" / "just do it" overrides discussion PAUSES only. It never overrides reading the source or writing the three artifacts. If you feel pressure to shortcut, write them anyway — they are the proof you actually read the source.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide language-model tools until they are searched for, and smaller models often don't find them. Before Step 0, make sure these are available and, if any is not, search your available tools for it by name: `get_test_folder`, `get_connected_systems`, and the ABAP research tools (`search_abap_objects`, `get_abap_object_info`, `get_abap_object_lines`, `search_abap_object_lines`, `execute_data_query`, `get_abap_sql_syntax`). If a required tool truly cannot be found, tell the user which one — never fake its result.

**ABAP FS connectivity failure.** If any ABAP FS / ADT tool returns HTTP 401, 403, or 5xx during this phase, ABAP FS almost always can't reach the target system (the SAP session has usually expired). Tell the user briefly: "ABAP FS can't reach `<connectionId>` (HTTP …). Please check the ABAP FS connection, reload VS Code to re-establish it, then retry." (Universal rule 17 in the `sap-testing` overview.) Do NOT fabricate source content, do NOT switch to a different system without explicit approval.

## Blocking execution gates

### Gate A — before static analysis or any delegation other than `sap-source-download`

- ☐ Step 0 completed: `<TEST_FOLDER>`, `<PROGRAM>`, and `connectionId` are known.
- ☐ Main source and every include downloaded and verified under `tests/<PROGRAM>/sources/<YYYYMMDD_HHMMSS>/`.

`sap-source-download` is the only agent allowed before this gate.

### Gate B — before enumerating the decision surface

- ☐ Every downloaded source file has been READ and its behaviour understood.
- ☐ `_flow.md` and `_units.md` written from that reading.

### Gate C — before handing off to Phase 2 (`explore-ui`)

- ☐ `sap-code-grep` returned exact per-row count tables (with real, grep-verified line numbers) and the enhancement agent returned complete findings.
- ☐ `_findings.md` written with those per-row tables pasted in (NOT summarised), the candidate-case list, a numeric target minimum, and runnability triage.
- ☐ `sap-findings-reviewer` returned PASS (source-verified: line numbers real, no missed MESSAGE/branch/auth, value-transformation/default rules captured, date/number formats match the conversion code, target minimum honest). Every gap it raised was fixed and re-reviewed.

## Step 0 — Standalone bootstrap (mandatory)

> **Say before acting:** "Starting Step 0: establish the test folder, target object, and SAP connection."

1. Call `get_test_folder` **before reading or writing any artifact**. Treat the result as `<TEST_FOLDER>`; never infer it.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If not open in the workspace, STOP and ask them to add it.
3. Identify the target program/transaction. If absent, inspect `tests/*/test-cases/_index.md`; reuse only when exactly one candidate matches, otherwise ask.
4. Call `get_connected_systems` and confirm the target `connectionId`.
5. Ask which system only if ambiguous. Confirm an ABAP-tools connection to the same landscape.

> **Say before continuing:** "Step 0 completed. Evidence: test folder `<TEST_FOLDER>`, program `<PROGRAM>`, connection `<connectionId>` confirmed. Next: Step 1 — ingest the target."

## Step 1 — Ingest the target and download the source

> **Say before acting:** "Starting Step 1: ingest and download the complete target source."

Confirm the entry object against the confirmed system with `search_abap_objects` and `get_abap_object_info`.

**Resolve a transaction code to its executable object first.** When the user names a TRANSACTION (not a program/class), the tcode is not what you download — find the object it runs, in this order, and STOP and ask only if none resolves:

1. `get_abap_object_info` / `search_abap_objects` on the tcode — often resolves the program or class directly.
2. If needed, read the transaction definition: `SELECT tcode, pgmna, dypno, cinfo FROM tstc WHERE tcode = '<TCODE>'`. A non-blank `pgmna` is the report/module-pool to download.
3. If `pgmna` is blank, it is a **parameter or OO transaction** — check `TSTCP` (`param` names the target tcode/report behind a parameter transaction) and `TSTCC` (points at the class/method for an OO transaction), and resolve through to the real executable.

**Naming: keep the folder the name the user asked for; record the resolved object separately.** The program folder is `tests/<the-name-the-user-gave>/` (usually the tcode). Do NOT silently rename it to the resolved program. Record BOTH in `_flow.md` frontmatter — `target: <tcode-or-name-user-gave>` and `resolvedProgram: <the report/class you actually downloaded and analysed>` — so every later phase knows the mapping and no chat re-derives it. Download and analyse the RESOLVED object, but label everything under the user-facing name.

**Custom vs standard — decide now and act on it.** From the object name/type, determine whether this is a CUSTOM (Z/Y) object or a STANDARD SAP transaction/program. If it is a **standard** transaction (ME21N, VA01, MIGO, MM43, …), proactively tell the user up front that complete enhancement coverage for standard SAP needs an **ANST trace** — a static call-surface scan under-reports for large standard transactions — and that Step 5.2 will consume it via the `anst-guide` skill. Offer it now so they can start collecting the trace. For a **custom Z/Y** object, Step 5.2 uses `sap-enhancement-research` instead (no ANST needed). You are expected to know these two paths exist and route to the right one without being asked.

**Source download — MANDATORY.** Invoke `sap-source-download` synchronously with `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, object name, and type — and pass ONLY those inputs. Do NOT tell it how to work (e.g. "read the source with `get_abap_object_lines` and write the files"); it downloads the snapshot with `abap_download` itself, and instructing otherwise makes it fabricate the snapshot by hand — the opposite of its purpose. Wait for it. Continue only on `PASS`; on `REJECTED`, report its blocker and stop. Record the returned absolute snapshot folder — you pass it to `sap-code-grep` and record it in every artifact.

Screen field labels are NOT retrievable via `manage_text_elements`; they come from live exploration in Phase 2.

> **Say before continuing:** "Step 1 completed. Evidence: complete source snapshot `<snapshot-path>`. Next: Step 2 — read the source."

## Step 2 — Read the entire snapshot

> **Say before acting:** "Starting Step 2: read every downloaded source file and understand the behaviour."

Open and read every file under the snapshot folder. As you read, keep notes for the three artifacts you will write next:

- The runtime flow (entry events, call order) → feeds `_flow.md`.
- Each FORM/METHOD/FM and everything it reads and writes → feeds `_units.md`.
- Every validation rule and its exact condition/message; date-range validation (start ≤ end?), overlap behaviour (reject vs **truncate**?), deduplication (silent drop? logged?), boundaries → feeds `_findings.md`.
- **Value-transformation / default logic — the most-missed class.** Look specifically for code that DERIVES or DEFAULTS a value rather than validating it: `IF <field> = space ... = <default>`, "if blank use the previous DB record or a fixed default", auto-population, unit/format conversion. These run AFTER the validation gate (often buried in a persist/loop method) and each one changes what actually gets stored — so each is a distinct testable rule with its own post-test assertion (e.g. "blank rate persisted as 8", not blank). Do NOT treat a persist method as just "upsert rows"; enumerate every default/derivation it applies.
- **Exact date and number formats — verify, never assume.** Determine the format the program actually parses from the CONVERSION code, not from a guess. A positional conversion like `CONCATENATE d+6(4) d+0(2) d+3(2)` means chars 0–1 are the MONTH → the input is `MM.DD.YYYY`, NOT `DD.MM.YYYY`. Getting this backwards makes Phase 4 generate fixtures with swapped/invalid dates that the program silently mis-stores or rejects. Record the exact format AND the line of the conversion that proves it.
- **Frontend integration & WebGUI-automation compatibility — decide it here so every later phase knows.** For any upload/download/frontend-integration path, identify the EXACT mechanism and whether it can run under **WebGUI** (the only thing Playwright drives) or only under **SAP GUI for Windows**. This is decisive: a path the frontend can't perform in a browser is not automatable by this toolchain at all, and Phase 2 must not waste effort trying to observe it.
  - **OLE / frontend-Excel FMs do NOT work in WebGUI** — they automate a local Excel/OLE control that only exists in SAP GUI for Windows: `ALSM_EXCEL_TO_INTERNAL_TABLE`, `KCD_EXCEL_OLE_TO_INT_CONVERT`, any `CREATE OBJECT ... 'EXCEL.APPLICATION'`/OLE2, DDE. If the upload parses Excel via one of these, the whole upload path is **`runnable-elsewhere` (SAP GUI only)** — flag it, and do NOT plan to observe or script it via WebGUI.
  - **Native OS file dialogs** (`cl_gui_frontend_services=>file_open_dialog`/`file_save_dialog`, `F4_FILENAME`) open a Windows dialog outside the browser — the picker itself is not automatable via WebGUI (usually `manual`); a path that only needs the resulting file PATH typed into a textbox is fine.
  - Mechanisms that DO work in WebGUI (browser upload/download): `GUI_UPLOAD`/`GUI_DOWNLOAD` and `cl_gui_frontend_services=>gui_upload`/`gui_download` of a delimited/binary file.
  - Record the mechanism, its verdict (WebGUI-runnable / SAP-GUI-only / manual), and the proving line under `## Frontend integration & WebGUI compatibility` in `_findings.md`, and set the affected cases' runnability accordingly.

> **Say before continuing:** "Step 2 completed. Evidence: every snapshot file read and behaviour captured, including any frontend-integration mechanism and its WebGUI-automation verdict. Next: Step 3 — write the functional flow."

## Step 3 — Write `_flow.md` (functional flow)

> **Say before acting:** "Starting Step 3: write the functional flow."

Write `tests/<PROGRAM>/test-cases/_flow.md`:

```markdown
---
target: <PROGRAM>
targetType: report | class | transaction | process
resolvedProgram: <the executable report/class actually downloaded — same as target unless target was a tcode; see Step 1>
analyzedOn: <DATE> <TIME>
sourceSnapshot: tests/<PROGRAM>/sources/<YYYYMMDD_HHMMSS>/
---

# Functional flow — <PROGRAM>

## Purpose

<One paragraph: what the object does, for whom, and the business outcome.>

## Entry points & event sequence (in execution order)

1. INITIALIZATION — <sets defaults, SET/GET PARAMETER, ...>
2. AT SELECTION-SCREEN OUTPUT (PBO) — <MODIFY SCREEN show/hide by MODIF ID ...>
3. AT SELECTION-SCREEN (PAI) — <input validations>
4. START-OF-SELECTION — <high-level: auth → read → validate → write → display>
5. END-OF-SELECTION / display — <ALV / list / download ...>

## Call tree (who calls what, in execution order)

- START-OF-SELECTION
  - PERFORM auth_check → gcl_x=>check_auth (AUTHORITY-CHECK Z_TEST_AUTH_OBJ)
  - IF r_upl (Upload): PERFORM upload_flow
    - PERFORM read_excel → FM ALSM_EXCEL_TO_INTERNAL_TABLE
    - LOOP → PERFORM validate_row → (per-row validations)
    - PERFORM insert_db → INSERT ZTEST_TARGET_TABLE
  - IF r_rpt (Report): PERFORM report_flow → SELECT ... → ALV

## End-to-end scenarios

- Upload happy path: <sequence + expected outcome>
- Upload, invalid column count: <sequence + expected outcome>
- Report happy path: <sequence + expected outcome>
- <one bullet per other major path>
```

Keep it a flow, not a code dump — enough for a later phase to understand context and trigger sequences without re-reading everything.

> **Say before continuing:** "Step 3 completed. Evidence: `_flow.md` captures entry events, call tree, and scenarios. Next: Step 4 — write the unit inventory."

## Step 4 — Write `_units.md` (unit input/output inventory)

> **Say before acting:** "Starting Step 4: write the unit inventory."

Write `tests/<PROGRAM>/test-cases/_units.md` listing EVERY unit (FORM / METHOD / FUNCTION MODULE / event block). For each, record its **effective** inputs and outputs — not only formal parameters:

- **Inputs** = formal IMPORTING/CHANGING/TABLES params **plus** DB tables read (SELECT), global variables read, selection-screen fields consumed.
- **Outputs** = formal EXPORTING/CHANGING/RETURNING/TABLES params **plus** DB tables written/updated/deleted (INSERT/UPDATE/MODIFY/DELETE), global variables set, MESSAGEs raised, and background artifacts emitted.

A unit with no formal parameters can still have real I/O (e.g. reads MARC, updates ZMMT). Capturing this is what makes post-test verification and data prep correct — so for background effects, record the artifact in the terms Phase 3 will VERIFY it: an IDoc emitted → `IDoc (EDIDC/EDIDS/EDID4)`; a job scheduled → `job (TBTCO/TBTCP)`; a change document → `CDHDR/CDPOS`; spool → `TSP01`; an application-server file → `AL11 file <path>`; an outbound XML/PI message → `SXMB_MONI payload`. Most of these are SQL-queryable (so Phase 3 can verify them automatically); the file/XML ones usually are not (so Phase 3 marks them manual).

```markdown
---
target: <PROGRAM>
targetType: report | class | transaction | process
analyzedOn: <DATE> <TIME>
---

# Unit inventory — <PROGRAM>

| Unit (FORM/METHOD/FM) | Include | Formal params | Effective inputs (DB reads / globals / screen) | Effective outputs (DB writes / globals / messages / files) | Purpose |
| --- | --- | --- | --- | --- | --- |
| validate_row | _F01 | is_row TYPE ty_row | MARC, MARA (existence), gv_ranges | appends to gt_log, MESSAGE ZTESTMSG-023..027 | validate one input row |
| insert_db | _F01 | — | gt_valid (global) | INSERT ZTEST_TARGET_TABLE | persist validated rows |
| send_idoc | _F02 | — | gt_valid | IDoc (EDIDC/EDIDS/EDID4) via MASTER_IDOC_DISTRIBUTE | distribute records downstream |
| write_al11 | _F02 | — | gt_valid | AL11 file /tmp/export.csv (manual verify) | export to app server |
| check_auth | GCL_X | i_mode | — | rv_auth, AUTHORITY-CHECK Z_TEST_AUTH_OBJ | authorization gate |
```

Every effect in an "Effective outputs" cell is something a Phase 3 case will need to VERIFY in its `## Post-test verification` (queryable ones via SQL, files/XML via a manual check); every table in "Effective inputs" is a table Phase 5 may query for valid values.

> **Say before continuing:** "Step 4 completed. Evidence: `_units.md` lists every unit with effective I/O including DB reads/writes. Next: Step 5 — enumerate the decision surface."

## Step 5 — Enumerate the decision surface → `_findings.md`

> **Say before acting:** "Starting Step 5: enumerate the complete static decision surface into _findings.md."

### 5.1 Selection-screen inputs, radios, checkboxes

Enumerate every PARAMETER, SELECT-OPTION, block header (type, OBLIGATORY, DEFAULT, F4, `AT SELECTION-SCREEN ON` validation); every RADIOBUTTON GROUP and AS CHECKBOX and its show/hide interactions.

### 5.2 Branch/message coverage and enhancements — delegated in parallel

Prepare the enhancement input, then launch in ONE parallel batch:

1. `sap-code-grep` with program, connectionId, and `Downloaded source folder: <absolute-path>`.
2. The enhancement agent — Path A `sap-enhancement-research` (custom Z/Y: pass the recursively-enumerated non-Z call surface) or Path B `anst-enhancement-analyser` (standard tcode: load `anst-guide`, obtain the trace xlsx first).

Wait for both. `sap-code-grep` returns exact per-row tables for MESSAGE, branches (each classified `candidate`/`infrastructure`), AUTHORITY-CHECK, DB writes (DML), flow-control exits, and log-cell messages. If either output is incomplete or softened to "N+", rerun that one agent with a tighter prompt before continuing.

**Runtime-assembled messages count too.** A `MESSAGE <var> TYPE ...` whose text is built earlier (via `CONCATENATE`/string template/assignment) has no literal on the statement line — `sap-code-grep` traces the variable back and lists each possible resulting text as its own row. When you read the source, confirm each distinct assembled text became its own MESSAGE row and its own candidate; two branches building two different texts into the same variable are two distinct outcomes, not one.

**Sanity-check the grep line numbers before trusting them.** A common failure is the grep agent READING the source and estimating instead of running a real `Grep` — which fabricates line numbers and misses statements. If the branch/message rows all cluster in the first few hundred lines of a much longer include, or a cited line doesn't actually hold that statement, reject the output and rerun `sap-code-grep`, insisting it run an actual `Grep` over the snapshot files and copy the real line numbers. Paste its verified rows into `_findings.md`; never re-number them yourself from a skim.

### 5.3 SELECT profiling, background artifacts, input file format

- For each SELECT, run a `COUNT(*)` via `execute_data_query` (call `get_abap_sql_syntax` first, `displayMode: "internal"`). Flag `>100k` performance-sensitive; `0` empty base data.
- Enumerate every background/persisted artifact (JOB_*, IDOC_*, OPEN DATASET, `INSERT`/`UPDATE`/`MODIFY`/`DELETE` on DB tables, `EXPORT ... TO DATABASE`, spool, `cl_bcs`, `SO_*`). **Include `MODIFY` — it is the most-missed write statement** (it is both a DB upsert and an internal-table operation, so check each one's target: a real DB table is a persisted effect, an in-memory `gt_*`/`lt_*` table is not). `sap-code-grep`'s DB-writes table already classifies these — cross-check it. Each DB-table write = a mandatory verification case, and each earns a `## Post-test verification` row in Phase 3.
- Record the exact **input file format** the program parses (Excel via `ALSM_EXCEL_TO_INTERNAL_TABLE`/`KCD_EXCEL_OLE_TO_INT_CONVERT`/`gui_upload` with an xls filter ⇒ `.xlsx`; delimited `GUI_UPLOAD` ⇒ CSV/TXT), with expected column count and headers.

### 5.4 Write `_findings.md` — paste grep tables VERBATIM, never bucket

Write `tests/<PROGRAM>/test-cases/_findings.md`. **The single most important rule: every branch, validation, and MESSAGE that `sap-code-grep` returned is ITS OWN ROW.** If grep found 27 validation branches, `_findings.md` has 27 rows — each naming its unit (from `_units.md`), its exact condition, and its message/outcome. A row that reads "Data validation blocks (27 total)" with a prose list is a BUCKETING DEFECT and makes Phase 3 impossible — expand it. "(N total)" may appear only as a section header whose table below actually contains N rows.

```markdown
# Static findings for <PROGRAM>

Analyzed on: <DATE> <TIME> | System: <SYSTEM> | Includes read: N | Total source lines: N
Source snapshot: `tests/<PROGRAM>/sources/<YYYYMMDD_HHMMSS>/`
Reference: see `_flow.md` (functional flow) and `_units.md` (unit I/O inventory).

## Selection-screen inputs (N total)

| Name | Type | OBLIGATORY | DEFAULT | F4 | Validation |
| ---- | ---- | ---------- | ------- | -- | ---------- |

## Radios & checkboxes (N total)

| Name | Group | Default | Interactions |
| ---- | ----- | ------- | ------------ |

## Branches (one row PER branch — paste sap-code-grep verbatim, do NOT merge)

Keep the `Testable?` column from `sap-code-grep` (`candidate` / `infrastructure` + reason). `infrastructure` rows are listed but do NOT feed the target minimum; every `candidate` row does. A guard that raises a MESSAGE or aborts the flow is always `candidate`.

| # | Unit (from _units.md) | Line | Exact condition | Testable? | True-path outcome | False/else outcome |
| - | --------------------- | ---- | --------------- | --------- | ----------------- | ------------------ |

## MESSAGE statements (one row per MESSAGE — verbatim text)

**Give every row a stable `Msg ID` and reuse it everywhere.** This is the exact token Phase 3 puts in `messagesExpected` and the reviewer cross-checks — so define it once, here: for a T100 message use `<CLASS>-<NNN>` (e.g. `ZDUMMYMSG-014`); for an inline literal, a `TEXT-nnn` text-pool message, or a runtime-assembled message with no class/number, use `MSG-<nn>` numbered in table order (`MSG-01`, `MSG-02`, …). Do NOT prefix with the program name — the file is already program-scoped, and a program-prefixed token would not match what Phase 3 writes. One assembled text = one row = one `Msg ID`.

| # | Msg ID | Unit | Line | Type (E/W/S/I/A/X) | Class-Num (or "inline"/"text-pool"/"assembled") | Verbatim text | Trigger condition |
| - | ------ | ---- | ---- | ------------------ | ----------------------------------------------- | ------------- | ----------------- |

## AUTHORITY-CHECK (one row each — each = 2 cases: with, without)

| # | Unit | Object | Fields |
| - | ---- | ------ | ------ |

## DB writes / persisted effects (one row per DB-table write — from sap-code-grep's DML table)

| # | Unit | Line | Statement (INSERT/UPDATE/MODIFY/DELETE) | Target DB table | Verified in Phase 3 by (table to query) |
| - | ---- | ---- | --------------------------------------- | --------------- | --------------------------------------- |

## Flow-control exits / Log-cell messages (one row each)

## SELECT profiling (N total)

| Table | WHERE (typical) | COUNT(*) on <SYSTEM> | Flag |
| ----- | --------------- | -------------------- | ---- |

## Background artifacts emitted

- <one bullet each: table/job/IDoc/spool/file>

## Input file format

- <e.g. XLSX, exactly 11 columns: Article, Site, ... — parsed via ALSM_EXCEL_TO_INTERNAL_TABLE>

## Frontend integration & WebGUI compatibility

| Path | Mechanism (FM/method + line) | WebGUI verdict | Consequence for testing |
| ---- | ---------------------------- | -------------- | ----------------------- |
| <e.g. Excel upload> | `ALSM_EXCEL_TO_INTERNAL_TABLE` (OLE) at _M01 line N | SAP-GUI-only (no OLE in a browser) | upload-path cases are `runnable-elsewhere`; Phase 2 must NOT try to observe/automate it via WebGUI |
| <e.g. template download> | `file_save_dialog` (native OS dialog) | picker not automatable via WebGUI | `manual` |
| <e.g. report output> | ALV via `cl_salv_table` | WebGUI-runnable | normal |

## Customer enhancements (from the enhancement agent)

## Candidate cases (one row per candidate — the plan Phase 3 will realise)

| Candidate | Category | Derived from (branch/message/auth/behaviour row) | Runnable? |
| --------- | -------- | ------------------------------------------------ | --------- |

Rules that produce candidates (apply mechanically). **Count by DISTINCT OBSERVABLE OUTCOME, not by statement** — the most-missed candidates are the ones with no line to point at:
- 1 per MESSAGE row (fired) + 1 counter-case where meaningful
- 1 per `candidate` branch **for EACH side that has a distinct observable outcome, including a "does nothing" side.** A branch whose false/else path simply leaves the screen unchanged or the rows untouched is STILL a distinct observable outcome and gets its own candidate — this is the single most-skipped case class precisely because nothing in the code marks it. A branch generates zero candidates only when both sides are observationally identical (pure `infrastructure`).
- 2 per AUTHORITY-CHECK (with, without)
- 1 per radio/checkbox visibility rule
- 1 per behavioural rule (overlap truncation, exact-duplicate drop, start-after-end, each boundary)
- 1 per value-transformation/default rule (blank field → previous value or fixed default, unit/format conversion) — each is a distinct persisted outcome to verify
- 1 per background artifact / DB-table write
- (Phase 2 adds 1 per discovered runtime control)

Example of the do-nothing outcome (dummy): a guard `IF <flag> IS INITIAL. <skip the update>. ENDIF.` — the true path (update happens) and the false path (nothing is written, rows stay as they were) are TWO candidates: one asserts the update, one asserts the table is unchanged.

**Preliminary target minimum: N** (honest sum of the rows above, counting each distinct observable outcome; no "sandbox-only" filtering). Phase 2 recomputes after discovered controls.

## Runnability triage (annotation only — never reduces the target)

Per candidate: `runnable` | `runnable-elsewhere` | `blocked-by-data` | `manual`, with a concrete reason for any non-`runnable` case. A path that only works in SAP GUI for Windows (OLE Excel upload) is `runnable-elsewhere`; a native-OS-dialog interaction is usually `manual`. Cross-reference the "Frontend integration & WebGUI compatibility" table so Phase 2 doesn't try to explore a WebGUI-impossible path and Phase 3 triages it correctly.

## Categories deliberately omitted

Phase 3 (`design-cases`) checks a fixed list of 12 mandatory categories against this program. Any category the report genuinely cannot exhibit MUST be justified here with a concrete reason grounded in the units/branches above — not "not applicable" alone. This exists so a category isn't silently dropped and only added after reviewer FAIL.

| Category            | Present in candidate list? | If absent — concrete justification (unit / behaviour / source line) |
| ------------------- | -------------------------- | ------------------------------------------------------------------- |
| happy-path          |                            |                                                                     |
| boundary            |                            |                                                                     |
| invalid             |                            |                                                                     |
| mandatory           |                            |                                                                     |
| authorization       |                            |                                                                     |
| empty               |                            |                                                                     |
| large               |                            |                                                                     |
| idempotency         |                            |                                                                     |
| cross-tx            |                            |                                                                     |
| concurrency         |                            |                                                                     |
| background-artifact |                            |                                                                     |
| discovered-control  |                            | Phase 2 recomputes — leave "TBD (Phase 2)" here                    |

Example valid justifications:
- `idempotency` — "Pure read-only report; no INSERT/UPDATE/MODIFY/DELETE across any of the units in `_units.md` (verified)".
- `cross-tx` — "No CALL TRANSACTION, SUBMIT, or BAPI call in any unit; only DB reads and ALV render".
- `concurrency` — "No ENQUEUE_/DEQUEUE_ in any unit; no UPDATE on lock-prone tables".

## Notes for automation

- Per-enhancement trigger/skip notes, non-runnable reasons, slow steps.
```

> **Say before continuing:** "Step 5 completed. Evidence: `_findings.md` has one row per branch/message/auth (nothing bucketed), a candidate-case list, and a preliminary target minimum. Next: Step 6 — confirm and hand off."

## Step 6 — Review, confirm, and hand off to Phase 2 (`explore-ui`)

> **Say before acting:** "Starting Step 6: delegate to sap-findings-reviewer, fix every gap, then write the Phase 1 handoff."

### 6.1 Adversarial review against the source (mandatory)

Delegate to the `sap-findings-reviewer` agent. Give it `<PROGRAM>`, `connectionId`, and confirm that `_findings.md`, `_flow.md`, `_units.md`, and the source snapshot exist. It reads the source itself and re-checks your analysis: line numbers are real (not eyeballed), no MESSAGE/branch/AUTHORITY-CHECK was missed, value-transformation/default rules are captured, date/number formats match the conversion code, and the target minimum is an honest full enumeration.

Expect `PASS` or an itemised gap list. Fix EVERY gap — re-run `sap-code-grep` with a real `Grep` if line numbers were fabricated, add the missed messages/branches/value-default cases, correct the format, recompute the target minimum — then re-review until PASS. Do not hand off on a FAIL; a bad `_findings.md` propagates into every later phase.

### 6.2 Confirm and hand off

Re-read the candidate list and target minimum — confirm it is the honest sum of every row, not a number sized to what looks runnable. Then make disk state sufficient for a fresh `explore-ui` chat:

- `_flow.md`, `_units.md`, and `_findings.md` all exist under `tests/<PROGRAM>/test-cases/`, with the snapshot path recorded.
- Your final response names `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, the snapshot path, and the preliminary target minimum.

Do not open a browser or write test cases in this chat. **Your final message MUST tell the user the exact next step: "Next: Phase 2 — start a new chat, load the `explore-ui` skill, and say: Explore the UI for `<PROGRAM>` on `<connectionId>` using the findings on disk."** Naming the skill matters — without it the next chat tends to skip loading `explore-ui` and improvise.

> **Say after the handoff is complete:** "Step 6 completed. Evidence: `sap-findings-reviewer` returned PASS against the source, and `_flow.md`, `_units.md`, and `_findings.md` were handed off. Phase 1 completed. Next phase: Phase 2 — in a new chat, load the `explore-ui` skill and follow it."

## Anti-patterns

- ❌ **Bucketing in `_findings.md`.** "Data validation blocks (27 total)" as one row is the exact defect that makes Phase 3 unable to cover the 27 validations. One row per branch/message/validation, always.
- ❌ **Summarising `sap-code-grep` instead of pasting its per-row tables.** Grep already returns one row per statement — keep them.
- ❌ **Enumerating without reading the source.** Counting 56 IFs is not understanding that overlapping ranges truncate. Read the code and write `_flow.md`/`_units.md` from it.
- ❌ **Treating `_units.md` I/O as formal params only.** A DB read is an input; a DB write is an output, even with no IMPORTING/EXPORTING.
- ❌ **Treating a persist/loop method as just "upsert rows"** — enumerate its blank-fill defaults, value derivations, and format conversions too (see the value-transformation guidance in Step 2).
- ❌ **Asserting a date/number format instead of reading the conversion code.** `d+6(4) d+0(2) d+3(2)` is MM.DD.YYYY, not DD.MM.YYYY — get it from the code, record the proving line.
- ❌ **Reporting grep line numbers you didn't grep.** If the branch table's line numbers were skimmed, they're fabricated; make `sap-code-grep` run a real `Grep`.
- ❌ **Planning from the object name.** If you didn't read the source and write all three artifacts, you have not done Phase 1.
- ❌ Opening a browser or writing `TC-XXX.md`/`_screens.md`/`.data.md` here — those are Phases 2–4.
