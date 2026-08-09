---
name: design-cases
description: Standalone Phase 3 of SAP UI testing. Turns the _findings.md decision surface and the _screens.md control map into one tests/<PROGRAM>/test-cases/TC-XXX.md per candidate case — grounded in the actual code behaviour (overlap/dedup/boundary), with a per-case selection-screen state table and a mandatory post-test verification section (SQL the model runs, or manual checks the user runs) proving the object did its job. Enforces the target-minimum count, runs the adversarial reviewer, then builds the index. Use when the user asks to design or write test cases for an ABAP object.
---

# Design Cases — Phase 3 (of 7)

Phase order: analyze-and-plan (1) → explore-ui (2) → **design-cases (3)** → define-data (4) → prepare-data (5) → build-scripts (6) → run-scripts (7).

This phase produces `TC-XXX.md` files plus the rebuilt `_index.md`/`_index.docx`. It does NOT author `.data.md` files (Phase 4) and does NOT write specs (Phase 6). Each `TC-XXX.md` still DECLARES `dataRequired: yes|no`; the sidecar itself is written in Phase 4.

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract. Never delegate the whole phase.

## Non-negotiable execution gate

`build_test_index` is GATED: it refuses to build unless you pass `reviewerConfirmation` certifying the `sap-test-plan-reviewer` agent already returned PASS. You cannot produce the index — and therefore cannot hand off — without the reviewer actually running. Downstream phases and `playwright_test` reject cases whose plan was never reviewed.

## Why

The test case is the contract for everything after it: Phase 6 writes exactly what the case says, and Phase 7 proves exactly what the case claims. A case that buckets three validations into one, omits the overlapping-range scenario, or claims "records inserted correctly" without a verification step is a coverage hole dressed up as coverage. Because there are many cases to write, the temptation is to skim — which is precisely why this is its own phase and why an independent reviewer gates it. Write each case as if it is the only defence against a million-dollar defect, because it is.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide tools until searched for. Before Step 0, ensure `get_test_folder`, `get_connected_systems`, `split_test_cases`, and `build_test_index` are available; if any is missing, search your available tools for it by name. If one cannot be found, tell the user which is missing.

## Step 0 — Standalone bootstrap and input gate (mandatory)

> **Say before acting:** "Starting Step 0: standalone bootstrap and input gate."

1. Call `get_test_folder` **before reading any artifact**. Treat the result as `<TEST_FOLDER>`; never infer it.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If not open in the workspace, STOP and ask them to add it.
3. Resolve `<PROGRAM>` from the request; if omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_findings.md`. Auto-select only when exactly one candidate matches; otherwise ask.
4. **Enforce the Phase 1 + Phase 2 input gate.** All of these must exist:
   - `tests/<PROGRAM>/test-cases/_findings.md`, `_flow.md`, `_units.md` (from analyze-and-plan)
   - `tests/<PROGRAM>/test-cases/_screens.md` (from explore-ui)
   If any Phase 1 artifact is missing, STOP and follow `analyze-and-plan`. If `_screens.md` is missing, STOP and follow `explore-ui`. Never write cases from memory.
5. Read ALL of them fully:
   - `_findings.md` — the de-bucketed candidate list, one row per branch/message/auth, the behavioural rules, background artifacts, input file format, and the final target minimum.
   - `_flow.md` — the functional flow, so each case's steps follow a real trigger sequence.
   - `_units.md` — the unit I/O inventory; the "Effective outputs" column tells you exactly which effects a case must verify (which DB tables, IDocs, jobs, spool, files) and therefore what its `## Post-test verification` rows are.
   - `_screens.md` — the exact control labels for the state table.
