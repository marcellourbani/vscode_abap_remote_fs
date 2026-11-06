# Repository Usage Analysis

Repository Usage Analysis helps you review which ABAP repository objects have evidence of use and which still need investigation. It combines an object inventory, workload and job evidence, and relationships between objects in one saved analysis.

Use it to prepare a custom-code review, focus an application cleanup discussion, assess the coverage of available usage extracts, or produce a review list for application owners.

It is a read-only analysis. It does not change, activate, transport, or delete SAP objects.

## What the results mean

| Status | Meaning |
|---|---|
| **Used** | The analysis found direct usage evidence, an included released/scheduled job, or a relationship from another Used object. Read the Reasons column to distinguish them. |
| **Unclear** | The available evidence has not established usage. The object might be unused, outside the period covered by your extracts, dynamically called, ambiguous, or affected by an incomplete lookup. |

!!! warning "Unclear is not approval to delete"
    Missing usage evidence does not prove that an object is unused. Review data retention, infrequent business processes, unresolved issues, dynamic calls, and application-owner knowledge before making a retirement decision.

## How it works

The panel has four stages:

1. **Discovery** lists the objects in your package scope, including individual function modules when their ownership data is available.
2. **ST03N** matches manually uploaded transaction/report and RFC server names to the repository.
3. **Jobs** adds programs found in job history and, optionally, released or scheduled jobs.
4. **Dependencies** follows relationships from Used objects to identify more objects needed by them.

Discovery comes first. ST03N and Jobs can run in either order; you can use either or both. Dependencies needs at least one usable usage match from a completed or partial ST03N/Jobs stage.

The analysis keeps separate reasons from the different evidence sources. A repository key includes the program ID, object type, and object name, so objects sharing a name remain separate inventory rows.

## Open the feature

Open the Command Palette (`Ctrl+Shift+P`) and run:

**ABAP FS: Repository Usage Analysis**

Choose **Create analysis**, enter a name, and start with Discovery. Use the saved-analysis list or selector to return to an existing review. Each stage has a **Guide** button with its data preparation and control instructions.

No AI setup is required to run the analysis.

## Choose the right systems

You do not have to connect production itself. You can upload production exports and use a matching production copy for repository matching and dependency checks.

| System | Purpose |
|---|---|
| **Repository system** | Connected Discovery and lookup of transaction/program and function-module ownership information. It must be connected when processing ST03N or Jobs, even when those inputs are uploaded. |
| **Job system** | Supplies job history when Jobs uses **Connected system**. Its job history must represent the workload you are reviewing. |
| **Dependency system** | Supplies code relationships and where-used results. Its objects and code should match the landscape under review. |

A QA system with matching code can be useful for dependency checks, but its own job history is not production usage history. Check both code alignment and evidence provenance before interpreting results.

## Saved analyses and data handling

Analyses and uploaded files are stored locally under `.abapfs/repository-usage` in your home directory. Systems, scope, progress, evidence, cached checks, and table choices are saved so you can continue later.

Exports are separate review files. Deleting a saved analysis removes its local data, not SAP objects or exports you saved elsewhere. Treat uploads, saved analyses, and exports as SAP business/development data and apply your organization's access and retention rules.

## Where to go next

- [Run an analysis](workflow.md): choose a scope, process evidence, and continue an existing review.
- [Prepare input data](input-data.md): file requirements, ST03N profiles, and job extracts.
- [Run dependency checks](dependencies.md): passes, cache choices, selective retry, and progress.
- [Review and export results](results.md): inventory filters, Issues, dates, and follow-up investigation.