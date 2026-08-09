---
name: explore-ui
description: Standalone Phase 2 of SAP UI testing. Opens the target transaction in a real browser (SAP WebGUI) and explores it live to produce tests/<PROGRAM>/test-cases/_screens.md — the authoritative map of every on-screen control, its accessible name/label as Playwright will see it, and its initial state. This is about how the UI renders in the browser, NOT the ABAP selection-screen source. Use when the user asks to explore the UI, map screens, or produce _screens.md for an ABAP object.
---

# Explore UI — Phase 2 (of 7)

Phase order: analyze-and-plan (1) → **explore-ui (2)** → design-cases (3) → define-data (4) → prepare-data (5) → build-scripts (6) → run-scripts (7).

This phase produces ONE artifact: `tests/<PROGRAM>/test-cases/_screens.md`, and reconciles what you discover back into `_findings.md`. It does not write test cases or data specs.

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## What `_screens.md` IS — read this before anything else

`_screens.md` is a map of the **live web UI as it renders in the browser** (SAP WebGUI, inside its ITS iframe). Phase 6 (`build-scripts`) turns each control it lists into a Playwright call — `sap.setField("File path", ...)`, `sap.clickButton("Execute")`, `sap.selectRadio("Report")` — using the EXACT accessible name / on-screen label you record here.

`_screens.md` is NOT a description of the ABAP selection screen from the source code. It contains no ABAP variable names (`p_file`, `r_upl`, `s_site`), no MODIF IDs, no `LOOP AT SCREEN`/`MODIFY SCREEN` snippets, no message-class listings, no method names or line numbers, and no screens you did not actually open and observe. If a line couldn't be used by Phase 6 to write a locator, it does not belong here.

You **must** produce this file by opening the browser and looking. A `_screens.md` derived from ABAP source instead of live observation is the specific failure this phase exists to prevent — it is worthless to Phase 6 because source-derived labels are not the browser's accessible names.

## How to actually drive the WebGUI — read this, it is where runs fail

You explore with your interactive browser tool's **accessibility snapshot**, NOT with Playwright code. This is the single most common time-sink: agents try Playwright selectors, everything times out, and they give up and derive from source. Don't.

- **Snapshot with the accessibility-tree action, and act by `ref`.** In VS Code Copilot these are: `read_page` (returns the accessibility tree WITH element `ref` values — your PRIMARY tool), `click_element` with `ref=<ref>` (click a radio/button/cell), and `type_in_page` with `ref=<ref>` (enter text). Use your environment's equivalent snapshot/click-by-ref/type-by-ref actions if the names differ. `read_page` sees INSIDE the SAP ITS iframe automatically — you do NOT target the iframe yourself.
- **`read_page` before you act and after every server round-trip.** Clicking a radio or Execute triggers SAP's PBO round-trip and re-renders the screen; re-snapshot to get the new controls and fresh `ref`s (old refs go stale).
- **`screenshot_page` is for visual confirmation ONLY** — it has no `ref`s, so you cannot act from it, and it does not give you accessible names. Never write `_screens.md` from a screenshot alone.
- **Do NOT use Playwright during exploration.** `page.locator(...)`, `frameLocator(...)`, `getByRole(...)`, `page.evaluate(...)`, `text=...` do not reliably reach the ITS iframe from page level and will time out. Playwright runs only inside real specs (Phase 6/7 via `playwright_test`), never during exploration. If you catch yourself writing `page.locator`, stop and use `read_page` + `ref`.
- **Generic roles are normal — record the accessible NAME.** ITS renders many controls (radios, F4 triggers, ALV cells) with role `generic` rather than `radio`/`button`. That is fine and expected: capture the accessible name (e.g. `"Upload"`, `"Report"`), because the runtime helpers (`selectRadio`, `clickButton`) locate by name and handle the missing ARIA role. Do not get stuck hunting for a `radio` role ITS never emits.
- **If it seems stuck, VERIFY before reacting — and never shortcut.** SAP's PBO round-trip and the ITS "Please wait…" splash can look like a hang or a timeout when the page actually loaded fine. If an action seems to time out, re-run `read_page` and check whether the screen advanced (it usually did) before concluding anything failed. A perceived timeout is NEVER a reason to give up and write `_screens.md` from source. **Know your escape hatches from the start, so you reach for them instead of shortcutting:** if a control genuinely won't drive, or the browser is truly unreachable after a retry, STOP and either (a) ask the user for help/data, or (b) ask the user to record the flow via the `sap-webgui-recording` skill ("ABAP FS: Record SAP WebGUI Flow"). Asking is always allowed and always better than a source-derived guess — you were told this before you started precisely so you don't discover it only after cutting a corner.