6. **Read the actual source too — a summary is not enough.** `_findings.md` is a distilled map; the source snapshot (path recorded in `_findings.md`) is the ground truth. Before writing a case, read the relevant unit(s) in the snapshot (guided by `_units.md`) to get the EXACT message text, the exact condition that fires it, and the exact expected behaviour (e.g. that an overlap truncates rather than rejects). If while reading you find a branch or message that `_findings.md` missed, STOP and follow `analyze-and-plan` to fix `_findings.md` first — do not silently plan around a gap.
7. You pass the snapshot path to `build_test_index` as `sourceSnapshot`.
8. Call `get_connected_systems` and confirm the `connectionId` (used only if you need to re-verify a source fact live).

> **Say before continuing:** "Step 0 completed. Evidence: test folder, program, `_findings.md`/`_flow.md`/`_units.md`/`_screens.md` read, source snapshot read for the relevant units, and snapshot path confirmed. Next: Step 1 — category contract and count gate."

## Step 1 — Category contract and count gate

> **Say before acting:** "Starting Step 1: state the category contract and read the target minimum."

**Category contract — say this before creating files:** "I will use only these exact category values: `happy-path`, `boundary`, `invalid`, `mandatory`, `authorization`, `empty`, `large`, `idempotency`, `cross-tx`, `concurrency`, `background-artifact`, `discovered-control`." No aliases, uppercase variants, or invented categories. Put finer distinctions in `title` or `tags`.

**Mandatory category checklist — fill this in BEFORE writing any TC file.** Every category below is required unless the object cannot exhibit it. Walk the list in order, mark each one, and paste the completed table into `_findings.md`'s `## Categories deliberately omitted` section. The reviewer FAILs a plan that silently drops a category — writing "not applicable" without justification is the same as skipping it.

| Category            | Required unless…                                                                                                     | Present? (TC-IDs) | If absent — concrete justification from _findings.md/_units.md |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| happy-path          | never — every runnable object has one                                                                                |                   |                                                                |
| boundary            | no numeric/date/length field on the selection screen or in validation                                                |                   |                                                                |
| invalid             | no lookup / range / format-validated field                                                                            |                   |                                                                |
| mandatory           | no OBLIGATORY selection-screen field                                                                                 |                   |                                                                |
| authorization       | no AUTHORITY-CHECK (or dedicated auth callout in `_findings.md`)                                                     |                   |                                                                |
| empty               | never — every report can be run with a filter that returns zero rows                                                 |                   |                                                                |
| large               | never for runnable-somewhere reports — one broad-range case that exercises pagination/output limits                  |                   |                                                                |
| idempotency         | the report/tx does NOT persist state (no INSERT/UPDATE/MODIFY/DELETE/SUBMIT); pure-read reports may skip             |                   |                                                                |
| cross-tx            | the object does NOT invoke other tcodes / BAPIs / CALL TRANSACTION / SUBMIT of a different program                   |                   |                                                                |
| concurrency         | the object does NOT UPDATE lock-prone tables (no ENQUEUE_/DEQUEUE_ around real writes)                                |                   |                                                                |
| background-artifact | the object emits no job/IDoc/AL11 file/spool/email/change doc                                                        |                   |                                                                |
| discovered-control  | Phase 2 recorded ZERO new controls beyond the source-derived list                                                    |                   |                                                                |

Non-trivial report → typically 15–30 cases. `large` and `idempotency` are the two most commonly (and wrongly) skipped — do the checklist first, don't skip a row because it "seems irrelevant".

**Count gate (enforce before creating TC-001.md).** Open `_findings.md` and verify:

1. Count MESSAGE rows → each fired message = 1 TC (plus 1 counter-case where meaningful).
2. Count **each `candidate` branch** in `_findings.md` — not "branch groups", and skip only rows classified `infrastructure`. Every `candidate` condition is a distinct path. **Cover each side that has a distinct observable outcome — INCLUDING a "does-nothing" false path.** A branch whose false/else side simply leaves the screen unchanged or the data untouched is a real, testable outcome and needs its own TC; it is the most-skipped case class precisely because no statement marks it (dummy example: `IF <flag> IS INITIAL` skips an update → one TC asserts the update happened, a second asserts the table/screen is UNCHANGED). Only when both sides are observationally identical does a branch get no TC. If you merged two branch sides into one TC, split them.
3. Count AUTHORITY-CHECK rows → 2 TCs each (with, without).
4. Turn every `## Behavioural logic` rule into at least one TC: the overlap-truncation case, the exact-duplicate case, the start-after-end case, each boundary. These are the cases most likely to be skipped — do not skip them.
5. Read the final "Target minimum" and write at least that many `^TC-\d{3}\.md$` files.

