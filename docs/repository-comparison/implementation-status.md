# Repository Comparison: Implementation Status and Next Steps

This document records the repository-comparison design decisions, implemented work, known
limitations, and remaining roadmap. It is intended to provide enough context to continue the work
in a new chat without repeating the initial research.

## Developer workflow instructions

Follow these instructions for subsequent work unless the user explicitly overrides them:

- do not run `pnpm format` or any other formatter;
- do not run tests;
- do not run `tsc`, `pnpm typecheck`, or other typechecking commands;
- do not create a changeset;
- after edits, use IDE lint diagnostics only to check for errors;
- leave final formatting, tests, typechecking, and changeset creation to the user before commit.

## Original goals

The broader goal is to make repository comparison usable when thousands of objects differ between
two SAP systems.

The existing manual assisted-apply workflow is intentionally safe, but requiring a developer to
open, stage, save, and activate every object does not scale. The proposed direction is:

- retain manual assisted apply as the universal fallback;
- let Copilot inspect bounded per-object differences;
- let users define strict filters and approve bounded batches;
- let Copilot classify candidates as apply-as-is, skip, or needs-human;
- copy reviewed raw source through guarded write, transport, and verification services while
  Copilot controls the approved per-object sequence;
- checkpoint every object so batches can pause, resume, and report partial failure.

Singular Copilot-assisted staging and saving is now implemented for every applicable changed text
resource belonging to one table object. Activation remains a separate Copilot/subagent operation;
the main skill now defines user-approved parallel waves of up to ten one-object subagents.

## Existing workflow architecture

The workflow currently has these stages:

1. Discover source and target TADIR inventories.
2. Compare object existence locally.
3. Select objects present on both systems.
4. Download source and target snapshots.
5. Compare downloaded snapshots.
6. Choose manual assisted apply or Copilot-assisted apply for the workflow.
7. Prepare a read-only assisted-apply plan.
8. Either let the user review and stage one raw source resource manually, or let the user select
   and save the exact objects Copilot may review and apply one at a time.

Manual mode still leaves saving, transport selection, and activation to the user. In Copilot mode,
the singular apply tool can stage and save every applicable changed text resource for one approved
object with an explicit user-directed transport choice. Activation remains separate.

## Source resolution before download

Discovery reads TADIR fields such as `PGMID`, `OBJECT`, `OBJ_NAME`, and package metadata. It does
not currently populate `adtUri` or `adtType`.

After snapshot verification, the workflow performs a best-effort wildcard URI preparation phase
for unresolved pending objects. `WorkflowSnapshotService` resolves a persisted or prepared backend
ADT URI to an ABAP FS workspace URI before passing it to `AbapResourceDownloadService`.

Because discovery normally has no URI, cache misses make a repository-workflow-specific exact
object-name/type search. That fallback requests at most five results and rejects non-exact and
ambiguous results instead of selecting the first approximate result. The workflow resolver uses the
proven ADT URI to obtain the ABAP FS workspace path through `findByAdtUri`.

These strict and backend-URI resolution rules are isolated to `WorkflowSnapshotService`.
`AbapResourceDownloadService` retains its existing behavior for the download LM tool and all other
callers.

The URI/workspace path is needed because an object can resolve to either a source file or a
directory containing multiple resources. TADIR type and name do not currently provide that
workspace path directly.

Search is skipped when `adtUri` is already available or when a previously downloaded snapshot
passes local verification.

### Wildcard URI preparation — implemented

Per-object ADT search can become expensive for thousands of selected objects. A best-effort
wildcard prewarm phase now runs before the existing parallel download pools. URI preparation is an
optimization, not a prerequisite: every cache miss retains the current per-object search fallback.

#### Wildcard preparation

1. After local snapshot verification identifies pending records, collect only records without an
   existing `adtUri`.
2. Resolve source and target independently because the same repository key can map differently in
   each system.
