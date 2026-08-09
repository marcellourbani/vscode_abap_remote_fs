# Finding Enhancements with ANST

When you test a **standard SAP transaction** — ME21N, VA01, MIGO, MM43 — the code that actually breaks in your system is usually not SAP's. It's your enhancements: BAdI implementations, enhancement points, classic user exits. Reading the call chain statically under-reports them badly, because enhancements are called indirectly and nest several levels deep.

Transaction **ANST** (Automated Note Search and Customer Code Detection Tool) solves this by tracing what actually executes at runtime. Copilot will suggest it during analysis whenever your target is a standard transaction.

This only applies to standard SAP objects. For a custom Z or Y program, Copilot uses static enhancement research instead and no trace is needed.

## Capturing the trace

You do this part in SAP; Copilot walks you through it and consumes the result.

1. Open transaction **ANST**.
2. Select **Transaction** (or **Program** for a report) and enter your target. A description helps you find the trace later.
3. Click **Execute**. Your transaction opens inside the trace session.
4. **Run through the transaction properly.** Complete at least one full flow — for ME21N, fill everything in and actually save the purchase order. Each variation you exercise (different document types, account assignments) may fire different enhancements, so a few passes are better than one.
5. Press **Back** (F3) to return to ANST. You'll see a tree of the application components touched.
6. Click **Select All**, then **Customer Code**.
7. Export the results **as xlsx** — not CSV, not text.

Save it under your test folder, in `tests/<PROGRAM>/sources/anst/`, and give Copilot the full path.

The trace is only as good as the flows you exercised. A trace where you opened the transaction and pressed Back finds almost nothing.

## What Copilot does with it

It classifies every row in the export — genuine customer objects, user exits, potential includes, standard SAP code — writes the classified work list beside your spreadsheet, and then researches each customer object to understand what it actually does. Those findings feed straight into the test plan, so your enhancements get their own test cases rather than being invisible.

If you already have an ANST export from an earlier session, skip the collection steps and just give Copilot the path.
