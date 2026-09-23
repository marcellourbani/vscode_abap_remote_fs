# Repository Comparison Technical Reference

## Persistence and lifecycle

Workflows are stored outside the current workspace by default:

```text
~/.abapfs/repository-workflows/
```

Set `abapfs.repositoryWorkflows.root` to use another folder. ABAP FS never automatically archives or deletes workflows.

Each workflow has an isolated folder containing:

```text
workflow.json
criteria.json
events.jsonl
logs/
discovery/
comparison/
sources/
assisted-apply/
exports/
```

The folder contains repository metadata and downloaded source snapshots. Treat it as sensitive development data, secure it appropriately, and do not commit it to source control.

Workflow actions:

- **Duplicate** creates a new workflow with the same systems and criteria, but no discovery or comparison artifacts.
- **Archive** moves the complete workflow folder under the configured root's `archive` folder.
- **Delete** permanently removes the workflow and all local artifacts.

If VS Code closes while a workflow is running, it is marked `interrupted` when the extension starts again. Persisted checkpoints and complete snapshots remain available for resume.

## Settings

| Setting | Default | Purpose |
|---|---:|---|
| `abapfs.repositoryWorkflows.root` | Empty | Storage folder; empty uses `~/.abapfs/repository-workflows` |
| `abapfs.repositoryWorkflows.defaultConcurrency` | `5` | Global default used to initialize both side values for new workflows, from 1 to 10 |

The webview stores per-workflow source download, target download, and local verification concurrency in `criteria.json`.

## Criteria rules

- At least one object-name pattern or package pattern is required.
- Only one include object-name pattern is supported.
- Package patterns `*` and `/*` are rejected.
- `*` matches any characters; `?` matches one character.
- Name and package criteria are combined with AND.
- Exclude-name patterns are applied after inclusion.
- Object type, namespace, and author values are exact, case-insensitive matches.
- Creation dates are inclusive `YYYYMMDD` values.
- Deleted, generated, and `$TMP` objects are excluded unless explicitly included.

With **Include subpackages** off, package patterns are sent directly in a scoped TADIR query. With it on, the package hierarchy is read first and package queries are split into batches that fit the ADT SQL-length limit.

Supported types include programs and includes, classes, interfaces, function groups, Dictionary and CDS objects, RAP behavior and service objects, message classes, transactions, enhancements and BAdIs, transformations, number ranges, authorization objects, package interfaces, ICF services, Web Dynpro components, proxies, and job definitions.

## Inventory comparison

Discovery creates one inventory per side. Existence comparison builds the sorted union of their repository keys:

```text
PGMID:OBJECT_TYPE:OBJECT_NAME
```

It assigns `both`, `source-only`, `target-only`, or `error`.

The comparison is local and normally fast. It runs automatically after successful discovery. Running it explicitly is useful only to retry or rebuild the local phase from saved inventories.

## Selection and filters

Only `both` rows can be source-compared. `DEVC` package containers are additionally excluded because snapshotting a container can recursively duplicate work represented by individual objects.

Header filters support:

- prefix matching by default;
- exact matching when the filter ends with a space;
- `*` and `?` wildcards.

**Select filtered** and **Clear filtered** operate on all rows matching the active filters, not only the rows currently visible in the virtual table.

## Snapshot verification and download

Each selected object gets a source and target snapshot with:

- repository metadata;
- file paths and byte counts;
- raw and normalized SHA-256 hashes;
- completion status and download failures.

Resume has two separate phases:

1. verify all saved source and target snapshots against their manifests;
2. download snapshots that are missing, partial, failed, or locally changed.

Verification concurrency is local-only, defaults to 32, and can be set from 1 to 128. Source and target download concurrency are separate values from 1 to 10 and control SAP/network load.

Progress is persisted at most every 500 milliseconds, with forced updates at pause, phase changes, and completion.

## Source comparison

Snapshot comparison checks:

- raw aggregate hashes;
- normalized aggregate hashes;
- added, removed, and changed resource paths;
- textual line additions, removals, and replacements.

Normalization converts CRLF to LF and removes trailing spaces and tabs before calculating the normalized hash. Raw differences are still reported; normalization is additional information.

Line counts are textual and should not be treated as proof of semantic ABAP changes.

## Invalidation rules

| Action | Invalidated data |
|---|---|
| Save criteria | Discovery and every downstream artifact |
| Rerun completed discovery | Inventory comparison, selection, snapshots, source comparison, assisted-apply plan |
| Explicitly rebuild inventory comparison | Selection, snapshots, source comparison, assisted-apply plan |
| Save a new source selection | Existing snapshots, source comparison, assisted-apply plan |
| Change concurrency only | Nothing; values are saved for the next start or resume |
| Refresh assisted-apply plan | The previous plan only |

## Exports

The webview exports these outputs:

- source inventory;
- target inventory;
- inventory comparison;
- source comparison.

XLSX is used while the result fits Excel's row limit. Larger results are offered as CSV. Exported inventories and comparisons may contain object names, packages, authors, system metadata, and source hashes; handle them as sensitive system information.

## Copilot tools

Repository workflows are also available to Copilot:

See [Repository Comparison with Copilot](ai-tools.md) for prompts, stage semantics, bounded artifact reads, and safety guidance.

| Tool | Purpose |
|---|---|
| `abapfs_list_repository_workflows` | List workflow IDs and compact status |
| `abapfs_get_repository_workflow` | Read state, criteria, summaries, or one paged artifact |
| `abapfs_create_repository_workflow` | Create a workflow for two connected systems |
| `abapfs_update_repository_workflow_criteria` | Update scope and invalidate derived results |
| `abapfs_run_repository_workflow_step` | Run discovery, retry inventory comparison, or run combined source comparison |
| `abapfs_open_repository_workflow` | Open or focus the webview |
| `abapfs_prepare_repository_assisted_apply` | Prepare a non-mutating assisted-apply plan |

Artifact reads are limited to 200 rows per request and can be filtered by status, object name, object type, and package. Object-name filtering supports `*` and `?`.

Workflow-changing tools open or focus the webview so progress and results remain visible. Read-only inspection tools do not.

## Limits and safety boundaries

- Source-only objects cannot be created on the target.
- Packages cannot be selected for source comparison.
- Assisted apply cannot add or remove resource files.
- Generated and standard objects are blocked from assisted apply.
- Staging supports reviewed text resources only.
- There is no bulk stage, automatic save, automatic transport choice, or automatic activation.

