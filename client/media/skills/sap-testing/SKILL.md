---
name: sap-testing
description: Entry point for the SAP UI test-automation environment. Explains project layout, the configured test folder, available tools, phase workflows, and bounded agent delegation. Use when the user asks about SAP UI testing, Playwright for SAP, writing tests for any ABAP report/transaction/process, generating test evidence docs, or mentions a SAP Testing folder.
---

# SAP Testing — Overview

## Non-negotiable execution gate

Every required phase step and artifact is a prerequisite for execution. The `playwright_test` tool verifies the full workflow state and **will reject the run** if any required item was skipped, deferred, left missing, stale, or unverified. Complete every requirement at the point specified by the relevant phase workflow; you cannot defer it and repair the omission at run time.

## Why

This is production SAP for a real business. Every bug that ships costs money — wrong invoice, wrong stock movement, wrong customer charge, blown financial close. Test suites here are the last gate before code touches accounts, orders, or inventory. The goal is NOT to finish; the goal is to catch every bug before it ships. Cutting corners because the code is long, the sandbox is thin, or the task is tedious is exactly how a million-dollar defect reaches production. Speed is worthless if you miss the bug.

The available SAP Testing tools drive **Playwright** against SAP WebGUI. Specs use the bundled `SapSession`/`SapArtifacts` runtime through `@sap-testing/runtime`, and runs produce `.docx` evidence. There is no terminal, no `npm`, no `.env` — every action below is either a tool call or a normal file edit inside the configured test folder.

## Where things live — two different places, on purpose

| Lives in                                                                                                            | Contains                                                                                                    | Editable by you?                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The **test folder** (`abapfs.testing.folder` setting — ask the user to run "ABAP FS: Enable SAP UI Testing Features" if unset) | `tests/<PROGRAM>/test-cases/*.md`, `test-scripts/*.spec.ts`, `test-results/**`, one managed `tsconfig.json` | Yes — this is a normal, git-trackable project folder. Read/write it with your normal file tools.                                   |
| **Bundled SAP Testing runtime** (available through `@sap-testing/runtime` and the tools below; not a workspace folder) | `SapSession`, `SapArtifacts`, `resolveTestData`, `buildFixture`, and the 10 tools below                  | No — its implementation is not available to file tools. See `helpers-reference` when a capability is missing.                       |

Everything for one program lives together under `tests/<PROGRAM>/` inside the test folder:

```
<test folder>/
├── tsconfig.json                (managed automatically by SAP Testing — never hand-edit)
├── recordings/                  User-assisted Playwright reference recordings; never runnable specs
└── tests/
    └── <PROGRAM_NAME>/          One folder per ABAP object under test
        ├── test-cases/          Phases 1–4 output — _flow.md + _units.md + _findings.md (P1) + _screens.md (P2) + TC-XXX.md + _index.md + _index.docx (P3) + TC-XXX.data.md (P4)
        ├── test-scripts/        Phase 6 output — TC-XXX.spec.ts (real @playwright/test specs)
        └── test-results/        Phase 5 (data.json) + Phase 7 (evidence) output — segregated per connectionId
            ├── <CONNECTION-ID>/              (e.g. DEV-100)
            │   └── <TC-ID>/                 per TC: screenshots, manifest.json, data.json, fixtures/
            └── <PROGRAM>-<CONNECTION-ID>-report.docx   ONE aggregated docx per (program, connectionId)
```

Rules:

- **All artifacts for a program are siblings** under `tests/<PROGRAM>/`. Never scatter `TC-001.md`, `TC-001.spec.ts`, and its screenshots.
- Raw user recordings live under `recordings/*.recording.ts`, outside `tests/`. They are temporary reference evidence, not phase outputs or runnable specs.
- Program folder name = **the name the user asked for** (report / tcode / class), uppercase, no spaces. When the user names a TRANSACTION, keep the folder as the tcode — do NOT rename it to the program the tcode runs. Phase 1 resolves the tcode to its executable object and records BOTH in `_flow.md` frontmatter (`target:` = the tcode/name, `resolvedProgram:` = the report/class actually analysed), so the mapping is explicit and no later phase re-derives it.
- The per-connection results folder is the `connectionId` in **UPPERCASE** (`test-results/<CONNECTION-ID>/`, e.g. `DEV-100`). The framework derives this folder by uppercasing the connectionId at run time, so any hand-written cache/results path MUST use the uppercase form — a lowercase folder is silently not found on a case-sensitive filesystem (Linux/macOS).
- Every `.spec.ts` you write imports from the fixed specifier `@sap-testing/runtime` — never a relative path (there is no `helpers/` folder in the test folder to point at). See `build-scripts` and `helpers-reference` for the full import convention and method reference.

## Skills, tools, and agents are three different things — know which is which

Backticked names in these docs refer to one of three kinds of thing, and you interact with each differently. When a doc names one, it should say the kind ("the `X` skill/tool/agent"); if it doesn't, use this list to tell them apart:

- **Skills** (you LOAD/READ them — they are operating procedures): `analyze-and-plan`, `explore-ui`, `design-cases`, `define-data`, `prepare-data`, `build-scripts`, `run-scripts`, `sap-webgui`, `sap-webgui-recording`, `helpers-reference`, `anst-guide`. "follow `X`" / "load `X`" always means a skill.
- **Tools** (you CALL them — they take inputs and return a result): the 10 SAP Testing tools listed below (`get_test_folder`, `get_sap_webgui_url`, `playwright_test`, `build_test_index`, `build_test_index_docx`, `split_test_cases`, `verify_test_data_usage`, `check_test_data`, `build_evidence_report`, `analyze_anst_enhancements`) plus the ABAP research tools (`search_abap_objects`, `get_abap_object_lines`, `execute_data_query`, `get_abap_sql_syntax`, `get_connected_systems`, `abap_download`, …).
- **Agents** (you DELEGATE to them — they run as separate subagents with their own context): `sap-source-download`, `sap-code-grep`, `sap-enhancement-research`, `sap-findings-reviewer`, `sap-screens-reviewer`, `sap-test-plan-reviewer`, `sap-data-scout`, `sap-task-helper`, `anst-enhancement-analyser`.

If a tool you need isn't in your active toolset, search for it by name before giving up (see "Tools can be hidden" below).

## The 10 available SAP Testing tools

