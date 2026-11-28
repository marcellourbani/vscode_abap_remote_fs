---
name: anst-guide
description: >
  Guides the user through running transaction ANST (Automated Note Search & Customer Code
  Detection Tool) to capture a runtime enhancement trace for any SAP transaction or program,
  and exporting the results to xlsx. Use when the user wants to find all enhancements for a
  tcode and needs to collect the xlsx first. Once the user has the xlsx, hand off to the
  anst-enhancement-analyser agent.
  Triggered by: "find all enhancements for <tcode>", "what user exits run in <tcode>",
  "ANST", "runtime enhancement discovery".
---

# ANST Guide — Collect the Enhancement Trace

Use the full testing framework by default, but ANST is a runtime-discovery method, not a prerequisite for an explicit smoke or focused logic check; skip tracing and formal enhancement artifacts when outside that scope. A trace covers only exercised paths, and neither a user scope override nor an analyser result waives safe execution, authorization, truthful reporting, or technical limitations.

For bounded support work, `sap-task-helper` can help; pass `userIntent` (outcome, scope, and overrides), explicit inputs, allowed writes, and an output contract.

## Workflow

Walk the user through capturing a runtime enhancement trace using SAP transaction **ANST**.

**Why ANST?** It provides runtime evidence of customer code reached on the traced flows, including nested paths that static analysis may miss. It is useful for large standard transactions (ME21N, VA01, MIGO, etc.), but does not prove coverage of unexercised variants or all possible enhancements.

> If the user already has an `.xlsx` exported from the ANST Customer Code screen, do not repeat the collection workflow; delegate analysis of that file directly to the **anst-enhancement-analyser** agent, passing `userIntent` and the file/system context.

---

## Step 0 — Standalone bootstrap

1. For collection/analysis in the testing project, call `abapfs_get_test_folder` first and use its returned absolute path as `<TEST_FOLDER>`; if unset, ask the user to run "ABAP FS: Enable SAP UI Testing Features". A general question about using ANST needs no testing-folder setup.
2. Confirm the target transaction/program from the current request. If omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_index.md`; ask if more than one candidate exists.
3. Confirm the exact `connectionId` where the trace will be recorded. Reuse an explicitly established system; otherwise ask the user which system, listing connected systems if needed. Do not silently choose one.
4. Keep the exported trace under `<TEST_FOLDER>/tests/<PROGRAM>/sources/anst/` with a descriptive timestamped `.xlsx` filename so a new `analyze-and-plan` chat can find it from disk.

## Step 1 — Open ANST

Tell the user to go to transaction `ANST` (Automated Note Search & Customer Code Detection Tool).

## Step 2 — Enter the target

Tell the user to:

- Select the **Transaction** radio button (or **Program** if targeting a report).
- Enter the transaction code or program name in the field that appears.
- Optionally add a **Description** to identify the trace later.

## Step 3 — Execute

Click **Execute**. The target transaction opens inside ANST's trace session.

## Step 4 — Perform the transaction

Tell the user to run through the transaction's flows. Tips:

- Trace the agreed flows using safe test data; stop before Save, Post, Release, or other data-changing actions unless explicitly authorized for that target and data. ANST does not simulate or undo business changes.
- Include variants (document types, account assignments, etc.) only when relevant to the requested scope and safe to execute; each may activate different enhancements.
- Record incomplete paths and stopping points as coverage limits; never demand a save merely to make a trace look complete.

## Step 5 — Back to ANST

Press **Back** (F3). ANST shows a tree of Application Components touched during the session.

## Step 6 — Select All

Click the **Select All** button to select every application component in the tree.

## Step 7 — Customer Code

Click the **Customer Code** button. ANST analyses the trace and shows the Customer Code results screen.

## Step 8 — Download to xlsx

Tell the user to:

- Use the export/download function on the Customer Code screen.
- **Save as xlsx only** (not csv, not txt).
- Save under `<TEST_FOLDER>/tests/<PROGRAM>/sources/anst/` and share the full path (for example, `C:\sap-tests\tests\ME21N\sources\anst\me21n_enhancements_20260723_180000.xlsx`).

---

Once you have the path, pass it to the **anst-enhancement-analyser** agent with `userIntent` (requested outcome, scope, and overrides), `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, and the traced flows/limits. Repeat those details and the absolute xlsx path in the handoff; do not claim untraced paths or reviews were completed, or create unrelated test-case artifacts for an enhancement-only request.