## Non-negotiable execution gate

The `playwright_test` tool (Phase 7) and `build-scripts` (Phase 6) reject cases whose controls are missing from `_screens.md` or were never observed live. Do not guess locators or fabricate a screen you didn't open.

## Why

A wrong or invented label here becomes a broken locator in every spec that touches that control — the automation reports "element not found" or, worse, silently clicks the wrong thing and passes. The whole test suite's reliability rests on `_screens.md` matching what the browser actually renders.

## Tool availability (read this if a tool seems missing)

**Naming:** when these docs say *call* `X`, `X` is a **tool** (you invoke it and get a result); *delegate to / invoke* `X` is an **agent** (a subagent you launch); *load / follow* `X` is a **skill** (a procedure you read). A name without a verb: see the overview's "Skills, tools, and agents" list.

The editor may hide tools until searched for. Before Step 0, ensure `get_test_folder`, `get_connected_systems`, and `get_sap_webgui_url` are available; if any is missing, search your available tools for it by name. You also need your built-in browser tool for live exploration (NOT Playwright, NOT `playwright_test` — those run actual tests; exploration is manual browsing). If a required tool cannot be found, tell the user which one is missing.

## Step 0 — Standalone bootstrap and Phase 1 input gate (mandatory)

> **Say before acting:** "Starting Step 0: standalone bootstrap and Phase 1 input gate."