3. Create one wildcard term per selected object name:
   - when the name has more than 10 characters, remove the final 5 characters and append `*`;
   - otherwise, remove the final 3 characters and append `*`.
4. After collecting the wildcard terms, discard every term whose prefix contains three or fewer
   characters when the trailing `*` is excluded. These objects use exact fallback; the workflow
   never issues `*`, `A*`, `AB*`, or `ABC*`.
5. Deduplicate terms by connection, exact repository object type, and wildcard term. Every SAP
   search must include the object type; never issue an all-type wildcard search.
6. Run the unique wildcard searches with bounded parallelism of at most four per system,
   independently for source and target, with a result limit of 200.
7. For every response, retain only exact normalized-name and compatible-type matches for objects
   actually pending in that group. Never assign a prefix match merely because it was returned.
8. If a response reaches the result cap, do not split or retry the wildcard. Cache any exact proven
   matches that were returned and leave all absent objects unresolved. Their download workers will
   perform normal exact searches later.
9. A failed wildcard query is also non-blocking. Leave its objects unresolved and continue
   preparation.

#### Resolution map and download fallback

Persist successful matches in side-specific workflow artifacts. Key entries by connection ID,
repository object type, and normalized object name, and store both the backend `adtUri` and returned
`adtType`. Include a strategy version so future matching changes invalidate stale entries.

After preparation, start the existing source and target download pools in parallel. Each worker:

1. uses a compatible persisted or prepared URI when present;
2. otherwise performs the existing exact per-object search;
3. resolves the ADT URI through `findByAdtUri`;
4. downloads the object as it does today.

The repository workflow's exact fallback does not use `results?.[0]` when no exact match exists. It
requires an exact normalized name and compatible type; an absent or ambiguous exact result is a
per-object failure, not permission to download an approximate object.

The map is rewritten with only compatible entries for the current pending set when preparation
runs. Criteria/system invalidation removes the complete sources tree. A stale prepared URI that
cannot resolve falls back once to the normal exact object-name search. Preparation honors
cancellation between wildcard calls and remains part of the existing source-download step rather
than becoming a new blocking workflow step.

While URI preparation runs, the webview reports that source and target objects are being resolved;
the normal download label appears only after preparation completes. The ABAP FS output log records
the total source/target entries in each prepared map and, after download, the number of workers on
each side that had to use direct object search.

#### Tests added

- long and short names generate the agreed wildcard terms;
- terms with three or fewer prefix characters are removed;
- duplicate type/term combinations result in one SAP call;
- exact compatible matches populate the map and unrelated prefix results do not;
- capped and failed wildcard responses leave missing objects for normal fallback without splitting;
- distinct exact URIs remain ambiguous instead of being cached;
- persisted cache hits avoid another SAP search;
- workers use prepared hits and retry exact search when a prepared URI is stale;
- URI-map and direct-search totals are logged, and the webview includes the resolution phase label;
- no fallback to the first non-exact result;
- the engine completes source/target URI preparation before starting either download pool.

## Dual raw and formatted snapshots — implemented

Each downloaded object now stores two local representations:

- `raw/` contains the exact downloaded SAP resources;
- `formatted/` contains comparison-only formatted resources.

Raw resources remain authoritative for assisted apply and stale-snapshot verification.

For ABAP source, formatting uses `@abaplint/core` with the fixed version identifier
`abaplint-upper-token-space-v2`. The current configuration applies:

- `keyword_case` with style `upper`;
- non-keyword identifier normalization performed by that rule;
- `sequential_blank` with a maximum of four lines;
- the normal ABAPLint pretty-printer layout.

After pretty-printing, the formatter uses ABAPLint's complete token stream to collapse horizontal
whitespace only between tokens. Token text and line boundaries are preserved exactly, including
string and character literals, string-template text, comments, pseudo-comments, and pragmas. Token
order and complete non-whitespace coverage are verified; any inconsistency makes formatted
comparison unavailable instead of applying a character-based heuristic.

