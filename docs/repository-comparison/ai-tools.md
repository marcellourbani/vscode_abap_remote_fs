# Repository Comparison with Copilot

Copilot can create, inspect, configure, and run repository comparison workflows through dedicated ABAP FS language model tools.

You can ask naturally:

- "Create a repository comparison from DEV100 to QAS100."
- "Limit the workflow to package ZDEMO* and classes."
- "Run discovery and compare the inventories."
- "Show me only objects that exist on the source."
- "Compare the selected objects with source download concurrency 4."
- "Prepare an assisted-apply plan and explain what is blocked."

Workflow-changing tools open or focus the Repository Comparison Workflow webview so you can watch progress and review results. Read-only tools do not open it.

## Available tools

| Tool | Purpose |
|---|---|
| `abapfs_list_repository_workflows` | List workflow IDs, systems, current step, status, and last error |
| `abapfs_get_repository_workflow` | Read selected state, criteria, summaries, or one filtered artifact page |
| `abapfs_create_repository_workflow` | Create a persistent workflow for two connected systems |
| `abapfs_update_repository_workflow_criteria` | Change discovery scope and invalidate existing derived results |
| `abapfs_run_repository_workflow_step` | Run discovery, retry local inventory comparison, or run combined source comparison |
| `abapfs_open_repository_workflow` | Open or focus a workflow without changing it |
| `abapfs_prepare_repository_assisted_apply` | Prepare a non-mutating assisted-apply review plan |

## Create and configure

Creation requires two different connected system IDs:

```text
Create a repository comparison from DEV100 to QAS100 named "Demo comparison".
```

Creating the workflow also creates default criteria, but it does not run discovery.

Ask Copilot to update criteria before discovery:

```text
Set package scope to ZDEMO*, include subpackages, and select CLAS and PROG only.
```

Supported criteria include:

- include and exclude object-name patterns;
- package patterns and subpackage expansion;
- object types, namespaces, and authors;
- creation-date range;
- deleted, generated, and `$TMP` inclusion;
- source, target, and local verification concurrency.

Updating criteria clears discovery and every downstream artifact. Copilot asks for confirmation before applying the change.

## Run workflow stages

The run tool accepts three user-facing operations.

### `discovery`

Queries both SAP systems, persists their inventories, and automatically compares inventory presence locally.

```text
Run discovery for the demo comparison.
```

It does not automatically continue into source download or assisted apply unless you explicitly request those stages too.

### `existenceComparison`

Retries or rebuilds only the local inventory comparison from persisted discovery inventories. It does not query SAP again.

```text
Retry the inventory comparison without rerunning discovery.
```

### `sourceComparison`

Performs source selection, verifies reusable snapshots, downloads missing source and target snapshots, then compares them locally.

Omit object keys to select all comparable objects or resume the saved selection:

```text
Resume source comparison using the existing selection.
```

Supply exact keys to replace the selection:

```text
Compare only R3TR:CLAS:ZCL_EXAMPLE.
```

Object keys must come from the existence-comparison artifact. Source-only, target-only, empty, and excluded `DEVC` selections are rejected.

Optional concurrency values:

- `sourceConcurrency`: 1-10 SAP downloads from source;
- `targetConcurrency`: 1-10 SAP downloads from target;
- `verificationConcurrency`: 1-128 local verification tasks.

## Read workflow data efficiently

`abapfs_get_repository_workflow` supports four response sections:

- `state` — complete workflow state or one requested step;
- `criteria` — persisted scope and concurrency;
- `summaries` — compact counts for completed stages;
- `artifact` — one bounded result page.

If no section is requested, the tool returns state only. Ask for the smallest useful response:

```text
Show only the source-comparison summary.
```

```text
Read the sourceDownload step status and last error.
```

Available artifacts:

- `sourceDiscovery`
- `targetDiscovery`
- `existenceComparison`
- `sourceComparison`
- `assistedApplyPlan`

Artifact reads accept `offset` and `limit`, with a maximum page size of 200. They can be filtered by status, object name, object type, and package. Object-name filtering supports `*` and `?`.

Examples:

```text
Show the first 50 source-only classes from the existence comparison.
```

```text
Show source differences for objects matching ZCL_EXAMPLE*.
```

## Assisted apply

Ask Copilot to prepare a plan only after source comparison:

```text
Prepare an assisted-apply plan for the demo comparison.
```

The tool returns ready and blocked counts and opens the webview for review. It does not stage or change SAP code.

Only you can:

- click **Stage in target editor**;
- review the dirty target editor;
- save and choose a transport;
- activate the object and related components.

See [Assisted Apply](assisted-apply.md) for all safeguards and stale-plan checks.

## Pausing and resuming with Copilot

When you ask Copilot to continue an existing workflow, it reuses persisted work:

- discovery continues without re-saving criteria;
- a failed inventory comparison can be retried without querying SAP again;
- source comparison resumes with the saved selection and reusable snapshots;
- completed stages can be inspected without rerunning them.

If you click **Pause** while a Copilot-run operation is active, its result records `outcome: paused-by-user`, `pausedByUser: true`, and the exact current step state. Copilot can therefore tell you that the run started and that your webview action paused it.

If a step fails, ask Copilot to read that step's state and report `lastError` before resetting anything.

## Safety boundaries

Repository Comparison tools keep these actions outside Copilot's control:

- creating a missing target object from a source-only result;
- clicking **Stage in target editor**;
- saving staged content or choosing a transport;
- activating the object or related components.

Criteria changes and expensive stages require explicit confirmation. Discovery, comparison, and plan preparation do not change SAP objects.