1. Call `get_test_folder` **before reading any artifact**. Treat the result as `<TEST_FOLDER>`; never infer it.
2. If unset, STOP and ask the user to run "ABAP FS: Enable SAP UI Testing Features". If not open in the workspace, STOP and ask them to add it.
3. Resolve `<PROGRAM>` from the request. If omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_findings.md`; auto-select only when exactly one candidate matches, otherwise ask.
4. **Enforce the Phase 1 input gate:** `tests/<PROGRAM>/test-cases/_findings.md` must exist (with `_flow.md` and `_units.md` beside it). If `_findings.md` is missing, STOP and follow `analyze-and-plan` first — you cannot cross-check the live UI against a decision surface you don't have. Read `_findings.md` now (selection-screen inputs, radios/checkboxes, predicted output) and skim `_flow.md` (the end-to-end scenarios tell you which screens the flow actually produces and how to reach each one) so your exploration covers every screen the object can render, not just the initial one.
5. Call `get_connected_systems` and confirm the target `connectionId`; ask only if ambiguous.
6. Use the SAME connection Phase 1 analysed unless the user says otherwise.

> **Say before continuing:** "Step 0 completed. Evidence: test folder, program, `_findings.md`, and connection confirmed. Next: Step 1 — decide exploration approach."

## Step 1 — Decide whether exploration can remain autonomous

> **Say before acting:** "Starting Step 1: determine whether the complete UI path can be explored autonomously."

**Load the `sap-webgui` skill before any browser action.** Follow it for iframe behaviour, labels versus generated IDs, accessible names, dynamic controls, dialogs, ALV, uploads, themes, and locator pitfalls.

Attempt safe exploration with the integrated browser first. Do not ask the user to record ordinary screens merely to offload exploration. Remain autonomous when you can open, snapshot, and safely navigate the screen; read labels, roles, titles, and state; and reproduce the path without business judgement.

Load the `sap-webgui-recording` skill and request the smallest focused recording only for a concrete blocker: authenticated WebGUI/iframe unreachable; a complex control exposing no semantic information; personalization/business knowledge determines the interaction; a destructive action needs user approval; or snapshots can't establish the required sequence. Once the user provides `<TEST_FOLDER>/recordings/<name>.recording.ts`, read it as reference evidence, load and interpret it via the `sap-webgui` skill, and persist the verified observations into `_screens.md`. Never execute or copy a recording as a spec.

> **Say before continuing:** "Step 1 completed. Evidence: exploration will proceed autonomously, or a focused recording was obtained for a stated blocker. Next: Step 2 — open the target."

## Step 2 — Open the SAP URL

> **Say before acting:** "Starting Step 2: open the target transaction in SAP WebGUI."

- Call the `get_sap_webgui_url` tool with the target `connectionId` **and** the `transaction` you want. Follow the `sap-webgui` skill for theme and iframe rules.
- Open the URL it returns **exactly as given** with your built-in browser tool — do not append `~transaction` or anything else. When auto-login applies, that URL is a single-use sign-in link and any modification breaks it. For a program with no dedicated tcode, pass `transaction: "SE38"` and run the program from there.
- Snapshot the selection screen. This is exploration only — no Playwright, no `sap.*` runtime calls.
- Once that first page is open the browser session is authenticated, so navigate to further transactions by opening the plain WebGUI URL with `&~transaction=<TCODE>`; do not call the tool again for each one.
- **If the page still shows a SAP logon screen**, auto-login is off for this connection (`webGuiAutoLogin: false`) or the system issued no ticket. Do NOT type credentials yourself and never put them in an artifact — ask the user to log in in that browser window and tell you when they're done, then re-`read_page` and continue. Same if the logon screen reappears mid-exploration.

> **Say before continuing:** "Step 2 completed. Evidence: the fresh initial selection screen is open and captured. Next: Step 3 — map the selection screen."

## Step 3 — Map the selection screen

> **Say before acting:** "Starting Step 3: map every visible selection-screen control."

Compare the snapshot to the predicted inputs in `_findings.md`:

- Confirm every predicted field by the label you actually see in the browser.
- **Note any field/button/checkbox NOT in the prediction** — from missed includes, PBO logic, user-exits.
- Record actual group headings as they render.
- For each control, capture the **accessible name** Playwright will match (often, but not always, the visible label — record both when they differ, per `sap-webgui`).
- **Controls with NO accessible name — capture the technical name from the live DOM, do NOT invent a positional locator.** Some inputs (a header field, certain ALV editors) render with no usable accessible name. For each, read the input's `lsdata` attribute in the snapshot: its `SID` string ends with the DDIC field name (`.../ctxt<TABLE>-<FIELD>`), and that trailing `-<FIELD>` is the stable technical name Playwright uses via `{ technicalName: "<FIELD>" }` (see `sap-webgui`). Record it in `_screens.md` as `technicalName: <FIELD>` beside the control. The browser is the direct source — read it here, not from ADT later. A control that has NEITHER an accessible name NOR a discoverable technical name is a genuine blocker: STOP and ask the user or request a recording — never fall back to an XPath/DOM-structure or positional locator (banned everywhere, and it breaks on every re-render).

> **Say before continuing:** "Step 3 completed. Evidence: predicted and newly discovered selection controls are mapped with browser labels and groups. Next: Step 4 — record initial state."

## Step 4 — Record the INITIAL STATE of every control (mandatory)

> **Say before acting:** "Starting Step 4: record the untouched initial state of every control."

For every control on the selection screen AND any dialog you open, record its state BEFORE you touch it:

- textbox "Article" — initial: empty
- checkbox "Include archived" — initial: checked
- radio "Upload" — initial: SELECTED

How to determine `initial:`:

1. Open the screen fresh (`~transaction=<TCODE>`, not from a running session) so memory-ID values don't leak.
2. Read the snapshot BEFORE typing anything.
3. Cross-check against `_findings.md`'s recorded DEFAULT / MEMORY ID / radio-group defaults. If source and screen disagree, **screen wins** — note the discrepancy (usually SET/GET PARAMETER in INITIALIZATION).

**Hidden / conditional fields:** if `_findings.md` shows dynamic show/hide (`LOOP AT SCREEN ... MODIFY SCREEN`, `INVISIBLE` blocks), some controls appear only under certain conditions. Toggle the trigger (e.g. select the other radio) and record them:

- textbox "Site (location)" — initial: HIDDEN (shown when radio "Report" selected)
- textbox "File path" — initial: visible-empty (hidden when radio "Report" selected)

> **Say before continuing:** "Step 4 completed. Evidence: every visible, hidden, and conditional control has a verified initial state. Next: Step 5 — execute safely."

## Step 5 — Execute with sensible defaults and map the output

> **Say before acting:** "Starting Step 5: execute the target safely and map the output."

**Destructive-mode gate — read before touching Execute.** Every ABAP report can be destructive. Before you click Execute:

1. Read `_findings.md`'s branches and background artifacts to see whether this program writes data (`INSERT`/`UPDATE`/`MODIFY`/`DELETE`/`SUBMIT`, IDoc/job creation, external calls).
2. Check for a Test/Simulate/Display versus Update/Live/Post/Commit radio or checkbox on the selection screen. Named variations include "Test Run", "Simulation", "Display Only", "Update Mode", "Update Run", "Production Run", "Commit", "Post". This pattern is present in most write-capable reports and is the single most likely place exploration destroys downstream test data.
3. If any test/simulate mode exists, **you MUST select it before Execute** — that is the only "safe default" here. A default that ships as Update Mode does NOT make Update Mode safe to click.
4. If NO test mode exists AND `_findings.md` shows the program writes/deletes data, STOP: do not click Execute. Ask the user for explicit approval AND ask whether the target `connectionId` is safe to write in. Record any decision in `## Notes for automation`.
5. Selection-screen variants (`SUBMIT ... USING SELECTION-SET`) may pre-set the mode to Update — inspect the current state via `read_page` before Execute, don't assume the default is what the screen paints.


