---
name: repository-workflow
description: "Create, inspect, configure, and run ABAP repository comparison workflows across two connected SAP systems. Use when the user asks to compare repositories, discover objects on source and target systems, compare ABAP source code, prepare assisted apply, inspect workflow status, or operate the Repository Comparison Workflow webview with abapfs repository workflow LM tools."
argument-hint: "[source system, target system, object/package scope, or workflow request]"
user-invocable: true
disable-model-invocation: false
---

# ABAP Repository Comparison Workflow

Operate persistent, checkpointed repository comparisons between two connected SAP systems through the `abapfs_*repository_workflow*` LM tools.

## Mental Model

The workflow has three user-visible stages:

1. **Scope and discovery** finds matching TADIR objects independently on source and target, then automatically compares the two persisted inventories locally.
2. **Compare systems** presents inventory presence, selects comparable objects, downloads both source snapshots, and compares their source locally.
3. **Assisted apply** lets Copilot prepare a safety-reviewed source-to-target plan. The webview can stage one reviewed source file in a dirty target editor, but it never saves or activates SAP objects.

The source/target direction never changes after creation. Always state it explicitly before assisted-apply work.

## Critical Operating Principle

This is a potentially high-impact, high-volume feature. Broad discovery can send many ADT requests to SAP; source comparison downloads objects from two systems; assisted apply can place source text in a live target editor. A mistaken scope, direction, selection, or concurrency choice can create substantial SAP load or prepare changes for the wrong system.

Copilot is the user's workflow assistant, not an autonomous repository scanner or change-application operator. The user sets the goal and guides progression. Copilot explains choices, prepares requested inputs, runs only explicitly requested stages, reports results, and stops at decision boundaries.

Mandatory behavior:

- Never create, configure, run, resume, rerun, or prepare an assisted-apply plan merely because it appears to be the next workflow step.
- Require clear user direction before every potentially expensive stage: criteria update, discovery with its automatic local inventory comparison, source comparison/download, and assisted-apply plan preparation.
- Do not interpret “inspect,” “explain,” “review,” “check,” or “what happens?” as permission to run or mutate a workflow.
- Treat discovery and its local inventory comparison as one requested operation. Do not automatically continue from that operation into source comparison or assisted apply unless the user explicitly requested the complete sequence.
- If the user requested a multi-stage sequence, stop immediately if they pause, redirect, or change scope. The newest instruction controls.
- Before discovery, restate source, target, effective scope, subpackage behavior, and any unusually broad pattern. Ask for confirmation when scope or intent is ambiguous.
- Before source comparison, state how many objects will be selected, the source/target SAP download concurrency, and the local verification concurrency. Read the existence summary or bounded artifact first when the count is unknown.
- Before assisted-apply plan preparation, state source-to-target direction and make clear that planning is non-mutating. Prepare it only when requested.
- Copilot's role ends after preparing and explaining the plan. Only the user can stage a file from the webview, save it through the normal editor flow, choose a transport, and activate related objects.

Load protection:

- Prefer narrow object-name and package patterns. Never broaden a scope for convenience.
- Treat `includeSubpackages: true` as potentially expensive because package hierarchy expansion can create many bounded SAP queries. Call this out before running discovery.
- Treat omitted object types as all supported types. If that would make discovery broad and the user's intent is unclear, ask which types matter.
- Do not raise concurrency automatically. Preserve saved values unless the user explicitly requests tuning or approves a proposed value.
- Do not rerun completed discovery or source comparison just to inspect results. Read summaries/artifacts instead.
- Do not re-save criteria unless scope must change or the user approves an intentional clean reset. Re-saving invalidates prior work.
- Avoid repeated polling. Workflow operations return completion state, and the webview refreshes from emitted progress events.
- Use bounded, filtered artifact reads. Do not request full inventories merely to count or inspect a few objects.

## Tool Map