Do NOT reduce the minimum for feasibility — runnability triage is a separate annotation; every candidate gets a file even when marked `manual` or `blocked-by-data`.

Categories that MUST be present unless the report cannot exhibit them: covered by the mandatory checklist above — do not repeat that logic here, act on the checklist.

> **Say before continuing:** "Step 1 completed. Evidence: category contract stated and target minimum read from `_findings.md`. Next: Step 2 — write the cases."

## Step 2 — Write one `TC-XXX.md` per candidate case

> **Say before acting:** "Starting Step 2: write one complete test case per distinct candidate path."

**Every part of a case comes from a specific Phase 1/2 artifact — keep all four open while writing, not just `_findings.md`:**

| Case section | Comes from |
| ------------ | ---------- |
| Which candidate/branch/message this case covers, its category | `_findings.md` (the candidate row) |
| The trigger sequence in `## Steps` (which event/mode/screen leads to this path) | `_flow.md` (the call tree + end-to-end scenarios) |
| Exact control labels in the state table and Steps | `_screens.md` |
| What `## Post-test verification` must check (which table/IDoc/job/file the path writes) | `_units.md` ("Effective outputs" of the units this case exercises) |
| The exact message text and precise condition | the source snapshot (read the unit; `_findings.md` points to it) |

If you write a case using only `_findings.md`, you will get the trigger sequence and the verification wrong — `_flow.md` and `_units.md` are not optional background reading, they are inputs to every case.

**File cardinality contract:** one candidate case = one file = one TC-ID. Filenames match exactly `TC-\d{3}.md`. Never create range/group files (`TC-006-TC-010.md`) and never put multiple `# TC-...` headings in one file.

For a large plan you MAY write one temporary `<TEST_FOLDER>/tests/<PROGRAM>/test-cases/_bulk-<name>.md` and call `split_test_cases` with its absolute path. The aggregate contains only `<sap-test-case id="TC-NNN">…</sap-test-case>` blocks with complete frontmatter and body, nothing outside them. The tool validates every block, refuses overwrites/invalid categories/IDs, writes one `TC-NNN.md` per block, and deletes the aggregate only on full success. It does NOT build the index.

Template:

```markdown
---
tcId: TC-001
title: <short imperative>
description: <one sentence describing the scenario and expected business behaviour; shown in _index.md>
target: Z_MY_REPORT
targetType: report | class | transaction | process
category: happy-path | boundary | invalid | mandatory | authorization | empty | large | idempotency | cross-tx | concurrency | background-artifact | discovered-control
priority: high | medium | low
runnable: runnable | manual | blocked-by-data | runnable-elsewhere # from _findings.md runnability triage — this is what build_test_index reads for summary counts
dataRequired: yes | no # mandatory; yes means a TC-XXX.data.md WILL be authored in Phase 4, no means none may exist
verification: sql | manual | mixed | none # mandatory — HOW this case proves the object did its job AFTER the UI passes (see "Post-test verification is the rule" below). Outcomes the SPEC already asserts on screen are NOT this — this is the DB/artifact truth the spec can't see. A "nothing should have been written" case is `sql` (assert the count/table is unchanged), NOT none. `none` is valid ONLY when the path cannot write anything AND no meaningful count/absence check exists (a pure error/abort case where the message is the whole outcome).
outputs: [alv | excel | email | al11 | table | idoc | job | spool]
messagesExpected: [] # MANDATORY: every message this case triggers, using the EXACT `Msg ID` token from `_findings.md`'s MESSAGE table — never invent one. For a T100 message that is `<CLASS>-<NNN>` (e.g. ["ZDUMMYMSG-001", "ZDUMMYMSG-004"]); for an inline literal / text-pool / runtime-assembled message it is the `MSG-<nn>` token `_findings.md` assigned it (e.g. ["MSG-03"]). Do NOT prefix with the program name and do NOT make up a scheme — copy the token `_findings.md` already defined, so the reviewer's MESSAGE cross-check matches. ANY case whose Expected Result names a message text MUST list its Msg ID here. Empty ONLY when the case triggers no message at all (rare — typically pure background-artifact or silent happy path).
messagesForbidden: []
tags: []
created: <YYYY-MM-DD HH:MM>
changed: <YYYY-MM-DD HH:MM>
---

# TC-001 <title>

## Preconditions

- Authorization / role X.
- Data prerequisites (will be specified in TC-001.data.md in Phase 4).

## Selection screen state at Execute

List EVERY control on the selection screen (from `_screens.md`), classified by how this case treats it. Never omit a control — an unmentioned default is a hidden assumption that bites Phase 6.

| Control          | Section           | Intended value               | Vs default                 | Rationale         |
| ---------------- | ----------------- | ---------------------------- | -------------------------- | ----------------- |
| Article          | Article Selection | `<data-key: sample_article>` | changed from empty         | Primary input     |
| Article Type     | Article Selection | (leave empty)                | RESET from default `FERT`  | We want all types |
| Include archived | Article Selection | unchecked                    | RESET from default CHECKED | Active data only  |
| ALV Output       | Output Mode       | selected                     | at default                 | ALV verification  |

## Steps

Explicit actions for every row where `Vs default = changed or RESET`. Rows at default get no action.

1. Open transaction SE38 and run program `Z_MY_REPORT`.
2. In group "Article Selection": set "Article" to `<data-key: sample_article>`; CLEAR "Article Type"; UNCHECK "Include archived".
3. In group "Output Mode": leave "ALV Output" selected.
4. Click Execute.

## Expected Result

- <observable UI outcome>
- <status/message expected — copy MESSAGE text verbatim from _findings.md>
- <background artifact expected>

## Post-test verification

<MANDATORY unless verification: none. One row per thing the object was supposed to persist or emit (from _units.md's "Effective outputs" for the units this case exercises). Each row is done either by the model via SQL (`by: sql`) or by the user via a named transaction/tool (`by: manual`).>

| Check         | by     | How                                                                                      | Expected                                                       |
| ------------- | ------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Row persisted | sql    | `SELECT ... FROM ZTEST_TARGET_TABLE WHERE ...` (use `<data-key: x>` placeholders)          | <what a passing result means, in words — not a hardcoded value> |
| IDoc created  | sql    | `SELECT docnum, status FROM edidc WHERE ...`                                             | one IDoc in status 53                                          |
| AL11 file     | manual | tool: AL11 — open `/tmp/<file>` and confirm N lines                                      | file exists with the exported rows                             |
| XML payload   | manual | tool: SXMB_MONI — find the message and confirm the mapped payload                        | outbound message with correct fields                           |

## Notes for automation

- Which screen(s) from `_screens.md` this case touches.
- Known slow steps, popup expectations, related enhancements (from _findings.md).
```

The `---` frontmatter must be the literal first lines of `TC-XXX.md` — never wrapped in a code fence or placed under a heading; `build_test_index` rejects a TC with no parseable leading frontmatter. (If you build a `_bulk-*.md` aggregate, each `<sap-test-case>` block's frontmatter is what becomes that file's top — `split_test_cases` writes it correctly.)

Field names in Steps and the state table MUST match `_screens.md` labels EXACTLY — Phase 6 uses them verbatim.

### Post-test verification is the rule, not the exception

A test case is not complete until it proves the object actually did what it was supposed to do — a green UI message only proves the screen was happy, not that the record was written, the IDoc created, or the job scheduled. Almost every runnable case therefore needs verification. This phase (design-cases) is where you DECIDE, per case: whether verification is needed, what to check, and who checks it. Phase 7 (run-scripts) then executes the `sql` checks and records the `manual` ones as pending.