Fill only what's required (use realistic values discovered via ABAP SQL if needed), click Execute, snapshot the output. Then map it:

- ALV grid columns: dump the column headers exactly as they render.
- **Toolbar buttons** — enumerate every button, tooltip (`title`/`aria-label`), menu entry. GUI-status buttons live here — the KEY discovery step.
- **Overflow toolbar (`>>`) — expand it before enumerating.** When a toolbar is too narrow, ITS hides the extra buttons (often including Execute/F8) behind a `>>` "more" chevron, and those hidden buttons are ABSENT from the accessibility snapshot until you expand it. Click `>>`, re-`read_page`, and record the revealed buttons, tagging each `— toolbar (overflow)`. You do NOT need to reproduce the `>>` click in a spec — the runtime's `clickButton`/`execute` locate overflowed buttons by `title` even when visually collapsed — but you MUST record the buttons so Phase 6 knows they exist. (If you skip the expand, you'll wrongly conclude a button like Execute is missing.)
- Any "Simulate", "Post", "Refresh", "Export", "Send", "Delete", "Change" = a candidate case; record the button's accessible name.
- Bottom-of-screen buttons and menu-bar entries.
- For editable ALV grids and header tab strips, follow `sap-webgui` to record column `title`s and exact tab labels.

**First, respect `_findings.md`'s "Frontend integration & WebGUI compatibility" verdict.** A path flagged **SAP-GUI-only** (e.g. an OLE Excel upload via `ALSM_EXCEL_TO_INTERNAL_TABLE`/`KCD_EXCEL_OLE_TO_INT_CONVERT`) genuinely CANNOT run in a browser — do NOT try to observe or automate it here; that's not a screen you failed to reach, it's a path this toolchain can't drive. Record it in `_screens.md` as NOT observed with the reason "SAP-GUI-only (OLE), not automatable via WebGUI" and move on (its cases are already `runnable-elsewhere`). Likewise a native-OS-dialog path is `manual`. If `_findings.md` has no compatibility verdict for a path the object clearly has, that's a Phase 1 gap — STOP and follow `analyze-and-plan` to add it rather than guessing.