| Tool                     | Use for                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_sap_webgui_url`     | Given an abapfs `connectionId` and optionally a `transaction`, returns a ready-to-open SAP WebGUI URL — already signed in when the connection allows auto-login. **Call this whenever you need to open a browser for live exploration.** Open the URL exactly as returned; an auto-login URL is single-use, so never append `~transaction` to it yourself. |
| `get_test_folder`        | Get the configured test folder path. **Call this first** before reading or writing any test artifact. If the folder is not open in the workspace, tell the user to open it (File > Add Folder to Workspace) before proceeding. |
| `analyze_anst_enhancements` | Classify an ANST Customer Code xlsx and write its Markdown work list beside the workbook; no Python or openpyxl required.                                                                                                                          |
| `playwright_test`        | Run one spec (or every spec in a program) against a system. Replaces "open a terminal and run `npx playwright test`." GATED: requires a `prerequisiteConfirmation` certifying the run-scripts Step 0 readiness gate was completed. NEVER use VS Code's generic `runTests` for SAP specs.                                                          |
| `build_test_index`       | Validate cases and rebuild `_index.md` plus the printable, bordered `_index.docx`; requires the analyze-and-plan `sourceSnapshot`, records `analyzedOn` automatically, and is GATED on a `reviewerConfirmation` certifying `sap-test-plan-reviewer` returned PASS. A missing `.data.md` for a `dataRequired: yes` case is only a warning (authored later in Phase 4).                                                         |
| `build_test_index_docx`  | Refresh `_index.docx` from the current `_index.md`, including preserved Notes, without rebuilding or validating the Markdown index.                                                                                          |
| `split_test_cases`       | Validate and split a `_bulk-*.md` aggregate into one `TC-NNN.md` per tagged case. Does not run `build_test_index`.                                                                                                              |
| `verify_test_data_usage` | Cross-check a spec's `data.<key>` usage against its `.data.md`. Run right after writing/editing a spec.                                                                                                                        |
| `check_test_data`        | Pre-flight resolve every case's data for a program+system before running anything for real.                                                                                                                                    |
| `build_evidence_report`  | Build the aggregated `.docx` for a program+system after a batch of runs.                                                                                                                                                       |

Everything else — reading ABAP source, live SAP UI exploration, writing markdown/TypeScript files — uses tools you already have (your built-in file tools, and your built-in browser tool for live exploration; see `analyze-and-plan` for source reading and `explore-ui` for live exploration).

## The 7 phases (one artifact each, in dependency order)

Test creation is deliberately split into seven standalone phases so no single step is rushed. Each phase produces ONE kind of artifact and hands off to the next:

| # | Phase skill        | Produces                                   |
| - | ------------------ | ------------------------------------------ |
| 1 | `analyze-and-plan` | `_flow.md` + `_units.md` + `_findings.md` — the full code picture |
| 2 | `explore-ui`       | `_screens.md` — the live web-UI control map |
| 3 | `design-cases`     | `TC-XXX.md` + `_index.md`/`_index.docx`    |
| 4 | `define-data`      | `TC-XXX.data.md` — data requirement specs  |
| 5 | `prepare-data`     | `test-results/<conn>/TC-XXX/data.json`     |
| 6 | `build-scripts`    | `test-scripts/TC-XXX.spec.ts`              |
| 7 | `run-scripts`      | `test-results/**` evidence + report docx   |

## Phases → skills

| User intent                                                                   | Load this skill                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| "Analyze this report", "Read the code", "What does this program do"           | `analyze-and-plan` (Phase 1)                                                                       |
| "Explore the UI", "Map the screens", "Produce _screens.md"                    | `explore-ui` (Phase 2)                                                                             |
| "Design test cases", "What should we test", "Write the test plan"            | `design-cases` (Phase 3)                                                                           |
| "Define the data specs", "What data does each case need"                     | `define-data` (Phase 4)                                                                            |
| "Figure out data for TC-005", "How do I get a valid material for this test"   | `prepare-data` (Phase 5)                                                                           |
| "Write the Playwright script for TC-005", "Convert TC-005 to code"            | `build-scripts` (Phase 6)                                                                          |
| "Run TC-003", "Generate evidence doc", "Why did the test fail"                | `run-scripts` (Phase 7)                                                                            |
| "Find all enhancements for <tcode>", "What user exits run in <tcode>", "ANST" | `anst-guide` (guides user to collect xlsx) → then delegate to **anst-enhancement-analyser** agent |
| "How does setField work", "What do I do if a helper is missing"               | `helpers-reference`                                                                               |
| "How should WebGUI controls be identified", "Are these locators stable"       | `sap-webgui`                                                                                      |
| "Record this WebGUI flow", "I cannot explore this complex SAP control"         | `sap-webgui-recording`                                                                            |

These are separate skills, not sub-agents — they activate automatically when relevant. You (the active Copilot agent) do the work directly, following whichever skill applies. Delegate only specific, bounded jobs to dedicated agents instead of doing them yourself — each is deliberately small and narrowly scoped:

- **`sap-code-grep`** — mechanical grep/count over the program's own source (message counts, branch counts, AUTHORITY-CHECK, flow-control exits), using an ACTUAL `Grep` over the snapshot (real line numbers, no eyeballing). See `analyze-and-plan` Step 5.2.
- **`sap-source-download`** — synchronously discovers recursive includes and downloads one complete source snapshot. See `analyze-and-plan` Step 1.
- **`sap-enhancement-research`** — finds and thoroughly explains customer enhancements on the standard call surface. See `analyze-and-plan` Step 5.2; launch it and `sap-code-grep` together in one parallel batch.
- **`sap-findings-reviewer`** — the adversarial Phase 1 gate: reads the source itself and re-checks `_findings.md`/`_flow.md`/`_units.md` for fabricated line numbers, missed MESSAGE/branch/auth statements, un-analysed value-transformation/default logic, wrong date/number formats, and an under-counted target minimum. See `analyze-and-plan` Step 6.1. Phase 1 does not hand off until it returns PASS.
- **`sap-screens-reviewer`** — the adversarial Phase 2 gate: statically checks `_screens.md` describes the live web-GUI (accessible names, initial states, dialogs, ALV) and is NOT an ABAP selection-screen/source description (no ABAP names, MODIF IDs, source snippets, message classes). Catches a `_screens.md` derived from source instead of observed. See `explore-ui` Step 9.1. Phase 2 does not hand off until it returns PASS.
- **`anst-enhancement-analyser`** — consumes an ANST xlsx after `anst-guide`, calls `analyze_anst_enhancements`, and researches every classified object.
- **`sap-test-plan-reviewer`** — the adversarial check that your test-case count and category coverage actually meet the minimum `_findings.md` derives, before you build the index. See `design-cases` Step 3. `build_test_index` will not run until this agent has returned PASS.
- **`sap-data-scout`** — resolves ad-hoc data requirements from a live SAP system (find 5 articles listed at both sites, find open POs in company code 1000, etc.). Invoke in parallel, one instance per distinct requirement. Handles `get_abap_sql_syntax` + `execute_data_query` + spot-validation internally. See `prepare-data` Step 2.
- **`sap-task-helper`** — a generic one-shot helper for a caller-defined tedious or high-volume task. Use only with a bounded objective, explicit skills to read, artifact paths, disjoint allowed writes, and a compact output contract. Multiple instances may run sequentially or in parallel; each starts with zero context and must not handle user decisions, live exploration, destructive actions, or phase orchestration.

Use these dedicated agents for their bounded tasks so large enumerations remain complete and verifiable instead of being shortened when context grows.

**Every subagent is ephemeral and one-shot.** A delegated agent runs with its own fresh context, cannot see your conversation, cannot ask you a follow-up, and returns exactly ONE response — there is no back-and-forth. Two consequences: (1) give it everything it needs UP FRONT (all inputs its contract lists); a missing input means it must reject and you re-invoke, costing a full round. (2) Trust its single response to be complete — a good gate agent reports every gap at once, and a good worker reports every value plus any deviation it made, precisely because it knows it gets no second message. If an agent's rejection is vague ("input invalid"), that's an agent bug to raise with the user, because the ephemeral contract requires it to name the exact missing/invalid thing and the fix.

**Delegation discipline — pass inputs, not methods.** When you delegate to a subagent, pass ONLY the inputs its contract specifies (IDs, paths, the objective, e.g. for `sap-source-download`: `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, object name, object type). Do NOT tell it HOW to do its job — which tools to use, to read the source with `get_abap_object_lines`, to "create the files," to skip a step. Every subagent already knows its procedure and has its own guardrails, and over-instructing can OVERRIDE those guardrails and make it do the wrong thing: telling `sap-source-download` to "read the code and write the files" makes it fabricate the compliance snapshot by hand instead of downloading it with `abap_download` — the exact opposite of its purpose. Give it the objective and the inputs; let it choose the method. If you believe a subagent's method is wrong, that's a skill bug to raise with the user — never something to "fix" by adding how-to at the call site.

## One phase per chat is supported

Each phase skill is a **standalone operating procedure**. A fresh chat must be able to continue from artifacts on disk without the prior chat's context. Starting a new chat for each phase is therefore valid and often preferable:

1. `analyze-and-plan` reads the source and writes `_findings.md`.
2. `explore-ui` explores the live UI and writes `_screens.md`.
3. `design-cases` writes the reviewed `TC-XXX.md` files and the index.
4. `define-data` writes each `TC-XXX.data.md` requirement spec.
5. `prepare-data` resolves those specs into per-system `data.json` caches.
6. `build-scripts` converts approved cases to `TC-XXX.spec.ts`.
7. `run-scripts` validates prerequisites, executes, and produces evidence.

The user should only need to name the phase plus the program or TC-ID. Do not ask them to repeat facts already recorded in `_findings.md`, `_index.md`, `_screens.md`, TC frontmatter, or per-system result folders. Do not rely on conversation memory either: disk artifacts are the handoff contract.

**The phases are mostly linear, with ONE expected loop.** A `seeded` data requirement (Phase 4) points at a spec that only exists after Phase 6, so it cannot be resolved on the first Phase 5 pass — Phase 5 marks it `deferred-until-phase-6`, Phase 6 writes the seeding spec, then Phase 5 runs a SECOND time to resolve just the deferred seeded keys before Phase 7. So the order for programs with seeded preconditions is **4 → 5 → 6 → 5 → 7**. This is expected, not rework; each phase's handoff names any deferred seeded key so the next chat knows a second prepare pass is owed.

**Tools can be hidden.** The editor may not surface every SAP Testing tool until it is searched for, and smaller models often fail to find them and improvise instead. At the start of any phase, if a tool that phase needs (always `get_test_folder`; also `playwright_test` for Phase 7, `build_test_index`/`split_test_cases` for Phase 3–4, etc.) is not available, SEARCH your available tools for it by name before proceeding. Never substitute a terminal command or a fabricated result for a tool you couldn't find — say which tool is missing.

## Universal rules

1. **ALWAYS call `get_test_folder` before any other SAP Testing action.** Treat its returned absolute path as `<TEST_FOLDER>` for the whole chat. Never infer it from the workspace, current directory, a prior chat, or a path mentioned in an old artifact. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If it is not open in the workspace, ask the user to add it before using normal file tools.
2. **Then establish the target system.** Call `get_connected_systems` and pick the target `connectionId`. If ambiguous, ASK. The connectionId determines the WebGUI URL, ABAP tool calls, and `test-results/<connectionId>/`.
3. **Rediscover context from disk in every chat.** Confirm the program and TC-ID from the user's request and artifacts under `<TEST_FOLDER>/tests/`. If the request is ambiguous and multiple candidates exist, ask; never silently pick one or depend on prior-chat memory.
4. **Every phase enforces its input gate before work.** Missing or inconsistent upstream artifacts are blockers. Stop the current workflow and follow `analyze-and-plan` for test-plan problems, `prepare-data` for data problems, `build-scripts` for spec problems, or `run-scripts` for execution problems. Never create plausible replacements from memory.
5. **No login logic in a spec, ever.** `playwright_test` signs the browser in itself, before any spec runs, using a SAP reentrance ticket minted from the ABAP FS connection — so a spec never needs to. Never write credentials, a logon step, or an auth workaround into a `.spec.ts`, `.md`, or `.data.md`. If a run still lands on a logon screen, that is a real failure to report (see `run-scripts`), not something to work around.
6. **Never bypass the runtime.** All specs use `SapSession`/`SapArtifacts` from `@sap-testing/runtime`. A missing capability is a real limitation — see `helpers-reference` for what to do (you cannot add a helper method yourself).
7. **No CSS-class selectors, no ref numbers, no positional guessing.** Only role + accessible name, scoped to a container — enforced inside the runtime; keep it in mind for any `sap.raw()` escape-hatch code.
8. **English only.** SAP language must be `en` in every configured system URL.
9. **Test case, data spec, screens map, and spec are 1:1.** For every TC-ID: `test-cases/TC-001.md` ↔ `test-cases/TC-001.data.md` (if data needed) ↔ `test-scripts/TC-001.spec.ts`. The screen map is shared per program: `test-cases/_screens.md`.
10. **Data resolution is a separate phase.** Specs never hardcode material numbers, plants, or any transactional data; data is resolved per system, not baked in.
11. **Don't invent SAP behavior.** Confirm against the source / ABAP tools before generating. Read-only clicks during exploration are fine; destructive actions (post, submit, delete, send, approve, release, reverse, reprocess, and any Execute in an update/live/production mode of a write-capable report) MUST be user-approved first. If a selection screen has a Test/Simulate vs Update radio, exploration MUST select the test/simulate side before Execute — see the `explore-ui` Step 5 destructive-mode gate.
12. **Never hand-edit `tsconfig.json`** in the test folder — SAP Testing manages it automatically and will overwrite your changes.
13. **Frontmatter lives at the very top of the file, always.** Any artifact that carries YAML frontmatter (`TC-XXX.md`, `TC-XXX.data.md`, `_screens.md`, `_flow.md`, `_units.md`) must have it as a single `---`-delimited block that is the FIRST thing in the file — never wrapped in a ` ```yaml `/` ```markdown ` code fence, never under a heading, never as prose. The tools parse ONLY a leading `---` block; misplaced frontmatter is silently ignored, which for a `.data.md` means `resolveTestData` reads zero keys and every `data.<key>` resolves to `undefined`.
14. **Load a phase's companion skills at the START, before committing to an approach.** Each phase names the skills it depends on. Load them up front — not after you're already stuck — so you know your options and escape hatches BEFORE you pick a method. Committing to a wrong approach and only discovering the right tool/skill afterwards is how a whole phase gets redone.
15. **When blocked, ASK — never shortcut.** A blocker (a control you can't drive, a screen you can't reach, data you don't have, a tool that seems to fail or time out, genuine ambiguity) is a signal to STOP and either ask the user or use the escape hatch the relevant skill documents. It is NEVER license to take a shortcut that violates a skill rule — deriving `_screens.md` from source, guessing a locator, fabricating data, or skipping a gate/reviewer. A wrong-but-fast artifact is worse than a paused one: it looks done and ships an untested path. Also verify a suspected failure before reacting — a SAP round-trip/splash can look like a hang; re-confirm the tool actually failed before concluding it did.
16. **ABAP FS is the ONLY data channel — no SE16N-via-browser fallback.** All SAP data reads (source, tables, SQL) go through the ABAP FS ADT tools (`get_abap_object_lines`, `search_abap_objects`, `execute_data_query`, `abap_download`, …). SE16N or any other browser-based table read is NOT an allowed fallback — it invents a value the framework can't cache and hides connectivity problems.
17. **ABAP FS HTTP 401/403/5xx = connection problem, not a permanent restriction.** When any ABAP FS tool returns 401, 403, or 5xx, ABAP FS almost always can't reach the target SAP system — usually because the SAP session expired. Tell the user, briefly: "ABAP FS can't reach `<connectionId>` (HTTP 401/403). Please check the ABAP FS connection and, if needed, reload VS Code to re-establish it — then retry." Do NOT switch to SE16N-via-browser, do NOT fabricate values, do NOT retry with a different auth trick. A WebGUI page showing a logon screen is a separate, browser-side problem — during a `playwright_test` run it means auto-login failed (see `run-scripts`); during live exploration, ask the user to log in in that browser window. Neither means ABAP FS is disconnected.
18. **`get_abap_object_lines` with `objectType: "TABL"` may return an empty body** (2–4 lines, no fields) when the table has no DDL source form on this system — common for Z-tables delivered by transport to non-dev tiers. The tool is working; the source just isn't there. Fall back to a zero-row `SELECT * FROM <TABLE> WHERE <any-key> = '<impossible-value>'` via `execute_data_query` — the response includes full column metadata (name + ABAP type) even when 0 rows come back. Never guess field names. Applies to `analyze-and-plan`, `define-data`, `prepare-data`, and any phase that inspects a Z-table's structure.
