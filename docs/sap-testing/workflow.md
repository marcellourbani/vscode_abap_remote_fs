# The Testing Workflow

Building a test suite runs in seven phases. Each one produces a specific set of files in your test folder and hands off to the next.

You don't have to memorise any of this. Start with `/sap-testing`, and at the end of every phase Copilot tells you exactly what to say to start the next one. This page is here so you know what you're looking at and what's worth reviewing.

| Phase | What Copilot does | What you get |
|---|---|---|
| 1. Analyze | Downloads and reads the ABAP source | `_flow.md`, `_units.md`, `_findings.md` |
| 2. Explore | Opens the transaction in a browser and maps the screens | `_screens.md` |
| 3. Design | Writes the test plan | `TC-001.md`… plus `_index.md` and `_index.docx` |
| 4. Define data | Specifies what data each case needs | `TC-001.data.md`… |
| 5. Prepare data | Finds real values in your SAP system | `data.json` per case, per system |
| 6. Build scripts | Converts each case into an automated test | `TC-001.spec.ts`… |
| 7. Run | Executes the tests and verifies the results | Screenshots, checks, and an evidence report |

## One chat or many — your call

Every phase reads what it needs from the files on disk, so a fresh chat loses nothing. Copilot ends each phase by suggesting a new chat and giving you the exact sentence to start it with, but that's a suggestion, not a requirement — carrying straight on in the same conversation works too.

The trade-off:

- **A new chat per phase** keeps the model's context small and focused, which usually means sharper work on long analyses. You review each phase's output as a natural checkpoint.
- **One continuous chat** is simpler and keeps the thread of your own decisions and asides, which can be handy on a small program. The risk is that a conversation carrying several phases of history gets sloppier as it fills up.

Rule of thumb: a short report is fine in one chat; a large program with dozens of cases is better split.

## Phase 1 — Analyze the code

Copilot resolves your transaction or report to its real executable object, downloads the complete source including every include, reads all of it, and writes down what it found: how the program flows, what every routine reads and writes, and a full list of every validation, message, branch, and authorization check.

The key output is `_findings.md`, which ends with a **target minimum** — the number of test cases this program honestly needs. That number drives the rest of the workflow.

**Worth your attention:** if you're testing a standard SAP transaction (ME21N, VA01, MIGO…), Copilot will suggest capturing an [ANST trace](anst.md) first. Static analysis under-reports enhancements on standard code, so it's worth doing.

## Phase 2 — Explore the screens

Copilot opens the transaction in a real browser and walks through it, recording every field, button, checkbox, and dialog by the exact label the automation will need — plus each control's starting state.

This has to be done by looking, not by reading the ABAP source, because the labels a browser exposes are not the same as the field names in the code. A reviewer agent checks specifically for that mistake.

**Worth your attention:**

- Copilot will not click anything destructive without asking. If the program has a *Test Run* vs *Update* switch, it selects the test side first. If there's no test mode and the program writes data, it stops and asks you.
- If it hits a control it can't drive, it will ask you either for sample data or for a [recording](recording.md). Answering is much better than letting it guess.

## Phase 3 — Design the test cases

Copilot turns the findings and the screen map into one file per test case, each with the full selection-screen state, the steps, the expected result, and — importantly — how the case will be **proven** afterwards in the database, not just on screen.

An independent reviewer agent then reads the actual source again and challenges the plan: cases that were merged when they should be separate, categories that were quietly skipped, state-changing cases with no verification. Copilot fixes what it finds and re-reviews until it passes.

**Worth your attention:** you get `_index.docx`, a printable, bordered case list. This is the document to review yourself, or send to the business owner, before anyone writes a line of automation. Copilot will also ask which cases to prioritise.

## Phase 4 — Define the test data

For every case that needs data, Copilot writes a small spec describing the *shape* of what's needed — "a material of type FERT with a plant assignment" — rather than a specific number. That's what lets the same test run on a different landscape later.

Upload files are described here too, and Copilot matches the file format to what the program actually parses.

## Phase 5 — Prepare the data

Now Copilot finds real values in the SAP system you named, by querying it. It shows you everything it found in one table and **waits for your approval** before saving anything.

Approved values are cached per system, so DEV, QAS, and PRD each get their own set and changing one never affects another.

**Worth your attention:** if a query returns nothing, Copilot stops and tells you rather than inventing a value. If a test needs a record that only the program itself can create, it asks permission before running that setup — it's a real write to your system.

## Phase 6 — Build the scripts

Each approved case becomes one automated test. The scripts are written against a bundled SAP runtime, so they read like SAP steps rather than browser code:

```typescript
await sap.openTx("Z_MY_TCODE");
await sap.setField("Material", data.sample_material);
await sap.execute();
await sap.expectAlert(/completed/i);
```

No login code (the runner signs in for you), no hardcoded business data, no manual waits.

## Phase 7 — Run and verify

Copilot checks your data is ready, runs the tests, and then does the part that matters most: it runs the database checks each case declared, because a green screen doesn't prove SAP actually stored the right thing. A case whose UI passed but whose database check failed is reported as a **failure**.

Checks a machine can't do — an application-server file, an XML payload, an email actually arriving — are recorded as *pending* with instructions for you, and stay visible in the report until you confirm them.

Finally you get `<PROGRAM>-<SYSTEM>-report.docx`: a title page with the pass/fail summary, a colour-coded results table, and one section per case with every step, timestamp, and screenshot.

**Worth your attention:** Copilot reports three outcomes, not two. **Blocked** means the test never reached SAP because its data wasn't ready — that's a data problem, not a bug. Don't read it as a failure.

## The one loop

Occasionally a test needs a record that only *another* test can create. That setup script doesn't exist until phase 6, so phase 5 flags the requirement as deferred and you run it a second time after the scripts are built:

**4 → 5 → 6 → 5 → 7**

This is expected, not rework. Copilot names the deferred items in its handoff so the next chat knows a second data pass is owed.

## Running again later

Once a suite exists you don't repeat all seven phases. To run against another system, do phase 5 for that connection and then phase 7. To re-run the same tests after a code change, just phase 7.