**Explore the CORE flow — for every path that IS WebGUI-runnable.** `_flow.md` tells you the object's main job; explore THAT, even when it's harder than a secondary read-only path — don't fully map an easy read-only output and hand-wave a runnable core path. Observe the ERROR/edge screens you can trigger without special data: Execute with no input (mandatory-field/status-bar behaviour), Execute with obviously-invalid input (validation/error rendering). Each error screen has controls Phase 6 needs.

**When a WebGUI-runnable path needs input you don't have** (e.g. a browser upload of a real file, or valid data to make output appear): don't skip it and don't guess it — **offer the user two options: (a) provide a minimal sample file/dataset, or (b) record the flow themselves via the `sap-webgui-recording` skill** (the "ABAP FS: Record SAP WebGUI Flow" command), which you then consume. Only if neither is available do you mark that screen NOT observed per the Step 7 honesty rule (no source-guessed control lists). (This does NOT apply to SAP-GUI-only OLE paths above — a sample file can't make OLE run in a browser.)

> **Say before continuing:** "Step 5 completed. Evidence: the core flow's output (not just a secondary read-only path), error/log screens, toolbar, menus, and discovered controls are enumerated with accessible names. Next: Step 6 — probe safe controls and dialogs."

## Step 6 — Probe non-destructive controls, dialogs, and popups

> **Say before acting:** "Starting Step 6: probe safe controls and explore dialogs to depth one."

- **Read-only / safe** (Export, Refresh, Change layout, Print preview, Details, Help): click, snapshot, record the dialog's controls, back out.
- **Destructive** (Post, Submit, Delete, Send, Save, Approve, Release, Confirm, Cancel Document, Reverse, Reset, Reprocess, Retry, Update, Execute in Update/Live mode): DO NOT CLICK without user approval. Note it, flag "destructive — needs user decision". If in doubt about a button, treat it as destructive; there is no cost to asking, and there is a real cost to guessing wrong.
- Execute itself becomes destructive whenever the selection screen is in an update/live/post mode (see Step 5 destructive-mode gate) — the same approval rule applies.
- Explore each reachable dialog to depth 1; snapshot its buttons/fields/gridcells. Close via the dialog's Cancel button — NEVER keyboard Escape (it exits the whole transaction).
- **Dialog-level Cancel vs screen-level Back/Exit/Cancel — they are NOT the same, and confusing them is a known trap.** A dialog's own `Cancel` button just closes that dialog and returns to the screen underneath — safe. But the main-window toolbar `Back` (F3), `Exit` (F15), and `Cancel` (F12) mean "leave THIS screen/transaction," and where they land depends entirely on the transaction's PF-STATUS — sometimes the previous screen, sometimes SAP Easy Access, sometimes a save-prompt. After any screen-level Back/Exit/Cancel you MUST re-`read_page` to see where you actually landed before doing anything else — never assume. Record, per screen, what each of Back/Exit/Cancel does (the observed landing screen), because Phase 6 teardown and inter-case navigation depend on it. If one lands somewhere unexpected, recover by opening the plain WebGUI URL with `&~transaction=<TCODE>` rather than clicking around.
- Record any unexpected popup (session warnings, license notices) by title; if truly safe-to-dismiss it may belong in `KNOWN_INTERRUPTERS` (see `helpers-reference`).

> **Say before continuing:** "Step 6 completed. Evidence: safe controls probed, dialogs mapped, destructive controls listed unactivated, popups recorded. Next: Step 7 — write _screens.md."

## Step 7 — Write `_screens.md`

> **Say before acting:** "Starting Step 7: write the authoritative screens map."

**Gate — do not write a single line until you have real snapshots.** Every control, label, ALV column, and initial state you record MUST come from a `read_page` accessibility snapshot you captured in THIS browser session. Before writing, confirm you actually opened and snapshotted each screen you're about to describe. If you have not opened the browser for a screen, you are about to derive it from source — STOP and go back to Step 2/5 and observe it. This is the concrete check that prevents the source-derived `_screens.md` this phase exists to stop.

**Frontmatter is mandatory and must be the very first bytes of the file** — a single `---`-delimited YAML block with `target`, `targetType`, `exploredOn`, `exploredSystem`, before any heading, never inside a code fence (universal rule 13). Downstream phases and `build_test_index` read it; a `_screens.md` without parseable top-of-file frontmatter is rejected. Know this before you start writing, not after the reviewer flags it.