Therefore, formatted equality means equality after fixed ABAPLint case, layout, and verified
inter-token horizontal-whitespace normalization, not case-only equality.

Non-ABAP and binary resources are copied unchanged into the formatted tree. If ABAPLint cannot
format a source file:

- the raw snapshot remains available;
- the formatting failure is recorded separately;
- formatted equality and formatted diff are unavailable for that object;
- the raw download is not treated as failed merely because formatting failed.

Snapshot manifests now record raw files and hashes, formatted files and hashes, formatter version,
and formatting failures. Old snapshot layouts are invalidated and downloaded again when source
comparison is rerun.

## Raw and formatted comparison metrics — implemented

The shared `SourceComparisonRecord` now contains explicit raw and formatted metrics.

Raw metrics include:

- source and target aggregate hashes;
- exact equality;
- added, removed, and changed resource paths;
- total source and target text lines;
- added, removed, and replaced line counts.

Formatted metrics include:

- source and target formatted aggregate hashes;
- formatted equality;
- formatted added, removed, and changed resource paths;
- formatted source and target text lines;
- formatted added, removed, and replaced line counts;
- a formatting error when formatted comparison is unavailable.

Legacy fields remain for compatibility with assisted apply and older persisted artifacts.

“Raw differing files” and “Formatted differing files” are not total file counts. They count
resources that were added, removed, or have different hashes in that representation. Formatting
does not create extra logical resources. The formatted count can be lower because raw case/layout
differences can become identical after formatting.

`status` remains the overall raw snapshot status. It can express `identical`, `different`,
`partial`, missing manifests, or errors. `rawIdentical` is only the raw equality boolean, so the
status field carries additional incomplete/error information.

## Webview changes — implemented

The source-comparison table now provides:

- Raw diff and Formatted diff buttons;
- paired raw/formatted equality and line metrics;
- Raw differing files and Formatted differing files;
- source and target total line counts;
- `Different (raw)` and `Different (formatted)` views;
- column widths large enough to show full headings, with horizontal scrolling;
- header tooltips explaining every comparison metric and how it is calculated;
- paired column ordering, for example Raw lines added followed by Formatted lines added.

The assisted-apply table also provides Raw diff and Formatted diff buttons. Both use the persisted
local snapshot trees. Live source and target buttons remain separate.

Formatted diff is disabled when formatted snapshots are equal or formatting was unavailable.

## CSV and XLSX exports — implemented

Source-comparison exports now include explicit raw and formatted fields:

- equality;
- source and target line totals;
- added, removed, and changed resource counts and paths;
- line additions, removals, and replacements;
- source and target aggregate hashes;
- formatted comparison errors.

## Copilot workflow data — implemented

The existing `abapfs_get_repository_workflow` tool still exposes full source-comparison rows through
the bounded `sourceComparison` artifact, so Copilot receives the raw and formatted metrics.

The same tool now supports `include: ["diff"]` for a bounded per-object source diff.

Inputs:

- `objectKey`: exact repository key, required;
- `representation`: `raw` or `formatted`, default `formatted`;
- `filePath`: optional exact changed resource path;
- `maxFiles`: default 3, maximum 10;
- `maxChars`: default 30,000, maximum 100,000.

The result contains unified patches from target to source, available changed text paths, omitted
file counts, and truncation indicators. It explicitly reports that the direction is target-to-source:
removed lines are current target content and added lines are desired source content. Added and
removed text resources are represented with an empty side. Binary resources are not returned as
text diffs.

No whole repository or unbounded source collection is returned to the model.

## Diff display decision

VS Code's standard diff editor cannot render original text while aligning or highlighting against
a separately normalized comparison key.

The current implementation therefore provides:

- Raw diff for exact downloaded text;
- Formatted diff for low-noise ABAPLint output.

A future custom diff viewer would be required to show original casing while suppressing case-only
highlights in the same view. This is optional and has not been implemented.

## Assisted apply safety retained

The new formatted representation is never staged into SAP. Manual assisted apply:

- reads from `raw/`;
- validates the raw aggregate source hash;
- refreshes and validates the target raw hash;
- opens a dirty target editor only;
- does not save, select a transport, or activate.

Copilot-assisted apply uses the same raw-source and stale-target checks, then saves through the
normal filesystem provider with a short-lived transport intent and verifies the inactive SAP
source. It does not activate.

Existing blockers remain, including incomplete snapshots, added or removed resources, generated
objects, standard objects, and object-type mismatches.

### Assisted-apply relevance basis — implemented

Assisted-apply planning now has a user-selectable relevance basis:

- `formatted` is the default and treats an object as relevant only when formatted snapshots differ;
- `raw` treats an object as relevant when exact downloaded snapshots differ.

The selected basis is persisted in `AssistedApplyPlan.comparisonBasis`. Each plan item records
whether it is relevant independently from whether it is eligible:

- equal under the selected basis becomes **No action**;
- different and otherwise safe becomes **Ready**;
- an unavailable formatted comparison becomes **Blocked**, not silently equal;
- incomplete snapshots and all existing safety failures remain blocked.

The webview exposes the basis beside **Prepare assisted apply** and shows it in the plan summary.
`abapfs_prepare_repository_assisted_apply` also accepts `comparisonBasis: "raw" | "formatted"`.

When formatted relevance is selected, review and staging are limited to resource paths that remain
different after formatting, but the bytes staged into the target editor always come from `raw/`.
Raw aggregate hashes and raw target refreshes remain authoritative for stale-state protection.

### Manual or Copilot-assisted apply mode — implemented

After source comparison, phase 3 initially presents two choices:

- **Assisted apply** shows the existing manual staging workflow.
- **Copilot-assisted apply** first shows a modal VS Code warning describing the target-system risks
  and requires explicit confirmation once for that workflow.

The selected mode is persisted on the workflow and can be changed. Switching modes retains the
saved Copilot selection and completion state so the user can return to it. Both modes use the same
assisted-apply plan and now expose an export button for the plan table.

Copilot-assisted apply uses a user-owned selection:

- only eligible assisted-apply plan items can be selected;
- users can select rows directly or export XLSX/CSV, mark the `Selected` column, and import it;
- imported selections remain local UI state until the user presses **Save selection**;
- the saved selection is persisted per workflow and the UI reports the saved object count;
- each saved object has a persisted `pending` or `done` status shown in the Copilot-assisted table;
- each selected object has a Copilot decision: `as-is`, `skip`, or `needs-human`;
- new selections default to `needs-human`;
- each explicit Copilot decision requires and persists a concise per-object reason, which is shown in
  the table, returned by the workflow tool, and included in CSV/XLSX exports;
- refreshing or invalidating the assisted-apply plan invalidates its saved Copilot selection.

The `abapfs_get_repository_workflow` tool supports
`include: ["assistedApplyObjects"]`. It returns only the user-saved Copilot selection and is bounded
with `offset` and `limit` pagination. Every result reports total, done, and pending counts. Queries
return pending objects by default; `includeDone: true` includes completed objects.

Successful `abapfs_record_repository_workflow_object_activation` calls mark the singular object
done automatically after persisting the exact successful attempt and activation URL set.
`assistedApplyAction: "markDone"` now requires an existing persisted successful completion event;
`markPending` resets selected objects for retry. These status actions do not write to SAP. Copilot
cannot choose or expand the approved object list through them.

Copilot review decisions use `assistedApplyAction: "setDecision"`. Each call must contain exactly
one `objectKey`, one `assistedApplyDecision`, and one non-empty `assistedApplyDecisionReason`;
batched decision updates are rejected so Copilot must inspect and classify each object separately.
Decision statistics are included with the other selection statistics.