| Intent | Tool | Important behavior |
|---|---|---|
| Find workflow IDs | `abapfs_list_repository_workflows` | Returns compact workflow status; use before guessing an ID. |
| Read selected information | `abapfs_get_repository_workflow` | Projection-based; request only what is needed. |
| Create | `abapfs_create_repository_workflow` | Requires two different connected systems. |
| Change discovery scope | `abapfs_update_repository_workflow_criteria` | Invalidates discovery and every downstream result. |
| Run analysis | `abapfs_run_repository_workflow_step` | `discovery` also performs local inventory comparison; `existenceComparison` retries that local phase; `sourceComparison` performs selection, downloads, and source comparison. |
| Prepare assisted apply | `abapfs_prepare_repository_assisted_apply` | Creates a review plan only; never changes SAP. |
| Focus the UI | `abapfs_open_repository_workflow` | Opens/selects a workflow; not needed merely to refresh an open webview. |

## Context-Efficient Reads

Everything returned by a tool consumes model context. Use the smallest useful read.

### Choose response sections

Use `include` with any combination of:

- `state`: workflow state, or one step when `step` is supplied.
- `criteria`: current persisted criteria.
- `summaries`: compact counts for completed stages.
- `artifact`: rows from exactly one requested artifact.

Defaults:

- No `include` and no `artifact`: state only.
- `artifact` supplied without `include`: artifact only.
- If `include` contains `artifact`, `artifact` must also be supplied.

### Read one step

Use `include: ["state"]` with `step` when checking only discovery, automatic inventory comparison, source comparison, or assisted-apply plan status. The `discovery` step reports the SAP inventory phase; use `existenceComparison` to verify the automatic local phase. Do not request full state just to learn whether one step failed.

### Read artifacts narrowly

Available artifacts:

- `sourceDiscovery`
- `targetDiscovery`
- `existenceComparison`
- `sourceComparison`
- `assistedApplyPlan`

Use `offset` and `limit`; the maximum page size is 200. Use `status`, `objectName`, `objectType`, and `packageName` filters where relevant. `objectName` supports `*` and `?`; status/type/package filters are exact.

Examples of efficient intent:

- “Did SAP inventory discovery finish?”: state plus `step: discovery`.
- “Did discovery and its automatic inventory comparison finish?”: state plus `step: existenceComparison`.
- “How many objects differ?”: summaries only.
- “Why is assisted apply blocked?”: assisted-apply plan artifact, preferably filtered/paged.
- “Show changed source details”: source-comparison artifact only.
- “Copy another workflow's scope”: criteria only from the old workflow.

Tool invocation messages shown to the user describe the requested projection or operation. Choose inputs that make that message truthful and useful.

## Create And Configure

1. List workflows when an existing workflow may already satisfy the request.
2. Create with explicit source and target connection IDs. They must be connected workspace roots and must differ.
3. Read or update criteria only when needed.

Creating a workflow also creates default criteria. Do not run discovery until the user has approved or supplied the intended scope.

### Copy criteria safely

To copy another workflow's criteria:

1. Read only `criteria` from the source workflow.
2. Pass the supported criteria fields to the update tool for the destination workflow.
3. Do not pass computed metadata such as `criteriaHash` or `updatedAt`.
4. Run discovery only after the update succeeds.

## Discovery Scope

At least one object-name pattern or package pattern is required.

- `*` means any characters; `?` means one character.
- When object name and package are both present, an object must match both.
- Package `*` and `/*` are rejected because they are unrestricted.
- Object types, namespaces, authors, creation dates, deleted/generated flags, and `$TMP` inclusion further narrow results.
- Leaving object types empty includes every supported type.

### Supported object types

Use only these values in `objectTypes`:

| Values | Meaning |
|---|---|
| `PROG` | Programs and includes |
| `CLAS`, `INTF`, `FUGR` | Classes, interfaces, and function groups |
| `TABL`, `DTEL`, `DOMA`, `TTYP`, `VIEW`, `SHLP`, `ENQU` | Dictionary objects |
| `DDLS`, `DCLS`, `DDLX` | CDS definitions, access controls, and metadata extensions |
| `BDEF`, `SRVD`, `SRVB` | RAP behavior and service definitions/bindings |
| `MSAG`, `TRAN` | Message classes and transactions |
| `ENHO`, `ENHS`, `SXSD`, `SXCI` | Enhancements and BAdI definitions/implementations |
| `XSLT` | Transformations |
| `NROB` | Number ranges |
| `SUSO`, `SUSC` | Authorization objects and classes |
| `PINF` | Package interfaces |
| `SICF` | ICF services |
| `WDYN` | Web Dynpro components |
| `SPRX` | Proxies |
| `JOBD` | Job definitions |

Choose only types relevant to the request. Use `[]` only when the user explicitly wants every supported type or has confirmed that no type restriction is intended. Do not guess either a narrow type or an unrestricted type set from an ambiguous request.

### Package optimization

- With **Include subpackages off**, package patterns are sent directly to SAP. A pattern such as `ZMD*` becomes SQL `LIKE 'ZMD%'`; an exact package also works through `LIKE` without broadening the match. This normally means one scoped TADIR query per system.
- With **Include subpackages on**, package hierarchy must first be resolved. Discovery may issue multiple bounded package queries because SAP query length is limited.

Never silently remove package or object-name criteria to make a query succeed. If SAP rejects the query or its scope is too long, report the error and ask for a narrower scope or whether subpackages can be disabled.

## Run Operations

The LM operations intentionally match the webview rather than exposing internal phases.

### Discovery

Run `step: discovery` after criteria are ready. It queries source and target, persists both inventories, and automatically performs the local inventory comparison. One user confirmation covers this combined operation because the comparison adds no SAP calls.

Running discovery again after completion is a deliberate rerun and invalidates downstream comparison and assisted-apply results.

### Inventory comparison

Successful discovery already produces the inventory comparison. Use `step: existenceComparison` only to retry a failed local comparison or explicitly rebuild it from the persisted inventories without querying SAP again. Interpret statuses as follows:

- `both`: potentially eligible for source comparison; container types such as `DEVC` are excluded.
- `source-only`: absent on target; cannot be source-compared by this workflow.
- `target-only`: absent on source; cannot be source-compared.
- `error`: inspect the row/error before continuing.

The comparison contains the union of repository keys from both inventories. A repository key includes program ID, object type, and object name, so objects with the same name but different types remain separate objects. Consequently, the comparison row count normally differs from both discovery counts; it equals `both + source-only + target-only`.

Explicitly rerunning inventory comparison invalidates source selection, downloaded snapshots, source comparison, and assisted-apply artifacts.

### Combined source comparison

Run `step: sourceComparison`. One call performs selection, source/target snapshot downloads, and local source comparison.

Selection rules:

- Omit `objectKeys` to select all source-comparable `both` objects. Container types such as `DEVC` are excluded.
- Supply exact keys such as `R3TR:CLAS:ZCL_EXAMPLE` to select a subset.
- Obtain valid keys from the existence-comparison artifact; never invent them.
- A supplied selection replaces the previous selection.
- An empty `objectKeys` array is rejected.
- Non-`both` keys and excluded container types are rejected.

Concurrency rules:

- `sourceConcurrency` and `targetConcurrency` are optional integers from 1 to 10.
- `verificationConcurrency` is an optional local-only integer from 1 to 128; it does not increase SAP requests.
- They are saved before downloads begin and do not invalidate discovery.
- Use them on the combined source-comparison call, not the criteria-update tool, when the only intent is to tune downloads.
- Higher values may reduce elapsed time but increase SAP/network load. Preserve saved values unless the user asks to tune them or scale warrants a change.

## Selection And Rerun Semantics

This distinction prevents expensive accidental work:

- **New selection**: pass `objectKeys`. This replaces selection and invalidates prior downloaded snapshots, source comparison, and assisted-apply artifacts before rerunning.
- **Resume existing source work**: omit `objectKeys`. This reuses the persisted selection and reusable completed snapshots.
- **Compare all for the first time**: omit `objectKeys`; all comparable objects are selected.

Do not pass the same keys again merely to resume. Supplying keys means “replace selection,” not “continue.”