**Unobserved screens: honest blank, never a source guess.** For a screen you genuinely could not reach (needs a valid upload file you don't have, or a native OS dialog — see below), write its `## Screen: <name>` heading with **NOT observed**, the concrete reason, and what's needed to observe it — and NOTHING ELSE. Do NOT fill in a guessed control/column list "expected to match" another screen or inferred from `cl_salv_table`/the source: a plausible-looking guess is worse than an honest blank because Phase 6 will trust it and write broken specs. Explicitly flag each unobserved screen in the handoff as needing a live pass before its cases can be scripted.

**Native OS dialogs are un-snapshottable.** `cl_gui_frontend_services=>file_save_dialog` / `file_open_dialog` / `F4_FILENAME` may open a native Windows dialog that lives OUTSIDE the ITS iframe — `read_page`/`screenshot_page` cannot see it. Record it as NOT observed with that reason; the case that depends on it is likely `manual` (note this so Phase 3 triages it correctly). See `sap-webgui` for how Phase 6 handles file fields versus OS dialogs.

Write ONE file per PROGRAM (shared across all its cases). Walk every UI path the report can produce (all initial screens, every mode/radio branch, every dialog, every popup, every ALV output) and list every control you saw, once, with its accessible name and initial state.

```markdown
---
target: Z_MY_REPORT
targetType: report
exploredOn: 2026-07-16
exploredSystem: DEV
---

# Screens for Z_MY_REPORT

## Screen: Selection screen (initial)

Accessible via: SE38 → program → F8 (or ~transaction=<TCODE>)
Recording evidence: recordings/<name>.recording.ts (only when user-assisted evidence was needed)

Groups & controls (with initial state):

- group "Selection Block 1"
  - textbox "Field Label 1" — initial: empty
  - textbox "Field Label 2 (range)" + textbox "to" + button "Multiple Selection" — initial: both empty
  - checkbox "Some Flag" — initial: CHECKED
  - textbox "Language Key" — initial: `EN`
- group "Output Mode"
  - radio "ALV Output" — initial: SELECTED
  - radio "Excel Download" — initial: not selected
- toolbar
  - button "Execute" (F8)
  - button "Save as Variant..."

## Screen: ALV output (after Execute with valid input)

- toolbar
  - button "Refresh"
  - button "Export" → opens dialog "Save List in File"
  - button "Simulate" — NEW: not in ABAP source, added by GUI status STATUS_100
  - button "Change Layout"
- grid columns: Column A, Column B, Column C, ...

## Dialog: Save List in File

Controls (with initial state):

- radio "Unconverted" — initial: SELECTED
- radio "Spreadsheet" — initial: not selected
- button "Continue"
- button "Cancel"
```

Rules:

- EVERY observed control included ONCE, with `initial:` (empty, literal value, CHECKED/UNCHECKED, SELECTED/not) — never omit initial state.
- Use the EXACT on-screen label / accessible name Playwright will see. ABAP variable names, MODIF IDs, and source snippets do NOT belong here.
- **Name each screen by its observable on-screen TITLE — never by a dynpro screen number or the program/report/tcode name.** `## Screen: <title as it renders>` (e.g. `## Screen: Item overview (after Execute)`), NOT `## Screen 0200` or `## Screen: SAPMZDUMMY 0100`. Dynpro numbers and program names come from source, mean nothing to Playwright, and are exactly what the reviewer FAILs. If you need to trace a screen back to its dynpro/source, keep that mapping in `_findings.md`, not here.
- For a nameless control, record `technicalName: <FIELD>` (the DDIC field from its `lsdata` SID, per Step 3) — never a positional/XPath locator.
- Mark exploration-discovered controls with `— NEW: not in source`; mark overflow-toolbar buttons `— toolbar (overflow)`.
- Mark each dialog with its trigger (which button/action opens it).
- Apply the full `_screens.md` control-recording rules from `sap-webgui`, including visible-label-versus-accessible-name and file-textbox-versus-native-file-input.
- Never derive `_screens.md` from ABAP source alone.

> **Say before continuing:** "Step 7 completed. Evidence: `_screens.md` contains every observed control, accessible name, initial state, and trigger path. Next: Step 8 — reconcile into _findings.md."

## Step 8 — Reconcile discoveries into `_findings.md` and recompute the target minimum

> **Say before acting:** "Starting Step 8: reconcile runtime discoveries into _findings.md."

- Add every runtime-discovered control worth testing (a "Simulate"/"Post"/export button not in the source) to `_findings.md`'s candidate list as a `discovered-control` case.
- **Recompute the target minimum**: preliminary target (from Phase 1) + 1 per discovered runtime control. Write the new number into `_findings.md`'s case-count derivation.
- If exploration surfaced a screen the code implied but you could NOT observe, note it as a blocker in `## Notes for automation` (design-cases will need it resolved).

> **Say before continuing:** "Step 8 completed. Evidence: discovered controls and the final target minimum are recorded in `_findings.md`. Next: Step 9 — hand off."

## Step 9 — Review, then write the next-chat handoff to Phase 3 (`design-cases`)

> **Say before acting:** "Starting Step 9: delegate to sap-screens-reviewer, fix every gap, then write the Phase 2 handoff."

### 9.1 Adversarial review of `_screens.md` (mandatory)

Delegate to the `sap-screens-reviewer` agent. Give it `<PROGRAM>` and confirm `_screens.md` exists (with `_findings.md`/`_flow.md` alongside). It statically checks that `_screens.md` describes the LIVE WEB-GUI rendering — accessible names/labels, initial states, dialogs, ALV — and is NOT an ABAP selection-screen/source description (no ABAP variable names, MODIF IDs, `LOOP AT SCREEN`/`MODIFY SCREEN` snippets, message classes, or method/line references), and that the screens the flow produces are actually covered.

Expect `PASS` or an itemised gap list. Fix EVERY gap — if it flags source-derived content, that usually means you didn't actually explore that screen in the browser: go back, open it, and record what you observe (do NOT rewrite from source). Re-review until PASS. (The reviewer checks content and provenance, not live-label accuracy — that's confirmed by the first headed run in Phase 7.) Do not hand off on a FAIL.

