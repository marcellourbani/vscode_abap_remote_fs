---
name: multi-system-workflows
description: "Guidance for SAP UI test scenarios that cross multiple SAP systems or connections. Use when one business process has ordered stages on different connectionIds, such as creating a PO in system 1 and creating an appointment for it in system 2, or when test output must pass between systems."
---

# Multi-System Workflows

Use this guidance alongside the active SAP Testing phase skill. This is not an eighth phase
and does not add multi-system support inside one spec.

## Current boundary

One Playwright spec runs against exactly one `connectionId`. Do not open a second SAP system
inside that spec, switch `SAP_SYSTEM`, or use Playwright projects as business-process stages.
The current `abapfs_run_playwright_tests` tool also has one global `connectionId` per invocation.

Represent one cross-system business scenario as linked stage cases/scripts, one per system:

- `TC-021` — create PO on `S4DEV100`.
- `TC-022` — create appointment for that PO on `EWMDEV100`.

Record the relationship in each case's `## Notes for automation`: a shared workflow name,
stage number, target connection, predecessor, values produced, and values consumed. Keep
normal `TC-NNN` filenames so index, data, verification, and evidence tooling continue to work.

## Design rules

1. Give each stage its own TC file, data spec when needed, script, verification, and evidence.
2. Make the target connection explicit in Preconditions and Notes; never hardcode credentials.
3. State the ordered dependency: producer before consumer. These stages are never one parallel batch.
4. If a stage can be independently retried, define its idempotency/precondition behavior.
5. Do not claim one logical aggregated PASS: today each stage has its own status. Report the
   workflow passed only after every stage and every post-test check passed.

## Passing runtime values

Prepared inputs remain in each stage's normal per-system `data.json`. Do not overwrite or
repurpose it with values created during execution.

When a producer creates a key a later stage needs (PO number, delivery, appointment ID), use
an explicit workflow JSON artifact under:

```text
tests/<PROGRAM>/test-results/workflows/<workflow-name>/state.json
```

The producer writes only after SAP confirms success; write atomically (temporary file then
rename). The consumer reads the named value and fails loudly when the file/key is missing.
Never guess, rediscover, or silently substitute a different business object. Do not store
credentials or session cookies there. Notes for automation must name every produced/consumed
key and the JSON path.

The runtime currently has no dedicated publish/consume helper. Keep any required filesystem
code small and explicit in the stage specs, and call out this limitation in the handoff.

## Running the workflow

Copilot orchestrates separate `abapfs_run_playwright_tests` calls in stage order:

```json
{ "program": "PO_APPOINTMENT", "tcIds": ["TC-021"], "connectionId": "s4dev100" }
```

After PASS and required post-test verification:

```json
{ "program": "PO_APPOINTMENT", "tcIds": ["TC-022"], "connectionId": "ewmdev100" }
```

Stop when a stage fails or is blocked; later consumers become BLOCKED by their predecessor,
not failed. Never run dependent stages together with `runInParallel: true`. Independent
workflows may be batched separately after their independence is confirmed.

## Phase integration

- `analyze-and-plan`: identify system boundaries and produced/consumed business keys.
- `design-cases`: split the scenario into linked ordered stage cases and document metadata.
- `define-data` / `prepare-data`: prepare only pre-existing inputs; runtime-produced keys are
  workflow state, not cached prepared data.
- `build-scripts`: keep one connection per script and implement explicit JSON handoff only
  where a produced value is required.
- `run-scripts`: execute one connection-specific tool call per stage, verify each stage, and
  report both per-stage outcomes and the derived workflow outcome.