The assisted-apply plan now records target transport status as one of `not-checked`, `locked`,
`not-locked`, `local`, or `error`, together with the request, description, check time, and error
where applicable. Manual and Copilot-assisted tables expose **Determine transport request for
selected objects**. The user selects eligible rows, chooses bounded target-SAP concurrency from 1
to 10, and sees progress while the workflow checks only those objects. Manual selection is
temporary UI state; Copilot mode uses the user's saved apply selection. Results are persisted,
shown as separate status/request columns, and included in CSV and XLSX exports.

The bulk transport check is intentionally user-only and is not exposed as a repository-workflow LM
action. Copilot receives the structured transport fields when it reads the saved assisted-apply
objects, so it can distinguish a confirmed absence of a transport lock from a check that has never
run.

The singular `abapfs_apply_repository_workflow_object` tool can act only when the workflow is
currently in Copilot mode with recorded consent. The object must be in the saved selection,
pending, eligible, and have an `as-is` decision with a non-empty reason. It copies every applicable
changed reviewed raw resource, arms a one-shot transport intent for each save, waits for each
`FsProvider` result, and compares every inactive SAP source with its reviewed raw source. It never
chooses a transport or activates.

Every attempt is persisted as lifecycle events under the workflow, including object/resource,
attempt and intent IDs, source/target hashes, transport choice and actual request, save result,
inactive verification, activation result, timestamps, activated URLs, and errors. The webview shows
summary columns on each row and a full per-object history view. The assisted-apply export includes
the latest execution summary, and `abapfs_get_repository_workflow` can return bounded
`assistedApplyHistory` for one object.

## Copilot-assisted execution roadmap — partially implemented

### 1. Copilot review plan — implemented

Use the bounded diff reader to let Copilot classify only the objects the user selected and saved:

- apply-as-is;
- skip;
- needs-human.

The model should provide a short reason. It should inspect only requested objects and must not
regenerate or rewrite source when the intended operation is direct propagation. The captured raw
source bytes should be copied. Copilot must not add objects to the user-owned selection.

### 2. Optional persisted batch filters and dry run — not designed

The main skill now defines bounded orchestration: Copilot owns the user conversation and launches
one fresh worker per object in explicitly approved waves of at most ten. If a future UI or
deterministic batch service is added, define whether to persist include/exclude policy for:

- package and object type;
- object name;
- raw/formatted comparison classification;
- generated, standard, partner, and uncertain ownership;
- source-only, target-only, partial, and unsupported objects;
- target transport state;
- explicit object exclusions;
- maximum batch size.

That future design should produce a dry-run plan with counts and exceptions and require explicit
user approval for each bounded batch. It is not required for the implemented singular apply path.

### 3. Target transport information — initial checks implemented

The user-owned bulk check calls ADT `transportInfo` against the target system only for selected
eligible assisted-apply candidates, using bounded concurrency. CTS request association is not the
same as a transient SAP enqueue lock.

The generic read-only `abapfs_get_object_transport_status` LM tool checks exactly one object and
returns its current `locked`, `not-locked`, or `local` state, request, description, object path, and
timestamp. It does not accept arrays. During future execution, Copilot may call it one object at a
time against the target immediately before applying that object, because a persisted bulk result can
become stale. Copilot must not trigger the webview's bulk operation.

Policies for an object without an associated request should include:

- skip;
- ask the user for a request;
- use an explicitly preapproved request mapping.

Never create or select a transport silently. Validate that a supplied request is modifiable and
compatible with the current package/object state.

The shared transport-intent bridge is implemented:

- `abapfs_set_transport_for_next_object_save` arms one exact `adt://` resource for an ordinary
  Copilot edit;
- `abapfs_apply_repository_workflow_object` derives every applicable changed target resource from
  the persisted workflow and performs one object-level staging and saving attempt;
- `FsProvider.writeFile` atomically claims a matching intent before SAP lock acquisition, performs
  fresh non-interactive transport validation, and records success or failure;
- no matching intent preserves the existing interactive transport picker;
- local objects ignore transport assignment after fresh local-status validation;
- competing, stale, conflicting, and invalid intents fail rather than silently selecting another
  request;