### 9.2 Write the handoff

Make on-disk state sufficient for a fresh `design-cases` chat:

- `_screens.md` exists and lists every observed control with accessible name + initial state.
- `_findings.md` includes discovered-control cases and the recomputed target minimum.
- Your final response names `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, the final target minimum, and any destructive controls that need a user decision.

**Your final message MUST tell the user the exact next step: "Next: Phase 3 — start a new chat, load the `design-cases` skill, and say: Design the test cases for `<PROGRAM>` using the findings and screens on disk."** Naming the skill matters — without it the next chat tends to skip loading `design-cases` and improvise.

> **Say after the handoff is complete:** "Step 9 completed. Evidence: `sap-screens-reviewer` returned PASS (web-GUI content only), and `_screens.md` plus reconciled findings were handed off. Phase 2 completed. Next phase: Phase 3 — in a new chat, load the `design-cases` skill and follow it."

## Anti-patterns

- ❌ Deriving `_screens.md` from ABAP source instead of opening the browser — the labels won't match the accessible names Playwright uses, and the file is worthless to Phase 6.
- ❌ Putting ABAP variable names, MODIF IDs, `MODIFY SCREEN` snippets, message-class listings, or method line numbers in `_screens.md`.
- ❌ Naming a screen by its dynpro number or program/tcode name (`## Screen 0200`, `## Screen: SAPMZDUMMY`) instead of its observable on-screen title.
- ❌ Recording a nameless control with an XPath/DOM-structure or positional locator instead of its `technicalName` from `lsdata` (or escalating it as a blocker).
- ❌ Listing a screen you did not actually open and observe.
- ❌ Omitting `initial:` on any control.
- ❌ Clicking a destructive button without user approval.
- ❌ Keyboard Escape to close dialogs (exits the transaction) — use the dialog's Cancel button.
- ❌ Writing test cases or `.data.md` files in this phase — those are Phases 3 and 4.
