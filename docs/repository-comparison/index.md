# Repository Comparison

Repository Comparison gives you a persistent, reviewable way to compare a scoped set of ABAP repository objects across two connected SAP systems.

Use it when you need more than a one-object diff: checking what exists in each system, comparing source for hundreds or thousands of objects, exporting the results, or preparing selected changes for careful manual application.

## What the workflow does

The workflow has three stages:

1. **Scope and discovery** — query both systems for matching TADIR objects and compare the saved inventories locally.
2. **Compare systems** — select objects present on both systems, download source snapshots, and compare them locally.
3. **Assisted apply** — prepare a safety-checked plan and optionally stage one reviewed source file in the target editor.

Discovery, inventory comparison, source comparison, and plan preparation do not modify SAP objects.

!!! warning "Assisted apply is not deployment automation"
    Staging places reviewed source in an unsaved target editor. You still review, save, choose a transport when SAP asks, and activate through the normal ABAP FS flow.

## Prerequisites

- Two different SAP systems connected in the current VS Code window
- A customer object-name or package scope
- Access to query TADIR and read the selected repository objects on both systems

For example, a workflow could compare source `DEV100` with target `QAS100`, limited to package `ZDEMO*` and object types `CLAS`, `PROG`, and `DDLS`.

## Open the workflow

Open the Command Palette (`Ctrl+Shift+P`) and run:

**ABAP FS: Repository Comparison Workflow**

From the start page you can create, open, duplicate, archive, or permanently delete workflows. A workflow keeps its criteria, checkpoints, inventories, snapshots, comparisons, and plans on disk so you can close VS Code and continue later.

## Where to go next

- [Run a comparison](workflow.md) — create a workflow, choose a scope, select objects, and understand the results.
- [Use Repository Comparison with Copilot](ai-tools.md) — dedicated LM tools, efficient reads, examples, and safety boundaries.
- [Use assisted apply safely](assisted-apply.md) — review, stage, save, and activate without bypassing safeguards.
- [Technical reference](technical-reference.md) — criteria, statuses, filtering, concurrency, persistence, exports, and AI tools.

