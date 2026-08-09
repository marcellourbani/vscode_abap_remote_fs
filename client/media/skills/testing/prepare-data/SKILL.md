---
name: prepare-data
description: Standalone Phase 5 of SAP UI testing. Rediscovers the configured test folder, program, approved cases, and target system from the request and upstream artifacts; then resolves TC-XXX.data.md requirements into per-system data.json caches. Works in a new chat without prior conversation context. Use when the user asks to prepare data, resolve fixtures, or bootstrap TC-XXX for a specific system.
---

# Prepare Data — Phase 5 (of 7)

Phase order: analyze-and-plan (1) → explore-ui (2) → design-cases (3) → define-data (4) → **prepare-data (5)** → build-scripts (6) → run-scripts (7). This phase reads the `TC-XXX.data.md` specs authored in Phase 4 and resolves them into per-system `data.json` caches.

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide tools until searched for. Before Step 0, ensure `get_test_folder`, `get_connected_systems`, `check_test_data`, `verify_test_data_usage`, `get_abap_sql_syntax`, and `execute_data_query` are available; if any is missing, search your available tools for it by name. If one cannot be found, tell the user.

## Non-negotiable execution gate

Every required step and artifact below is recorded as a Phase 5 prerequisite. The `playwright_test` tool verifies data preparation and **will reject every affected case** if preparation was skipped, deferred, incomplete, stale, or unverified. Complete each requirement now; runtime fallback, guessed values, and later phases cannot bypass the tool's validation.

## Why

Tests that pass with the wrong data prove nothing. A material number that exists in DEV but was deleted in QAS turns a real regression into a spurious "data missing" error, and the actual bug slips through unnoticed. Preparing data honestly per landscape is what makes the entire suite trustworthy. Fabricating a value the SQL didn't return is worse than admitting the case is blocked — it lies to the audit trail.

Goal: turn a system-agnostic `TC-XXX.data.md` requirement spec into a connection-scoped `tests/<PROGRAM>/test-results/<connectionId>/TC-XXX/data.json` value cache. `generated` requirements are validated here but built fresh only at test-run time (Step 2a).

## Why per-system