## Pause, Resume, And Recovery

### Normal resume

- Discovery persists checkpoints. Resume paused/interrupted/failed discovery by running `discovery` again without updating criteria; after discovery completes, the tool automatically attempts the local inventory comparison.
- If discovery is complete but inventory comparison failed, retry `existenceComparison` instead of querying SAP again.
- Source comparison persists selection and completed snapshots. Resume by running combined `sourceComparison` without `objectKeys`.
- The webview presents corresponding Resume actions for paused work.
- If a run tool returns `outcome: paused-by-user`, the operation did start and was then paused from the webview. Report that interruption plainly; do not reinterpret the paused final state as evidence that resume never started.

### Do not reset accidentally

Updating criteria is not a resume mechanism. It clears discovery and every derived artifact, even when values appear unchanged.

### Intentional clean reset

Re-save the same criteria only when a clean reset is genuinely required, for example:

- persisted checkpoints were created by an incompatible earlier discovery strategy;
- artifacts are known to be stale or inconsistent;
- the user explicitly wants discovery restarted from scratch.

Explain that this invalidates existing results and requires confirmation. After resetting, rerun discovery rather than calling it a resume.

### Failure diagnosis

1. Read state for the failed `step` only.
2. Report its `lastError` exactly.
3. If row-level evidence is needed, read only the relevant artifact with filters.
4. Retry without changing criteria/selection when artifacts are reusable.
5. Reset criteria only when evidence indicates persisted discovery data must be discarded.

Never claim success from a tool invocation alone; inspect its compact result for `runState`, `completedStep`, and `lastError`.

## Understanding Source Differences

Source comparison is local and non-mutating.

- `identical`: raw snapshots match.
- `different`: at least one resource differs.
- `partial`: one or both snapshots were incomplete.
- `source-missing` / `target-missing`: expected snapshot manifest is absent.
- `error`: comparison could not be completed.

Metrics:

- **Files changed** counts added, removed, or content-changed resource files.
- **Lines added** and **Lines removed** are textual additions/deletions.
- **Lines changed** pairs replacement blocks.

Large ABAP method reordering can appear as large remove/add blocks. Prefer the Diff action for semantic review; counts summarize textual changes and do not prove behavioral impact.

## Assisted Apply

Assisted apply is a user-controlled bridge between repository comparison and the normal ABAP editor save and activation flow. It is intentionally not an automated deployment mechanism: there is no bulk apply, automatic SAP write, automatic transport choice, or automatic activation.

Call `abapfs_prepare_repository_assisted_apply` only after source comparison and only when the user asks for it. The tool prepares a local review plan and refreshes the webview. Preparing or refreshing the plan does not change SAP.

Interpret plan decisions:

- **Ready**: source differs from target and all safety checks passed.
- **No action**: source and target are already identical.
- **Blocked**: one or more safety checks failed; inspect `blockingReasons`.

Common blocking reasons include incomplete snapshots, resource topology differences, generated objects, standard objects, object-type mismatch, or a source status other than `different`.

Plan preparation can be repeated after a new source comparison. Always state the direction clearly and explain that each approved source is handled separately.

### How the user applies one object

Guide the user through this sequence:

1. **Review Live source.** This opens the current object on the source SAP system so the user can confirm where the proposed content originated.
2. **Review Live target.** This opens the current object on the target SAP system so the user can understand the destination and notice changes made after comparison.
3. **Review Diff.** This compares the source snapshot used by the plan with the current target content. The snapshot makes the proposal stable enough to review; the live target side exposes recent target changes.
4. **Stage in target editor.** The user clicks this action. The workflow verifies that the reviewed source snapshot and target still match the plan, then replaces the target editor's in-memory text. The editor remains dirty.
5. **Review the dirty editor.** The user checks the complete staged result, including related includes or components. Staging is not approval and is not a SAP write.
6. **Save manually.** The user uses the normal editor save flow and chooses or confirms the appropriate transport when SAP asks.
7. **Activate manually.** The user activates the object and any related staged components together through the existing activation UI, then resolves any syntax or dependency errors.

