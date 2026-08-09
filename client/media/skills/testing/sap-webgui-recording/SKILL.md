---
name: sap-webgui-recording
description: Guides an agent in deciding when SAP WebGUI exploration needs a focused user recording, coaching the user through Playwright recording in Edge, and consuming the resulting reference file safely. Use when autonomous browser exploration cannot inspect a complex SAP control or when the user asks how to record a WebGUI flow.
---

# SAP WebGUI Recording — User-Assisted Evidence

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## How to use this skill

Use this workflow to decide whether user-assisted recording is necessary, coach the user, and consume the resulting evidence in the active phase:

- follow `explore-ui` for exploration coverage and `_screens.md`;
- follow `sap-webgui` to assess locator stability and interpret generated code;
- follow `build-scripts` to translate evidence into `SapSession` specs;
- follow `run-scripts` to diagnose failures.

## Recordings are reference evidence

The command **ABAP FS: Record SAP WebGUI Flow** writes:

`<TEST_FOLDER>/recordings/<descriptive-name>.recording.ts`

A recording is not a test case or production spec:

- never run it through `playwright_test`;
- never copy it verbatim into `test-scripts/`;
- never treat generated IDs, iframe names, or positions as approved locators;
- persist verified observations into `_screens.md`;
- keep it until the translated spec passes its first headed run, then offer to remove it if it is no longer referenced.

## Decide who should explore

### Explore autonomously first

Use the integrated browser when you can safely:

- open and snapshot the screen;
- read labels, roles, titles, initial values, and visible state;
- navigate a non-destructive path;
- inspect dialogs, toolbars, and ordinary tables;
- reproduce the path without business judgement.

Do not ask the user to record merely to offload normal exploration.

### Ask for a focused recording

Escalate only when one or more apply:

- the integrated browser cannot reach or inspect the authenticated WebGUI frame;
- a complex control exposes no understandable labels or roles;
- the path depends on user-specific personalization or business knowledge;
- interaction sequencing cannot be inferred from snapshots, traces, or source;
- the interaction changes business data and the safe stopping point must be agreed with the user;
- run evidence is insufficient to explain a repeatable locator failure.

State the exact blocker and the smallest interaction that needs recording. Do not request an entire transaction when one grid edit or dialog path is enough.

## Coach the user

Give these instructions:

1. Run **ABAP FS: Record SAP WebGUI Flow**.
2. Pick the intended SAP system when the command asks — it prompts for the connection and signs the browser in for you.
3. Enter a descriptive name, for example `me21n-edit-po-item`.
4. Start from a fresh transaction in English.
5. Record one focused path with the fewest necessary actions.
6. Use safe test data; never type passwords, secrets, or production personal data.
7. Avoid exploratory clicks. Every click becomes generated code.
8. Before Save, Post, Release, Delete, Approve, or any other data-changing action, decide whether the recording actually needs to include that final action. If it does, use a safe test system and test data and understand that the recording will change SAP data. Otherwise stop immediately before it.
9. Close the Playwright recorder when the focused path is complete.
10. Share the generated recording path and describe the intended outcome, any ambiguous control, and whether personalization or a variant was active.

When requesting a data-changing flow, explicitly tell the user whether to stop before the final action or include it. Base that instruction on the evidence needed, the target system, and whether the supplied test data is safe to modify.

## Consume the recording

1. Read the recording and the current `_screens.md` together.
2. Load `sap-webgui` and classify every generated locator using its recording-interpretation rules.
3. Extract interaction order, visible labels, accessible names, titles, dialog transitions, server roundtrips, and rerenders.
4. Treat typed business values as examples, not constants.
5. Add verified evidence to `_screens.md`, including:
   - `Recording evidence: <relative-path>`;
   - screen/dialog and trigger path;
   - visible label and differing accessible name;
   - initial and resulting state;
   - duplicate-label or personalization caveats;
   - unresolved controls that still lack a stable semantic contract.
6. Resume the phase workflow already in progress. A recording does not bypass any phase gate.

If the recording contains only an unstable generated ID for a required control, it proves interaction intent but not a usable locator. Request narrower exploration or report a runtime gap; do not bless the ID.