**First, separate two things people conflate.** What the SPEC asserts on screen (a grid row appears, an alert fires, a field becomes visible) is a spec assertion, checked live in Phase 7 by the spec itself — it is NOT a post-test-verification row. `## Post-test verification` is only the DB / background-artifact truth the spec cannot see. Do not duplicate a spec assertion as a verification row, and do not mark a case `none` just because its visible outcome is already asserted — decide `verification` from what the path PERSISTS, not from what shows on screen.

For every runnable case, look at `_units.md`'s "Effective outputs" for the units the case exercises and add a `## Post-test verification` row for each persisted/emitted effect. Set the `verification` frontmatter field accordingly:

- **`sql`** — every check is a DB read the model can run in Phase 7. This covers most effects, because they land in queryable tables: application tables, IDocs (`EDIDC`/`EDIDS`/`EDID4`), background jobs (`TBTCO`/`TBTCP`), change docs (`CDHDR`/`CDPOS`), spool (`TSP01`). Prefer `sql` whenever the effect is queryable. **This INCLUDES negative-persistence checks:** a case whose whole point is that NOTHING was written (an invalid row rejected before persistence, a duplicate that should be dropped) is proven by a `by: sql` check that the target row-count/table is UNCHANGED — that is `verification: sql`, not `none`.
- **`manual`** — the effect cannot be proven by SQL and a human must check it: AL11 application-server file contents, an SXMB_MONI / SXI_MONITOR XML payload, an email actually arriving, an external-system record, a spool's rendered layout. Name the exact transaction/tool and what to look for. These become "pending" until the user confirms them.
- **`mixed`** — there are genuinely BOTH a runnable SQL check AND a non-queryable manual check. Do NOT reach for `mixed` just because part of the outcome is on screen — an on-screen outcome the spec asserts is not a verification check at all.
- **`none`** — VALID ONLY when the path cannot have written anything AND there is no meaningful count/absence check to run: a pure error/validation case where the object aborts before touching any table and the error MESSAGE itself is the entire outcome. If a count-unchanged check is possible and meaningful, the answer is `sql`, not `none`. If you set `none`, it must be obvious from the case (an error case) or stated in Notes — the reviewer challenges every `none` against `_units.md` and against whether a negative check was possible.

**Decision table (apply in order):**

| The case's path… | verification | Post-test rows |
| ---------------- | ------------ | -------------- |
| writes/updates/deletes a queryable table, or emits an IDoc/job/change-doc/spool | `sql` | one `by: sql` row per effect |
| should write NOTHING (reject/dedup/skip) and the target table is queryable | `sql` | one `by: sql` row asserting count/table unchanged |
| emits an effect only a human can see (app-server file, XML payload, email, rendered spool) | `manual` (or `mixed` if it ALSO has a queryable effect) | one `by: manual` row naming the tool |
| aborts before any write, no queryable pre/post state worth asserting | `none` | none |

During this phase you author only the table + frontmatter; you run nothing. A runnable, state-changing case with `verification: none` or no verification section is exactly the "UI green, DB wrong" hole this project exists to catch — the reviewer FAILs it.

**Manual vs runnable:** set `runnable:` from the triage in `_findings.md`. Pure UI-inspection, multi-user coordination, or destructive business actions that must stay human-controlled are `manual`; negative-authorization cases are usually `runnable-elsewhere`. Do not silently delete a case you can't run today — give it a file and the right `runnable` value.