- Data valid in DEV is often absent in QAS/PRD (materials deleted, plants renamed, orders don't cross landscapes).
- One `.data.md` describes the SHAPE; each landscape needs its own resolved values.
- A later execution against a different system can repeat this phase without changing the case or spec.

## Process

### Step 0 — Standalone bootstrap and upstream input gate (mandatory)

> **Say before acting:** "Starting Step 0: standalone bootstrap and upstream input gate."

Run these actions in this exact order in every chat:

1. Call `get_test_folder` **before reading or writing any artifact**. Treat the returned absolute path as `<TEST_FOLDER>`; never infer it from the workspace or a prior chat.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If the folder is not open in the workspace, STOP and ask the user to add it via File > Add Folder to Workspace.
3. Resolve `<PROGRAM>` and requested TC-IDs from the current request. If omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_index.md`. Auto-select only when exactly one program is a valid candidate; otherwise ask. Use `_index.md` runnable status, priorities, and `Data required?` column rather than conversation memory or rereading every TC file.
4. Enforce the upstream input gate. For the selected program, require:
   - `test-cases/_index.md` and `test-cases/_findings.md` (from analyze-and-plan / design-cases)
   - `test-cases/_screens.md` (from explore-ui)
   - each selected `TC-XXX.md` (from design-cases)
   - each selected `TC-XXX.data.md` whose `_index.md` row says `Data required? = yes` (from define-data)
   If `_index.md` or `_findings.md` is missing/inconsistent, STOP and follow `design-cases` (or `analyze-and-plan` if `_findings.md` itself is missing). If `_screens.md` is missing, STOP and follow `explore-ui`. If an index row says `Data required? = yes` but the `.data.md` sidecar is missing, STOP and follow `define-data` to author it; if it says `no` but a sidecar exists, that is a case-design error — follow `design-cases`.
5. Call `get_connected_systems` and confirm the target `connectionId`; ask only if ambiguous.
6. Confirm the ABAP-tools connection is the SAME physical system. Every query passes explicit `connectionId`; never rely on defaults.
7. Cache path is `<TEST_FOLDER>/tests/<PROGRAM>/test-results/<CONNECTION-ID>/<TC-ID>/data.json`, where `<CONNECTION-ID>` is the exact connectionId **in UPPERCASE**. This matters: at run time the framework derives the folder from the connectionId uppercased, so a hand-written lowercase folder is never found on a case-sensitive filesystem (Linux/macOS) — it only "works" on Windows by accident. Use the uppercased connectionId, and never a friendly environment label in its place.

Do not continue to Step 1 until `<TEST_FOLDER>`, `<PROGRAM>`, selected TC-IDs, upstream artifacts, and `connectionId` are all resolved.

> **Say before continuing:** "Step 0 completed. Evidence: test folder `<TEST_FOLDER>`, program `<PROGRAM>`, selected cases `<TC-IDs>`, and connection `<connectionId>` confirmed. Next: Step 1 — read every data specification."

### Step 1 — Read required data specifications from `_index.md`

> **Say before acting:** "Starting Step 1: select data-required cases from `_index.md` and read their data specifications."

Read the selected rows in `_index.md`:

- `Data required? = yes` → parse the matching `tests/<PROGRAM>/test-cases/<TC-XXX>.data.md`.
- `Data required? = no` → report "no data needed" and do not read the TC body or create a cache.

Do not open every `TC-XXX.md` to rediscover this decision; the upstream phases and `build_test_index` already validated it.

#### Step 1a — Dedupe before executing anything

> **Say before acting:** "Starting Step 1a: deduplicate shared data requirements before executing queries."

This is mandatory when preparing more than one TC in a pass. Programs commonly have many cases sharing near-identical `source: sql` requirements (e.g. "a valid article that exists in MARC" needed by 10+ cases). Before running a single query:

1. Group requirements across ALL `.data.md` files in this pass by identical `sql` text (exact string match after trimming whitespace).
2. Resolve each UNIQUE query once.
3. Fan the resolved value out to every TC that declared that exact requirement.
4. Show ONE consolidated approval table (Step 3) covering every TC in the batch, not one table per TC.

> **Say before continuing:** "Step 1a completed. Evidence: unique requirements and their consuming TC-IDs have been enumerated. Next: finish Step 1."

> **Say before continuing:** "Step 1 completed. Evidence: `_index.md` classified every selected case, every required `.data.md` was parsed, and no-data cases were excluded. Next: Step 2 — resolve each requirement."

### Step 2 — Resolve each requirement

> **Say before acting:** "Starting Step 2: resolve every unique requirement against the confirmed connection."

For each `requires` entry, act according to `source`:

| source      | action                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static`    | Copy `staticValue` into the result                                                                                                                                                                                                                 |
| `sql`       | **Delegate to the `sap-data-scout` agent** (see note below). Or, if running inline: call `get_abap_sql_syntax` first, then `execute_data_query` with `displayMode: "internal"`, `rowRange: { start: 0, end: 50 }`. Apply `take:` (first/last/any). |
| `user`      | Ask the user for the value interactively                                                                                                                                                                                                           |
| `generated` | Do NOT resolve or cache this here — see Step 2a. It is built fresh by the framework itself at test-run time.                                                                                                                                       |
| `seeded`    | See Step 2b — requires running another TC's spec first, then resolving like `sql`.                                                                                                                                                                 |

> **`sap-data-scout` agent — preferred for `sql` sources.**
> When preparing more than one TC in a batch, invoke one `sap-data-scout` instance **per unique requirement** in parallel — they are fully independent and stateless. Pass each:
>
> - `connectionId` — from Step 0
> - `requirement` — copy the `description` field from the `.data.md` requirement
> - `count` — how many values you need (usually 3-5)
> - `context` (optional) — the TC-ID this feeds, so the agent can write better filter logic
>
> The agent handles `get_abap_sql_syntax` + `execute_data_query` + spot-validation internally. It returns a table of concrete values ready for the Step 3 approval table. After it returns, complete Step 3 (show the user and get approval) and Step 4 (write `data.json`); use the agent only to find data, not to write the cache.

Rules:

- **NEVER edit the `.data.md`** — it's the reusable spec.
- **Always call `get_abap_sql_syntax` before executing** — ABAP SQL differs from standard SQL.
- **Cap rows with `execute_data_query`'s `rowRange`/`maxRows`, never with SQL row-limit syntax.** ADT rejects `FETCH FIRST n ROWS ONLY`, `LIMIT`, `TOP`, `ROWNUM`. If a `.data.md` SQL contains any of them, that is a spec defect — do NOT silently rewrite it and move on; resolve it via the tool params for now AND report the offending `.data.md` so `define-data` corrects the spec (an uncorrected spec fails on the next run and for the next person).
- **Resolve a `distinctFrom` group together.** When keys declare `distinctFrom` each other, fetch several candidates for the group in one pass and assign DIFFERENT values to each key — do not resolve them independently and hope. Step 6's `check_test_data` enforces distinctness and FAILs if two mutually-`distinctFrom` keys share a value, so verify before saving.
- If SQL returns 0 rows: STOP. Do not fabricate. Report to user and suggest amending SQL, creating data manually in SAP, or picking a different test case.
- If multiple rows and `take: first`: pick row 0. Note in the manifest. (Remember `take:` does NOT guarantee distinctness — that's what `distinctFrom` is for.)
- **ADT (`execute_data_query`) is the only allowed SQL channel.** No SE16N-via-browser, no fabricated values. If `execute_data_query` returns HTTP 401/403/5xx, ABAP FS almost always can't reach the target system — briefly tell the user "ABAP FS can't reach `<connectionId>` (HTTP …). Please check the connection, then reload VS Code to re-establish the connection and retry." (Universal rule 17 in the `sap-testing` overview.) STOP; do not switch tools or fake values.

#### Step 2a — `source: "generated"` requirements need NOTHING from you here

> **Say before acting:** "Starting Step 2a: validate generated requirement declarations."

`generated` requirements (declarative file fixtures — Excel/CSV upload files, built by the runtime's fixture builder) are resolved automatically by `resolveTestData()` itself, fresh, on every test run — never cached into `data.json`, never baked with absolute dates. This is deliberate: a fixture built once and cached would go stale the moment any date field in it drifts into the past. Your only job during `prepare-data` for a `generated` requirement:

- Confirm the `args.rows` templates only reference OTHER keys that ARE resolved in this same `.data.md` (e.g. `{{sample_article}}` must be a real `sql`/`static` key declared above it) — `resolveTestData` throws a clear error at run time if not, but catching it now saves a round-trip.
- Do not write a value for this key into `data.json`. If you do, it will simply be ignored (env var and cache lookups both skip `generated` keys by design).
- If the Phase 6 spec already exists, sanity-check it later through `run-scripts` with `headed: true`; if it does not exist yet (the normal Phase 5 → Phase 6 sequence), record this as a deferred run check in the handoff. Do not run Playwright from this phase merely to inspect fixture bytes.

> **Say before continuing:** "Step 2a completed. Evidence: generated templates and referenced keys were validated. Next: Step 2b — seeded requirements."

#### Step 2b — `source: "seeded"` requirements (precondition only the report itself can create)

> **Say before acting:** "Starting Step 2b: resolve seeded preconditions."

Some cases need a DB row that nothing but the application under test can legitimately create (e.g. "a record already exists in the target Z-table with this exact combination of keys" — the report's own write path is the only sanctioned way to get one). `INSERT`-ing it directly would be fabrication; leaving the case `blocked-by-data` forever is a bigger loss than doing this properly:

This is the only Phase 5 path allowed to invoke `playwright_test`, and only because it reuses a spec that has already completed Phase 6 validation. All normal Phase 5 requirements remain data-resolution work only.

1. Read the requirement's `seed.viaTcId` — the TC whose spec, when run, produces the precondition as a side effect.
2. Confirm that TC's spec exists (`tests/<PROGRAM>/test-scripts/<viaTcId>.spec.ts`) and has itself already been validated (Phase 6/7 complete for it).
3. **If the seeding spec does NOT exist yet, this requirement is DEFERRED, not failed.** Phase 6 (`build-scripts`) writes specs AFTER this phase, so on the first Phase 5 pass a `seed.viaTcId` spec legitimately may not exist. Classify the key `deferred-until-phase-6`, list it in the handoff, and do NOT block the whole program for it — everything else can still be prepared. After Phase 6 has written the seeding spec, run Phase 5 again (a second pass) to resolve just the deferred seeded keys. This 4→5→6→5→7 loop is expected; note it in the handoff so the next chat knows a second prepare pass is owed.
4. **This is a real write. Get explicit user approval before running it**, exactly like any other destructive action this project touches.
5. Run it: call `playwright_test` with `program`, `tcId: <viaTcId>`, and `connectionId`.
6. Resolve the requirement's own `sql` (read-back) exactly as you would for a normal `sql` source, and cache the result the normal way (Step 4). From this point on it behaves exactly like a `sql`-sourced value — `resolveTestData` needs no special handling for it at run time, because by the time a test reads it, it's just another cached key.

If the requirement has `seed.manualSteps` instead of a `seed.viaTcId` (a precondition only a different program/BAdI/interface can write — see Step 2c), present those steps to the user and either have them seed it and then resolve the read-back `sql`, or record it blocked with the writer identified. If there is neither a `viaTcId` nor a manual path, the case stays `blocked-by-data` — don't force a `seeded` source onto a case that has no real setup path.

> **Say before continuing:** "Step 2b completed. Evidence: every seeded requirement was resolved, approved for seeding, or marked blocked with a reason. Next: Step 2c — foreign-writer preconditions."

#### Step 2c — the precondition needs a value NO tested spec can produce (foreign writer)

> **Say before acting:** "Starting Step 2c: identify the writer for foreign-owned preconditions."

Some data needs a value that no TC in this program can produce because it's written by a *different* program/BAPI/user-exit/interface (typical example: a custom `Z*` field on a standard table like `KNA1`, populated by a separate maintenance report or IDoc inbound handler). The wrong response — repeatedly attempting random maintenance transactions (SE38 create, XD02, SM30, SE16N edit, SE37 test) hoping one will let you write the field — burns time and hits change-locked systems hardest.

Do the discovery step FIRST, before trying anything:

1. **Trace who writes the field.** Use `find_where_used` (or `search_abap_object_lines` with an anchored regex like `UPDATE\s+<table>|MODIFY\s+<table>|INSERT\s+<table>|<field>\s*=`) on the target table AND the specific field name. The real writer usually lands in one of: a Z-maintenance report (`Z*_UPD_*`, `Z*_LOAD_*`, `Z*_MAINT`), a BAdI implementation on a standard tx (VD02/XD02 save exits), an IDoc inbound function module, or a data-migration LSMW/BAPI. Note the exact object and how it's normally invoked.
2. **Check if that writer has a callable interface on this system.** A Z-report you can F8-run in SE38 is different from a BAdI that only runs during XD02 save. Note what would be needed to invoke it here (existing seed data, authorisation, a test transport).
3. **Present the finding to the user and ASK how to proceed.** Something like: "Field `<T>-<F>` for TC-XXX is normally written by `<object>` (BAdI on VD02 save / Z_LOAD_XYZ program / IDoc handler). This system is <change-locked / open>. Options: (a) run `<writer>` with these inputs, (b) pin `TESTDATA_<TC>_<system>_<key>=<value>` for a value you know exists, (c) mark the case `blocked-by-data` with reason `no writer path on this landscape`. Which do you want?" Wait for the answer.
4. **Never guess your way in** by attempting SE16N/XD02/SM30/SE37 as trial-and-error, and never `INSERT`/`UPDATE` directly — even when authorised, that fabricates the audit trail (no CDHDR/CDPOS, no source-of-truth match with production).
5. If the user picks "blocked", record it in the handoff with the reason and the identified writer (so a later run on a different landscape has the fix path documented).

Trace-first, ask-second is the rule — never try-random-transactions.

> **Say before continuing:** "Step 2c completed. Evidence: foreign-writer preconditions were traced, presented to the user, and either handed a resolution path or marked blocked with the writer identified. Next: Step 2d — absence preconditions."

#### Step 2d — verify `## Absence preconditions` (a case whose premise is that a value does NOT exist)

> **Say before acting:** "Starting Step 2d: verify absence preconditions for any 'value does not exist' case."

Some cases (invalid-key / not-found / unknown-value) are only valid if a specific value is genuinely ABSENT on this system — a value that happens to exist turns the test green for the wrong reason. For each selected TC that has an `## Absence preconditions` section:

1. Read the absence SQL, substituting the case's resolved candidate value (the `static`/`generated` key from its `.data.md`).
2. Run it via `execute_data_query` on the confirmed connection.
3. **Zero rows → precondition holds; the case is preparable.** **One or more rows → the value EXISTS on this system: BLOCK the case** with a concrete reason ("`<key>` value `<v>` exists on `<connectionId>`; the 'not found' premise doesn't hold — pick an absent value or change the case"). Do NOT proceed as if it were fine.

This is a Phase 5 responsibility because `check_test_data` deliberately never touches the DB for absence; only a real query here can prove it.

> **Say before continuing:** "Step 2d completed. Evidence: every absence precondition was queried; cases whose value unexpectedly exists are blocked. Next: finish Step 2."

> **Say before continuing:** "Step 2 completed. Evidence: every unique requirement has a resolved value, generated declaration, user request, or explicit blocker. Next: Step 3 — show values for approval."

### Step 3 — Show the user before saving

> **Say before acting:** "Starting Step 3: present one consolidated data-approval table."

Print ONE table of resolved values across the whole batch (key → value + description + which TC(s) it applies to, per Step 1a). Ask confirmation. Never persist without approval.

> **Say before continuing:** "Step 3 completed. Evidence: the user approved the consolidated resolved values. Next: Step 4 — save the cache."

### Step 4 — Save the cache

> **Say before acting:** "Starting Step 4: save approved per-connection data caches."

Write to `tests/<PROGRAM>/test-results/<CONNECTION-ID>/TC-XXX/data.json` (connectionId UPPERCASE, per Step 0) — one write per TC, even though Step 1a may have resolved several TCs' shared keys together:

```json
{
  "sample_material": "1234567",
  "sample_plant": "1000",
  "_meta": {
    "system": "DEV-100",
    "resolvedAt": "2026-07-16T10:00:00Z",
    "sqlHashes": { "sample_material": "sha1..." }
  }
}
```

**Cache ONLY `sql`- and `seeded`-resolved keys.** Never write a `static` or `generated` key into `data.json`:

- `generated` — built fresh every run (Step 2a); caching it reintroduces the stale-fixture bug it exists to prevent.
- `static` — the value already lives in the `.data.md` as `staticValue`. If you also cache it, the cache SHADOWS the spec at run time (cache is read before `static`), so editing the `.data.md` later silently has no effect. Leave static values out; `resolveTestData` reads them straight from the spec. (The runtime now also ignores cached entries for `static`/`generated` keys as a backstop, but don't rely on that — just don't write them.)

At runtime the framework picks the cache folder matching the exact `connectionId`. If you prepare data for several landscapes, their folders sit side-by-side:

```
tests/<PROGRAM>/test-results/DEV-100/TC-042/data.json
tests/<PROGRAM>/test-results/QAS-100/TC-042/data.json
tests/<PROGRAM>/test-results/PRD-100/TC-042/data.json
```

Changing one connection's data never affects another connection's runs.

> **Say before continuing:** "Step 4 completed. Evidence: approved `data.json` paths written for each prepared TC. Next: Step 5 — verify data-key usage where specs exist."

### Step 5 — Verify data-key usage when a spec already exists

> **Say before acting:** "Starting Step 5: verify data-key usage for existing specs."

If `tests/<PROGRAM>/test-scripts/<TC-XXX>.spec.ts` already exists, call `verify_test_data_usage` instead of eyeballing it.

This mechanically diffs every `data.<key>` reference in `TC-XXX.spec.ts` against the `requires:` keys in `TC-XXX.data.md` and fails loudly on any mismatch — no more "optional, if you remember" manual read-through.

If the spec does not exist yet, this is not a Phase 5 failure. Mark the check as deferred; `build-scripts` must run it immediately after creating the spec.

> **Say before continuing:** "Step 5 completed. Evidence: usage checks passed or were explicitly deferred because the specs do not yet exist. Next: Step 6 — pre-flight the system."

### Step 6 — Pre-flight the whole system before declaring it ready

> **Say before acting:** "Starting Step 6: pre-flight all program data for the target connection."

Once every TC in the program has been prepared for a system, call the `check_test_data` tool.

This calls the EXACT SAME `resolveTestData()` the Playwright specs use, for every `TC-*.data.md` in the program, and reports every case that still has a missing key, an unresolved `seeded` requirement, or a fixture that failed to build — before anyone spends time launching a real Playwright run against a half-prepared system. It also FAILs on a `distinctFrom` violation (two keys that must differ resolved to the same value) and WARNs when a `data.json` holds a `static`/`generated` key it shouldn't (a cached value shadowing the spec). Act on both — re-resolve the distinct pair, or delete the stray cached key.

Read its breakdown, not just the headline count. It reports how many cases were "prepared from data.json cache (sql/seeded)" versus "no cache needed (static/generated only)" versus "resolved from a TESTDATA_* env pin" versus "FAILED". A high "resolvable" number does NOT mean you prepared a lot of data — the no-cache-needed cases would pass on a brand-new system with zero prep. Only the "prepared from data.json cache" count reflects real work you did here; make sure every `sql`/`seeded` case you intended to prepare is in that bucket, not silently sitting in "no cache needed" because its requirement was mis-declared.

> **Say before continuing:** "Step 6 completed. Evidence: `check_test_data` result recorded for `<PROGRAM>` on `<connectionId>`. Next: Step 7 — write the handoff."

### Step 7 — Write the next-chat handoff

> **Say before acting:** "Starting Step 7: write the Phase 5 handoff."

Before ending Phase 5, make the disk state sufficient for a brand-new `build-scripts` chat:

- Every selected case is classified as prepared, no data needed, awaiting explicit seed approval, or blocked with a concrete reason.
- Approved values are saved only under `<TEST_FOLDER>/tests/<PROGRAM>/test-results/<connectionId>/<TC-ID>/data.json`.
- `check_test_data` has been run for the program/system when preparing the complete program.
- Your final response names `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, prepared/no-data/blocked TC-IDs, and the `check_test_data` result.

Do not rely on the next chat knowing which rows you chose. Persist approved values and report blockers. **Your final message MUST tell the user the exact next step: "Next: Phase 6 — start a new chat, load the `build-scripts` skill, and say: Build scripts for `<PROGRAM>` using the approved cases on disk; primary system is `<connectionId>`."** Naming the skill matters — without it the next chat tends to skip loading `build-scripts` and improvise.

> **Say after the handoff is complete:** "Step 7 completed. Evidence: prepared/no-data/blocked cases and readiness results were handed off. Next phase: Phase 6 — in a new chat, load the `build-scripts` skill and follow it."

## Anti-patterns

- ❌ Modifying the `.data.md` to inline a value — breaks portability
- ❌ Guessing a value the SQL didn't return
- ❌ Skipping `get_abap_sql_syntax` — syntax errors will waste turns
- ❌ Executing SQL with `displayMode: "ui"` — pops a webview; use `"internal"` for programmatic capture
- ❌ Saving credentials or user names in `data.json`
- ❌ Running this phase in prod without explicit user consent — SELECTs on huge tables cost real CPU
- ❌ Writing a `generated`-source key into `data.json` — it will be ignored at best, and stale-fixture bugs at worst if some future code path starts trusting it
- ❌ Writing a `static`-source key into `data.json` — the cached copy then SHADOWS the `.data.md`'s `staticValue` at run time (cache is read before static), so later edits to the spec silently have no effect. Cache only `sql`/`seeded` keys.
- ❌ Silently rewriting a `.data.md` SQL that uses `FETCH FIRST`/`LIMIT` and moving on — cap rows with `rowRange`/`maxRows` AND report the spec so `define-data` fixes it.
- ❌ Resolving `distinctFrom` keys independently instead of assigning distinct values from one candidate set — `check_test_data` will FAIL on a collision.
- ❌ Running a `seeded` requirement's setup spec without explicit user approval — it is a real write, no different from any other destructive action
- ❌ Trying random maintenance transactions (SE38 create, SE16N edit, XD02, SM30, SE37 test) for a foreign-writer precondition instead of tracing the real writer first via `find_where_used` (Step 2c) and asking the user how to proceed
- ❌ Direct `INSERT`/`UPDATE` on an SAP table to seed data, even when authorised — no CDHDR/CDPOS, no source-of-truth match with production; fabricated audit trail
- ❌ Resolving the same `sql` text separately for every TC that needs it instead of deduping per Step 1a
- ❌ Declaring a case `blocked-by-data` without checking whether an earlier TC's spec could seed it (Step 2b) first

## When a later run encounters missing data

The framework at runtime throws:

```
Missing test data for TC-042 on system QAS:
  - sample_material (A material of type FERT with plant assignment)
Prepare data for QAS (load the prepare-data skill) or set env vars TESTDATA_TC_042_QAS_<key>.
```

For a `seeded` requirement, the message additionally names the TC that must be run first:

```
Missing test data for TC-050 on system QAS:
  - existing_range (A precondition row with an overlapping date range) — requires seeding via TC-001 (prepare-data must run that spec once as a setup step, then cache the result)
```

When either error appears, follow this workflow again and resolve the missing data. You can also call `check_test_data` proactively to find every such gap in one pass instead of discovering them one at a time from test failures.