- when creation of a new request succeeds but the later source write fails, the failed intent result
  still reports the created request separately from the write error;
- both singular and batch source-reading tools accept `version: "active" | "inactive"` so Copilot
  can inspect pending SAP source;
- MCP `replace_string_in_abap_object` accepts the same optional explicit transport choice and
  verifies the resulting inactive source.

Transport IDs and new-request descriptions must come from or be explicitly approved by the user.
The main agent owns transport strategy and must provide a complete path for every delegated object.
For one shared new request, the main agent creates it and passes its exact approved number to the
applicable workers. For one new request per object, it passes one exact approved description to
each worker, which may create exactly one request during guarded save. Workers reject missing or
ambiguous transport guidance. The generic intent tool does not wait for Copilot's later built-in
write; Copilot must use its write result, recheck transport status when relevant, and read inactive
source to verify the pending change.

### 3a. Object lock status tool

Build a separate LM tool, tentatively named `get_abap_object_lock_status`, so Copilot can inspect
the current SAP object lock/enqueue state through deterministic ABAP FS logic. Define supported
object types, bounded input, lock-owner reporting, stale-result behavior, and authorization before
using it in execution. This is distinct from CTS request association and is not implemented.

### 4. Guarded singular execution — partially implemented

For each approved object or activation group:

1. Revalidate the raw source snapshot.
2. Download and revalidate the current target.
3. Revalidate transport information at the filesystem write boundary.
4. Lock and save through the normal filesystem provider.
5. Verify the inactive source SAP saved.
6. Activate only the expected object group.
7. Record result, hashes, transport, timestamps, and errors.

Steps 1–5 are implemented for all applicable changed text resources of one eligible, user-selected
repository object. The tool reports a timeout as unknown rather than failed and persists partial
results. The existing activation tool performs step 6 under Copilot/subagent orchestration.
`abapfs_record_repository_workflow_object_activation` persists activation success/failure and exact
URLs; success records completion and marks the object done. The main skill forbids automatic
retries, lets already-started workers finish, reconciles their persisted outcomes, reports the
wave, and requires new user direction before another wave.

### 5. Activation and dependency groups

One TADIR object is not always one source file or one activation unit. Includes, class components,
function groups, and related inactive objects may need coordinated save and activation.

The activation tool now returns a backend activation `url` and, when resolvable, its ABAP FS
`workspaceUri`. The execution skill requires a delegated one-object subagent to match each returned
`workspaceUri` by exact equality with a successful `resourceResults[].objectUri` from that object's
apply result, then pass only the corresponding backend `url` values to activation. Names, types,
regexes, and parent URIs are supporting evidence only. Missing, unmatched, or apparently required
but unapplied components force `NEEDS_HUMAN_ACTIVATION`; the worker must not guess or broaden the
set.

The standalone activation tool now supports the prerequisite mechanics: it can list inactive ADT
objects, accept an explicit set of related object URLs, activate the set in one SAP request, and
verify that none of the selected objects remain inactive. Unit coverage includes two related
includes submitted together. The repository activation-record tool links that separately verified
activation result to the exact persisted apply attempt and marks the object done only on success.

### 6. Limited rollout

Start with small approved batches and object types already supported by assisted apply. Expand only
after integration testing against a non-production SAP system.

### 7. Dedicated Copilot-assisted-apply skill and subagent — implemented

Detailed execution policy now lives in the packaged `repository-assisted-apply` skill. The general
repository-workflow skill retains the overall workflow, manual/Copilot mode overview, visible
user-owned controls, and delegation contract.

The packaged `abap-repository-assisted-apply` subagent handles exactly one workflow ID and one saved
object key. Its extension-tool access is limited to bounded workflow inspection/decision, singular
transport status, singular repository apply, activation, and activation recording; the standard
read tool is available only to load the packaged skill. The parent must pass the exact existing
request number, exact user-approved per-object new-request description, or local handling. The
worker must reject missing or ambiguous guidance and cannot choose the transport strategy, choose
objects, invoke the user-only bulk transport check, edit source, process a batch, retry failures,
activate unrelated work, or ask the user directly.