**Authorization cases: the POSITIVE side is `runnable`, the NEGATIVE side is `runnable-elsewhere` — never `runnable`.** An `authorization` TC comparing "with role X" vs "without role X" needs a real SAP user for BOTH sides. The positive case runs as the normal run user (whoever the target `connectionId` authenticates as) — `runnable`. The negative case must run as a user who LACKS the authorization, and there is **no spec-level or config-level way to switch users mid-run**: `playwright_test` authenticates one session, as the connection's own user, for the whole run (see `build-scripts` and universal rule 5). So a negative-auth case can only run against a SEPARATE ABAP FS connection configured for an unauthorized user — mark it `runnable: runnable-elsewhere` with that exact reason. Marking it `runnable` is a defect the reviewer FAILs, and it is also dangerous: if it runs as the authorized user it "passes" for the wrong reason (the action was allowed, not blocked). In `## Preconditions` name the required unauthorized user / role gap and the second connection it needs; in `## Notes for automation` state that provisioning that user goes through SU01 / the customer's identity system, not any test-writable path, so `prepare-data` cannot create it. The `.data.md` may pin the user via `source: static` (dummy `staticValue: "ZTESTNOAUTH"`) or `source: user` so a different landscape can substitute a different unauthorized user without editing the spec.

**A case whose premise is that a value does NOT exist must have that premise PROVEN, not assumed.** For a "no record found" / "invalid key rejected" / "unknown value" case, do NOT hardcode a number you believe is absent and hope it stays absent — a value that exists on the run system turns the test green for the wrong reason. Set the case `dataRequired: yes` and, in the TC, add an `## Absence preconditions` section with the SQL that must return ZERO rows for the case to be valid (using a `<data-key: ...>` placeholder). Phase 4 declares the key; Phase 5 (`prepare-data`) runs the absence SQL and BLOCKS the case if the row actually exists. (`dataRequired: no` forbids a `.data.md`, so an absence-checked case is always `dataRequired: yes`.)

> **Say before continuing:** "Step 2 completed. Evidence: TC count meets the target minimum, every behavioural rule and distinct trigger has its own case, and every state-changing case carries a `## Post-test verification` section with the right `verification` value. Next: Step 3 — reviewer."

## Step 3 — Adversarial review (mandatory, BEFORE building the index)

> **Say before acting:** "Starting Step 3: delegate the plan to sap-test-plan-reviewer."

