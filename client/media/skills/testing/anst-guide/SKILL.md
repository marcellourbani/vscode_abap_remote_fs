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

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Non-negotiable execution gate

When ANST analysis is required for the target, its trace, analyser result, and the resulting test cases are recorded prerequisites. The `playwright_test` tool verifies them and **will reject every affected case** if any requirement was skipped, deferred, left missing, stale, incomplete, or unverified. Creating a spec in a later phase cannot bypass this validation.

## Workflow

Walk the user through capturing a runtime enhancement trace using SAP transaction **ANST**.

**Why ANST?** It captures every enhancement point actually executed at runtime, regardless of nesting depth — the definitive method for large standard transactions (ME21N, VA01, MIGO, etc.) where static analysis under-reports.

> If the user already has an `.xlsx` exported from the ANST Customer Code screen, do not repeat the collection workflow; delegate analysis of that file directly to the **anst-enhancement-analyser** agent.

---

## Step 0 — Standalone bootstrap

1. Call `get_test_folder` first. Treat the returned absolute path as `<TEST_FOLDER>`; never infer it from the workspace or a prior chat. If unset, ask the user to run "ABAP FS: Enable SAP UI Testing Features".
2. Confirm the target transaction/program from the current request. If omitted, inspect `<TEST_FOLDER>/tests/*/test-cases/_index.md`; ask if more than one candidate exists.
3. Call `get_connected_systems` and confirm the exact `connectionId` where the trace will be recorded. Ask only if ambiguous.
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

- **Finish at least one complete flow** (e.g. for ME21N: fill all fields and save a PO). The more flows completed, the more enhancements captured.
- If the transaction has variants (different document types, account assignments, etc.), trigger a few — each may activate different enhancements.
- Finishing is preferred but not mandatory.

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

Once you have the path, pass it to the **anst-enhancement-analyser** agent. In the final handoff, repeat `<TEST_FOLDER>`, `<PROGRAM>`, `connectionId`, the absolute xlsx path, and the traced flows so a fresh `analyze-and-plan` chat does not need this conversation.