For multi-file objects, explain that the user may need to repeat review and staging for each relevant resource before saving and activating the complete object. Do not imply that staging one file completes the object.

### Safety checks and stale-plan protection

Staging is available only when all of these conditions hold:

1. The plan item is eligible and has a source difference that can be represented safely.
2. ABAP-effective `files.autoSave` is `off`, so a dirty target editor cannot be saved automatically.
3. `chat.saveBeforeSend` is `false`, so sending a Copilot message cannot save staged editors.
4. The source snapshot still matches the content reviewed when the plan was prepared.
5. The target still matches the reviewed target snapshot.

If either content check fails, tell the user not to force the old proposal through. Rerun source comparison, prepare a fresh assisted-apply plan, and review the new diff. If an editor setting blocks staging, use the webview's settings link, change the setting, and return to the plan.

### Copilot's boundary

LM tools can prepare, inspect, and explain the assisted-apply plan. They cannot click Stage, edit the target buffer through this workflow, save, choose a transport, or activate. Those actions remain explicit user decisions in the webview and ABAP editor.

Never bypass or weaken the safeguards. “Plan prepared” means only that review choices are available. “Source staged” means only that an unsaved target editor is dirty. Say that SAP changes only when the user has completed the normal save flow, and do not claim successful activation without evidence.

## Webview Coordination

Workflow-changing LM tools open or focus the Repository Comparison Workflow webview before changing state. This ensures the user can see the selected workflow, progress, and results rather than receiving silent background changes. If the webview is already open on that workflow, this is effectively a refresh/focus operation.

Read-only list and inspection tools do not open the webview.

During workflow changes:

- creating a workflow selects and displays it;
- criteria updates refresh immediately;
- LM-run progress and completion refresh automatically;
- assisted-apply plan preparation refreshes automatically.

Tell the user to watch the webview when demonstrating LM tools. Do not separately call the open tool before a workflow-changing tool; the changing tool handles this itself. Use the open tool directly only when the user wants to view or focus a workflow without changing it.

The webview and LM tools share persisted state. A user can pause or change selection while Copilot is working; honor the newest state and re-read the relevant step before continuing after an interruption.

## Efficient End-To-End Recipes

These recipes are sequencing references, not permission to advance automatically. Run the listed stages only when the user explicitly requested the corresponding sequence.

### New comparison

1. Create workflow.
2. Update criteria.
3. Run discovery, which automatically compares the persisted inventories.
4. Read only the existence artifact if a subset must be chosen.
5. Run combined source comparison, optionally with keys/concurrency.
6. Read summaries or source artifact only if analysis is requested.
7. Prepare an assisted-apply plan only when requested.
8. Stop for human review.

### Continue an existing workflow

1. List workflows if the ID is unknown.
2. Read state only, optionally one step.
3. Run the operation indicated by `currentStep` when prerequisites are complete.
4. For paused source work, omit object keys to preserve selection/snapshots.

### Explain a result

1. Read summaries first.
2. Read only the relevant artifact if summaries are insufficient.
3. Filter by status/object and keep the page bounded.
4. Distinguish observation from interpretation; include blocking/error text verbatim.

### Copy an old workflow's scope into a new workflow

1. Read old criteria only.
2. Create the new workflow.
3. Update the new workflow with supported copied fields.
4. Stop before discovery if the user asked only to demonstrate UI refresh.

## Safety Checklist

- Verify workflow ID instead of relying on name alone.
- Verify source and target direction before assisted-apply planning.
- Do not broaden discovery to work around an error.
- Do not update criteria merely to resume.
- Do not resend object keys merely to resume source comparison.
- Do not select source-only, target-only, or excluded container objects such as `DEVC`.
- Do not describe identical objects as blocked; they need no action.
- Do not treat diff counts as semantic ABAP correctness.
- Do not claim SAP changes from discovery, comparison, or plan preparation.
- After plan preparation, explain the review, staging, manual save, and manual activation sequence.