The general repository-workflow skill makes Copilot the batch owner. For each explicitly approved
wave, it expands user-approved transport policy into one exact direction per object, launches up to
ten fresh one-object workers at the approved concurrency, collects all already-started results,
reconciles persisted status, reports per-outcome counts and errors, and stops before any retry or
next wave.

### Remaining implementation work

The remaining repository-comparison work is:

1. Build the separate generic SAP enqueue/object-lock-status LM tool described in section 3a.
2. Exercise singular and bounded-wave Copilot-assisted apply end to end against a non-production
   SAP system,
   especially classes/function groups with related activation units and transport conflicts.
3. At the user's final-validation point, run formatting, tests, typechecking, and add the required
   changeset.

The comparison ideas in the next section remain optional follow-ups rather than committed
requirements.

## Additional comparison follow-ups

These were discussed but are not implemented:

- an explicit matched/same-line count in addition to source/target totals and diff counts;
- a higher-level comparison classification such as exact, formatting-only, and substantive;
- custom original-text diff rendering with normalized alignment;
- performance and memory measurement for thousands of formatted objects;
- formatter compatibility tests across representative programs, classes, interfaces, includes,
  function groups, string templates, modern syntax, and unsupported syntax;
- migration or cleanup policy for old snapshot folders beyond normal re-download invalidation.

## Files primarily involved

- `client/src/services/repositoryWorkflow/abapSourceFormatter.ts`
- `client/src/services/repositoryWorkflow/repositoryUriPreparationService.ts`
- `client/src/services/repositoryWorkflow/snapshotService.ts`
- `client/src/services/repositoryWorkflow/types.ts`
- `client/src/services/repositoryWorkflow/workflowPanel.ts`
- `client/src/services/repositoryWorkflow/workflowExportService.ts`
- `client/src/services/repositoryWorkflow/assistedApplyService.ts`
- `client/src/services/repositoryWorkflow/workflowEngine.ts`
- `client/src/services/lm-tools/repositoryWorkflowTools.ts`
- `client/src/services/lm-tools/repositoryWorkflowApplyTool.ts`
- `client/src/services/lm-tools/repositoryWorkflowActivationRecordTool.ts`
- `client/src/services/lm-tools/nextObjectSaveTransportTool.ts`
- `client/src/services/transportIntentService.ts`
- `client/src/services/subagentRegistry.ts`
- `client/src/adt/ai/activate.ts`
- `client/src/adt/operations/AdtObjectActivator.ts`
- `client/src/fs/FsProvider.ts`
- `client/src/adt/AdtTransports.ts`
- `client/src/services/abapResourceDownloadService.ts`
- `client/src/services/abapSearchService.ts`
- `client/media/skills/repository-workflow/SKILL.md`
- `client/media/skills/repository-assisted-apply/SKILL.md`
- `client/media/agents/abap-repository-assisted-apply.agent.md`
- `client/media/repositoryWorkflow/main.js`
- `client/media/repositoryWorkflow/main.css`
- `package.json`
- `docs/repository-comparison/`

## Verification state

- Relevant tests were updated and formatter-specific tests were added.
- The latest complete change set has not been run through the test suite or TypeScript typecheck;
  this is intentionally left for the developer's final validation.
- IDE lint diagnostics reported no errors after the latest activation-URI bridge, subagent,
  skills, orchestration, and wildcard URI preparation updates.
- No changeset file is present.

## Suggested next-chat starting prompt

> Continue the ABAP FS repository-comparison work. First read
> `docs/repository-comparison/implementation-status.md`. Treat raw snapshots as authoritative and
> formatted snapshots as comparison-only. Do not run formatting, tests, typecheck, or create a
> changeset unless explicitly requested. The next task is: [describe the next task].
