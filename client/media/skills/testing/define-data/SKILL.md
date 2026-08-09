---
name: define-data
description: Standalone Phase 4 of SAP UI testing. Authors one tests/<PROGRAM>/test-cases/TC-XXX.data.md requirement spec per case marked dataRequired: yes — choosing the narrowest correct source (sql/static/generated/seeded), and generating upload fixtures in the EXACT file format the program parses (xlsx vs csv). Validates that every dataRequired declaration has a matching sidecar. Use when the user asks to define, author, or spec test data requirements (not to resolve concrete values — that is prepare-data).
---

# Define Data — Phase 4 (of 7)

Phase order: analyze-and-plan (1) → explore-ui (2) → design-cases (3) → **define-data (4)** → prepare-data (5) → build-scripts (6) → run-scripts (7).

This phase produces `TC-XXX.data.md` requirement specs — the reusable, system-agnostic SHAPE of the data each case needs. It does NOT resolve concrete values (that is Phase 5, `prepare-data`) and does NOT write specs (Phase 6).

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Why this is its own phase

Data specs written as an afterthought at the end of a big case-writing session come out as one-line stubs ("cache key + status") that Phase 5 then has to throw away and rewrite from scratch. That is exactly what happened before this was split out. A `.data.md` is a real contract: it decides which of four sources each value comes from, whether an upload fixture is Excel or CSV, and which keys the spec (Phase 6) will reference. Getting the format wrong here means the program silently rejects the upload at run time and the "test" proves nothing. This phase exists so every data requirement gets deliberate attention, once, in the right format.

## Non-negotiable execution gate

`prepare-data` (Phase 5), `build-scripts` (Phase 6), and `playwright_test` (Phase 7) all reject cases whose `.data.md` is missing, malformed, or references undeclared keys. Author every required sidecar here, correctly, before handing off.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide tools until searched for. Before Step 0, ensure `get_test_folder` and `build_test_index` are available; if either is missing, search your available tools for it by name. If one cannot be found, tell the user.

## Step 0 — Standalone bootstrap and input gate (mandatory)

> **Say before acting:** "Starting Step 0: standalone bootstrap and input gate."

1. Call `get_test_folder` **before reading any artifact**. Treat the result as `<TEST_FOLDER>`; never infer it.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If not open in the workspace, STOP and ask them to add it.
3. Resolve `<PROGRAM>` from the request; if omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_index.md`. Auto-select only when exactly one candidate matches; otherwise ask.
4. **Enforce the Phase 3 input gate:** `_index.md`, `_findings.md`, `_units.md`, `_screens.md`, and every `TC-XXX.md` must exist. If `_index.md` is missing, STOP and follow `design-cases`. From `_index.md`, take the authoritative `Data required?` column — that is the list of cases needing a `.data.md`. Do NOT re-derive it by rereading every TC body.
5. Read `_findings.md`'s `## Input file format` — the fixture format, column count, and header names come from there.
6. Read `_units.md` — its "Effective inputs" (DB tables the program reads to validate rows, e.g. MARC/MARA existence) tell you which tables a `source: sql` requirement should query for genuinely valid values, so the data you spec actually passes the program's own validation.

> **Say before continuing:** "Step 0 completed. Evidence: test folder, program, `_index.md`, and required upstream artifacts confirmed. Next: Step 1 — enumerate data-required cases."

## Step 1 — Enumerate the cases that need data

> **Say before acting:** "Starting Step 1: list every dataRequired: yes case and its data-key references."

- From `_index.md`, list every case with `Data required? = yes`. Each needs exactly one `TC-XXX.data.md`.
- For each such case, read its `TC-XXX.md` and collect every `<data-key: ...>` placeholder used in the state table, Steps, Expected Result, and the `## Post-test verification` SQL rows. Every placeholder becomes a `requires` key.
- Cases with `Data required? = no` get NO sidecar — creating one is an error `build_test_index` rejects.

> **Say before continuing:** "Step 1 completed. Evidence: data-required cases and their referenced keys enumerated. Next: Step 2 — author each spec."

## Step 2 — Author each `TC-XXX.data.md`

> **Say before acting:** "Starting Step 2: write a complete requirement spec for every data-required case."