Delegate to the `sap-test-plan-reviewer` agent. Give it `<PROGRAM>`, the connection, and confirm that `_findings.md`, `_flow.md`, `_units.md`, `_screens.md`, the source snapshot, and every `TC-*.md` exist. It reads the actual source, then counts `TC-*.md` files against the target minimum, checks MESSAGE/branch/category/enhancement coverage, checks that every state-changing case carries a `## Post-test verification` section (against `_units.md`'s writes) and challenges every `verification: none`, and challenges the runnability triage.

The reviewer does not need `_index.md` to exist yet — it works from `_findings.md`, `_units.md`, the source, and the `TC-*.md` frontmatter directly. Expect `PASS` or an itemised gap list. Fix EVERY gap (add/split cases, add missing verification, correct triage) and re-review until PASS. Do not proceed to Step 4 without a genuine PASS.

> **Say before continuing:** "Step 3 completed. Evidence: `sap-test-plan-reviewer` returned PASS after every gap was fixed. Next: Step 4 — build the index."

## Step 4 — Build the index (`_index.md` + `_index.docx`)

> **Say before acting:** "Starting Step 4: rebuild the mechanical index."

Call `build_test_index` with:

- `program` = `<PROGRAM>`
- `sourceSnapshot` = the snapshot path recorded in `_findings.md`
- `reviewerConfirmation` = the EXACT text `I called the reviewer agent and it passed all test cases` (valid only after a real PASS in Step 3 — the tool rejects the build otherwise).

`_index.md` is a mechanical projection of every `TC-*.md` frontmatter — never hand-edit its tables. The tool also writes the bordered `_index.docx`. It records `analyzedOn`/`sourceSnapshot` itself; never edit those.

Expect a WARNING for every `dataRequired: yes` case whose `.data.md` doesn't exist yet — that is EXPECTED here, because data specs are authored in Phase 4. It is NOT a failure. (A `dataRequired: no` case that has a `.data.md` IS an error — fix the frontmatter or delete the stray file.)

The only section the tool preserves verbatim is `## Notes` at the bottom of `_index.md` — write freeform commentary there (explain any missing category, any clustered `manual` cases, links back to `_findings.md`). After editing only `## Notes`, refresh the docx with `build_test_index_docx`.

> **Say before continuing:** "Step 4 completed. Evidence: `build_test_index` wrote current `_index.md` and `_index.docx`; only expected `.data.md`-pending warnings remain. Next: Step 5 — present and hand off."

## Step 5 — Present for approval and hand off to Phase 4 (`define-data`)

> **Say before acting:** "Starting Step 5: present the reviewed plan and write the handoff."

Show the user:

- The `_index.docx` path as the user-friendly case list, plus a concise `_index.md` summary.
- Newly-discovered controls that generated cases.
- Destructive buttons NOT probed (need a user decision).
- Paths to `_findings.md`, `_screens.md`, `_index.md`, `_index.docx`.

Ask which cases to prioritise. Then make disk state sufficient for a fresh `define-data` chat:

- Every `TC-XXX.md` exists with a correct `dataRequired` value; `_index.md`/`_index.docx` are current.
- Your final response names `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, approved/prioritised TC-IDs, and every `dataRequired: yes` case still awaiting its `.data.md`.

**Your final message MUST tell the user the exact next step: "Next: Phase 4 — start a new chat, load the `define-data` skill, and say: Define the data specs for `<PROGRAM>` using the approved cases on disk."** Naming the skill matters — without it the next chat tends to skip loading `define-data` and improvise.

> **Say after the handoff is complete:** "Step 5 completed. Evidence: the reviewed index, discoveries, and data-pending cases were handed off. Phase 3 completed. Next phase: Phase 4 — in a new chat, load the `define-data` skill and follow it."

## Anti-patterns

- ❌ **Bucketing distinct triggers into one TC.** "All validation errors" is not a case — one TC per MESSAGE ID. "All visibility rules" is not a case — one TC per rule. If a TC's `messagesExpected` lists 3 message IDs, split it into 3.
- ❌ **`messagesExpected: []` on a case whose Expected Result mentions a message.** If the Expected Result says "error 'X'" or names any status/warning/info text, the class-num tuple MUST appear in `messagesExpected` — the reviewer FAILs otherwise. Populate it while writing the case, not after review.
- ❌ **Skipping the behavioural cases** (overlap truncation, exact-duplicate drop, start-after-end, boundaries) because they're subtle — those are the highest-value cases in `_findings.md`.
- ❌ **Dropping a branch's "does-nothing" false path** because no statement marks it — a false path that leaves data/screen unchanged is a distinct outcome and needs its own TC with a count-unchanged verification.
- ❌ **Marking a negative-authorization case `runnable`** — it must be `runnable-elsewhere` (runs on a second connection as an unauthorized user); `runnable` risks a false green under the authorized user.
- ❌ **Hardcoding a value you assume is absent** for a "not found" case — set `dataRequired: yes` and prove absence via an `## Absence preconditions` SQL that Phase 5 checks.
- ❌ **A runnable, state-changing case with no `## Post-test verification` (or `verification: none`)** — a green UI is not proof the object did its job. Only pure error/abort cases that persist nothing may be `none`.
- ❌ **Defaulting a hard-to-check effect to no verification instead of marking it `manual`.** An AL11 file or SXMB_MONI payload the model can't query is still verified — by the user; record it as a `manual` check with the tool, don't drop it.
- ❌ Skipping the reviewer, or passing `reviewerConfirmation` without a real PASS.
- ❌ Computing a low minimum then meeting it; silently deleting cases you can't run today.
- ❌ Hardcoding a specific material/plant/order in the `.md` — use `<data-key: ...>` placeholders resolved in Phases 4–5.
- ❌ A state table that lists only the fields the case touches — it must cover ALL controls from `_screens.md`.
- ❌ Authoring `.data.md` files here — that is Phase 4.
