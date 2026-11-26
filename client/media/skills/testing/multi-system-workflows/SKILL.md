---
name: multi-system-workflows
description: "Guidance for SAP UI test scenarios that cross multiple SAP systems or connections. Use when one business process has ordered stages on different connectionIds, such as creating a PO in system 1 and creating an appointment for it in system 2, or when test output must pass between systems."
---

# Multi-System Workflows

Use this guidance with the full testing framework by default; an explicit scoped cross-system check may omit formal stage cases, prepared-data caches, reviews, and workflow-state artifacts it does not need. It cannot waive safety, authorization, truthful per-system results, actual value handoffs, or the one-connection-per-spec/run limit below—this is a supporting method, not an eighth phase.

## Current boundary

One Playwright spec runs against exactly one `connectionId`. Do not open a second SAP system
inside that spec, switch `SAP_SYSTEM`, or use Playwright projects as business-process stages.
The current `abapfs_run_playwright_tests` tool also has one global `connectionId` per invocation.

In the full framework, represent one cross-system business scenario as linked stage cases/scripts, one per system:

- `TC-021` — create PO on `S4DEV100`.
- `TC-022` — create appointment for that PO on `EWMDEV100`.

For scoped manual/browser checks, orchestrate separate sessions and record only the dependencies/results needed; do not claim support for switching systems inside one spec. Automated scoped stages still need separate executable specs and tool invocations.

Record the relationship in each full-framework case's `## Notes for automation`: a shared workflow name,
stage number, target connection, predecessor, values produced, and values consumed. Keep
normal `TC-NNN` filenames so index, data, verification, and evidence tooling continue to work.

## Design rules

1. In the full framework, give each stage its own TC file, data spec when needed, script, verification, and evidence; a scoped check needs only the executable/verification resources it actually uses.
2. Make each target connection explicit (Preconditions and Notes in the full framework); never hardcode credentials.
3. State the ordered dependency: producer before consumer. These stages are never one parallel batch.
4. If a stage can be independently retried, define its idempotency/precondition behavior.
5. Do not claim one logical aggregated PASS: today each stage has its own status. Report the
   workflow passed only after every stage and every post-test check passed.

## Passing runtime values

When using prepared-data caches, keep inputs in each stage's normal per-system `data.json`;
do not overwrite or repurpose it with execution outputs. A scoped stage may instead use
verified/user-provided inline inputs or static `.data.md` values without a cache.

When automated stages need a producer's new key (PO number, delivery, appointment ID), use
an explicit handoff, normally a workflow JSON artifact under:

```text
tests/<PROGRAM>/test-results/workflows/<workflow-name>/state.json
```

The producer writes only after SAP confirms success; write atomically (temporary file then
rename). The consumer reads the named value and fails loudly when the file/key is missing.
Never guess, rediscover, or silently substitute a different business object. Do not store
credentials or session cookies there. Notes for automation must name every produced/consumed
key and the JSON path in the full framework. For a scoped browser check, an explicitly
observed and passed value can replace the JSON artifact; preserve its source system and
confirmation, and report a blocked consumer if no usable value is available.

The runtime currently has no dedicated publish/consume helper. Keep any required filesystem
code small and explicit in the stage specs, and call out this limitation in the handoff.

## Running the workflow

Copilot orchestrates separate `abapfs_run_playwright_tests` calls in stage order:

```json
{ "program": "PO_APPOINTMENT", "tcIds": ["TC-021"], "connectionId": "s4dev100" }
```

After PASS and the verification required for the requested scope:

```json
{ "program": "PO_APPOINTMENT", "tcIds": ["TC-022"], "connectionId": "ewmdev100" }
```

For explicit scoped runner calls that omit workflow gates, add `skipWorkflowValidation: true`
and a nonempty `overrideReason` explaining the user's scope to each applicable call; do not
supply unearned prerequisite/reviewer certifications. These flags do not enable a second
connection inside a spec or remove executable/authorization requirements.

Stop when a stage fails or is blocked; later consumers become BLOCKED by their predecessor,
not failed. Never run dependent stages together with `runInParallel: true`. Independent
workflows may be batched separately after their independence is confirmed.

## Phase integration (full-framework default)

- `analyze-and-plan`: identify system boundaries and produced/consumed business keys.
- `design-cases`: split the scenario into linked ordered stage cases and document metadata.
- `define-data` / `prepare-data`: prepare only pre-existing inputs; runtime-produced keys are
  workflow state, not cached prepared data.
- `build-scripts`: keep one connection per script and implement explicit JSON handoff only
  where a produced value is required.
- `run-scripts`: execute one connection-specific tool call per stage, verify each stage, and
  report both per-stage outcomes and the derived workflow outcome.

Use only the relevant methods above for a narrower request; do not manufacture formal
phase artifacts. If delegating bounded helper/worker/reviewer work, pass `userIntent`
(requested outcome, scope, and applicable overrides) with the stage's system and inputs.