**Frontmatter placement — the #1 cause of silent data failures. Read this first.** The `requires:` block MUST be a `---`-delimited YAML **frontmatter at the very top of the file** — literally the first bytes. The runtime parses ONLY a leading `---` block; a `requires:` block placed anywhere else parses to nothing, so `resolveTestData` returns zero keys and every `data.<key>` silently comes back `undefined` (surfacing much later as a confusing "value is not a string" in `setField`). When you copy the template below, reproduce the `---` … `---` as the actual start of the file:

- ✅ RIGHT — file begins with the frontmatter:
  ```
  ---
  tcId: TC-001
  requires:
    - key: sample_site
      ...
  ---

  ## Manual override
  ...
  ```
- ❌ WRONG — `requires:` under a heading or inside a code fence (parses to zero requirements, `build_test_index` and `verify_test_data_usage` will now reject it):
  ````
  # TC-001 Test Data
  ## Requirements
  ```yaml
  requires:
    - key: sample_site
  ```
  ````

Do NOT wrap the frontmatter in a ` ```yaml `/` ```markdown ` code fence, and do NOT put `requires:` under a `## Requirements` heading.

Pick the NARROWEST correct `source` per key — don't default to `static` because it's easiest.

```markdown
---
tcId: TC-001
requires:
  - key: sample_something
    description: <shape of the value, not a specific value>
    source: sql
    sql: |
      SELECT ... FROM ... WHERE ...
    take: first
    distinctFrom: [sample_other] # declared on BOTH keys of the pair
  - key: sample_other
    description: <a second value that MUST differ from sample_something>
    source: sql
    sql: |
      SELECT ... FROM ... WHERE ...
    take: first
    distinctFrom: [sample_something] # Phase 5 guarantees these resolve to different values
  - key: some_constant
    description: <what this constant represents>
    source: static
    staticValue: "FERT"
  - key: upload_fixture
    description: <what the file contains and why>
    source: generated
    generator: fixture-builder
    args:
      format: xlsx # MUST match the program's parser — see Step 3
      filename: upload.xlsx
      columns: [Article, Site, Start Date, End Date, Category, Min Value, Tolerance, Alt Tolerance, Target Rate, Priority, Fallback Rate]
      rows:
        # cells may reference other keys ("{{sample_something}}") resolved above,
        # or relative-date tokens ("today", "+30d", "-5d") resolved against the
        # CURRENT run time — NEVER write an absolute date, it goes stale.
        - ["{{sample_something}}", "1000", "+30d", "+31d", "01", "100.00", "5.00", "2.00", "10.00", "1.00", "8.00"]
  - key: existing_precondition
    description: <a DB row only the report itself can create>
    source: seeded
    seed:
      viaTcId: TC-001 # prepare-data runs this TC's spec once as an approved setup step
    sql: |
      SELECT ... FROM ... WHERE ...
    take: first
---

## Manual override

- `TESTDATA_TC_001_QAS_sample_something=X` (system-specific, preferred)
- `TESTDATA_TC_001_sample_something=X` (all systems, use sparingly)
```

Rules:

- SQL must be portable ABAP SQL (see `get_abap_sql_syntax`). Do NOT bake analysis-system values into `.data.md`.
- **Never put row-limit syntax in the SQL.** ABAP SQL via ADT rejects `FETCH FIRST n ROWS ONLY`, `LIMIT`, `TOP`, and `ROWNUM`. Choosing among returned rows is what `take: first|last|any` is for; the actual fetch cap is a Phase 5 tool parameter (`execute_data_query`'s `rowRange`/`maxRows`), NOT part of the spec. A `.data.md` SQL that uses `FETCH FIRST` fails the moment Phase 5 runs it.
- **`take: first`/`last` is NOT a uniqueness guarantee.** A `SELECT` without a deterministic `ORDER BY` has no defined row order, so "first" and "last" can be the SAME row (and with one candidate they always are). If two keys must resolve to DIFFERENT values, do NOT rely on `take:` — declare `distinctFrom` (below).
- **Cross-key uniqueness → `distinctFrom: [<other_key>, …]`** on BOTH keys that must differ (e.g. two article numbers that must not be equal). This is enforced in Phase 5 by `check_test_data`, which resolves the whole program and FAILs if two mutually-`distinctFrom` keys landed on the same value — a guarantee `take:` cannot give.
- Static constants → `source: static, staticValue: ...`.
- A precondition only the application under test can create → `source: seeded`, naming the earlier TC whose spec creates it via `seed.viaTcId`. If NO TC can seed it (it's written by a different program/BAdI/interface), leave `seed.viaTcId` off and instead add `seed.manualSteps` describing how a human seeds it, so Phase 5 can present it. Check `seeded` before ever marking a case `blocked-by-data`. **Ordering note:** a `seed.viaTcId` spec is written in Phase 6, AFTER this phase — that is expected. A `seeded` requirement is DEFERRED, not broken; Phase 5 records it as deferred-until-phase-6 and resolves it in a second pass once the seeding spec exists. Record the dependency in BOTH TCs' `## Notes for automation` so the order is never a hidden surprise.
- `dataRequired: yes` in `TC-XXX.md` → a matching `TC-XXX.data.md` is mandatory. `dataRequired: no` → do not create one.
- Every `requires` key must be a key the case's `TC-XXX.md` actually references, and every `<data-key: k>` in the `.md` must have a `requires` entry here. (Keys used only in `## Post-test verification` SQL or `## Absence preconditions`, or referenced only as a seeding target, are legitimately declared here and consumed outside the spec — that is fine and not an error.)
- **A pre-test DB-state snapshot is NOT a `requires` key — never declare one.** A "row count before the run" (an `initial_row_count`-style baseline) is a MEASUREMENT Phase 7 takes immediately before the case, not an input resolved once per system. `requires` values are cached in `data.json` at first-prepare time and reused for every later run, so a baseline stored there freezes forever and every rerun then asserts a stale number. Express the check in the TC's `## Post-test verification` instead — as a relative assertion Phase 7 evaluates with a before/after query pair, or (better) an absolute assertion that needs no baseline. If you catch yourself writing a `requires` key that means "how many rows existed before," stop and move it to verification.
- **Absence-precondition keys (E8): declare the VALUE, not the emptiness.** For a case with an `## Absence preconditions` section (its premise is that a value does not exist), declare the candidate value the case types in — usually `source: static` (a dummy value expected to be absent) or `source: generated`. Do NOT try to express "a value that returns zero rows" as `source: sql` — SQL that returns nothing resolves to a missing key and the case is reported missing-data instead of running. The absence SQL itself lives in the TC; Phase 5 runs it and blocks the case if the row actually exists.

> **Say before continuing:** "Step 2 completed. Evidence: every data-required case has a `.data.md` whose keys match its `.md`. Next: Step 3 — get the fixture format right."

## Step 3 — Fixture files: match the program's real parser (do NOT default to CSV)

> **Say before acting:** "Starting Step 3: set every generated fixture's format from _findings.md's input file format (or confirm no fixtures are needed)."

**Step 3 applies ONLY to `source: generated` (upload-fixture) requirements. If you declared none in Step 2 — the program has no file-upload path — say "no generated fixtures required, Step 3 skipped" and go to Step 4.** Do not invent a fixture the program can't consume.

Upload fixtures (`source: generated`) are built by the runtime's fixture builder as either `.xlsx` or `.csv`. The program only accepts ONE of these — and a CSV handed to an Excel parser silently fails, so the "test" passes on a broken upload or errors for the wrong reason. Do NOT reach for CSV because it's simpler.

- Read `_findings.md`'s `## Input file format`. If the program parses Excel (`ALSM_EXCEL_TO_INTERNAL_TABLE`, `KCD_EXCEL_OLE_TO_INT_CONVERT`, `gui_upload` with an `.xls`/`.xlsx` filter), set `args.format: xlsx` and give `filename` an `.xlsx` extension. Only use `format: csv` when the program genuinely reads delimited text via `GUI_UPLOAD`.
- Match the EXACT column count and header names from `_findings.md` — e.g. an 11-column Excel with the exact headers the parser expects. A fixture with the wrong columns fails validation inside the program, not in the test harness.
- Each row's cells may reference other resolved keys via `{{key}}` and use relative-date tokens; never hardcode an absolute date.
- **Match the EXACT date format the program parses**, taken from `_findings.md`'s recorded format (which is verified from the conversion code — e.g. `MM.DD.YYYY` vs `DD.MM.YYYY`). A fixture whose dates are in the wrong order is silently mis-stored or rejected, and the "test" proves nothing. Set the fixture's `dateFormat` arg to that exact format so relative-date tokens (`today`, `+30d`) render correctly — do NOT rely on the builder's locale default. If `_findings.md` records the format without the proving conversion line, treat it as unverified and confirm against the source before generating.
- If the program HAS an upload path but `_findings.md` doesn't state the file format, STOP and follow `analyze-and-plan` to record it (read the upload/parse code) rather than guessing. (If there is no upload path at all, there is nothing to record and nothing to do here — you already skipped this step.)

> **Say before continuing:** "Step 3 completed. Evidence: every generated fixture's format, extension, and columns match the program's parser per `_findings.md`. Next: Step 4 — validate."

## Step 4 — Validate that declarations and sidecars agree

> **Say before acting:** "Starting Step 4: rebuild the index to confirm every dataRequired declaration has its sidecar."

Re-run `build_test_index` (`program`, the `sourceSnapshot` from `_findings.md`, and `reviewerConfirmation` = `I called the reviewer agent and it passed all test cases` — the reviewer already passed in Phase 3). This is where the `.data.md` existence check that was deferred in Phase 3 is enforced: the tool WARNS for every `dataRequired: yes` case still missing its `.data.md`, and ERRORS for any `dataRequired: no` case that has one.

`build_test_index` now also ERRORS if a `.data.md` exists but its `requires:` is not parseable top-of-file frontmatter (e.g. it's in a ` ```yaml ` fence or under a `## Requirements` heading) — a hard stop, because that file resolves to zero keys. Fix the placement, don't work around it.

**Completion requirement: there must be ZERO "`.data.md` does not exist yet" warnings.** If any remain, author the missing sidecar (or, if the case genuinely needs no data, change its `TC-XXX.md` to `dataRequired: no` — but that is a case-design decision; if unsure, follow `design-cases`). Do not hand off with outstanding warnings.

> **Say before continuing:** "Step 4 completed. Evidence: `build_test_index` reports zero missing-`.data.md` warnings and no `dataRequired`/sidecar mismatches. Next: Step 5 — hand off."

## Step 5 — Write the next-chat handoff to Phase 5 (`prepare-data`)

> **Say before acting:** "Starting Step 5: write the Phase 4 handoff."

Make disk state sufficient for a fresh `prepare-data` chat:

- Every `dataRequired: yes` case has a valid `TC-XXX.data.md`; no `dataRequired: no` case has one.
- `_index.md`/`_index.docx` are current with zero missing-sidecar warnings.
- Your final response names `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, the cases whose data still needs resolving against a live system, and any `seeded` requirements that will need approval in Phase 5.

**Your final message MUST tell the user the exact next step: "Next: Phase 5 — start a new chat, load the `prepare-data` skill, and say: Prepare data for `<PROGRAM>` on `<connectionId>` using the data specs on disk."** Naming the skill matters — without it the next chat tends to skip loading `prepare-data` and improvise.

> **Say after the handoff is complete:** "Step 5 completed. Evidence: every data spec is authored, validated, and handed off. Phase 4 completed. Next phase: Phase 5 — in a new chat, load the `prepare-data` skill and follow it."

## Anti-patterns

- ❌ Putting `requires:` in a ` ```yaml ` fenced block or under a `## Requirements` heading instead of top-of-file `---` frontmatter — it parses to nothing, so every `data.<key>` silently resolves to `undefined`.
- ❌ One-line stubs (cache key + status) instead of a real `requires` array — the exact failure that forced this phase to exist.
- ❌ Defaulting an upload fixture to CSV when the program parses Excel (or vice versa) — read `_findings.md`'s input file format.
- ❌ A generated fixture with the wrong column count/headers — it fails inside the program, not in the harness.
- ❌ Baking an absolute date or an analysis-system value into `.data.md` — use relative-date tokens and `sql`/`generated` sources.
- ❌ Putting `FETCH FIRST`/`LIMIT`/`TOP`/`ROWNUM` in a `requires` SQL — ADT rejects it; cap rows with the Phase 5 tool params and pick with `take:`.
- ❌ Declaring a pre-test row-count/baseline as a `requires` key — it's a Phase 7 measurement, not cached input; put it in `## Post-test verification`.
- ❌ Relying on `take: first`/`last` to make two keys distinct — use `distinctFrom` on both keys.
- ❌ Creating a `.data.md` for a `dataRequired: no` case, or leaving a `dataRequired: yes` case without one.
- ❌ Resolving concrete values here — that is Phase 5. This phase writes the SHAPE only.
- ❌ Editing `TC-XXX.md` bodies or the index tables — case design is Phase 3.
