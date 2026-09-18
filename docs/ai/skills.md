# AI Skills

Skills are built-in "cheat sheets" that Copilot reads automatically when your question or task matches their domain. They contain ABAP-specific knowledge — coding standards, performance rules, SAP navigation techniques — so you don't have to explain that context yourself.

Copilot only loads a skill's full content when relevant, so having many skills does not slow down unrelated conversations.

> **Availability:** ABAP FS skills are enabled only while at least one SAP system is connected. Before the first connection, they do not appear as slash commands and are not loaded automatically. Connect using **ABAP FS: Connect to an SAP system** to make them available.

Use **ABAP FS: Configure ABAP FS Skills** to control the general skills individually. They are all enabled by default; untick any skills you do not want Copilot to discover and choose **Save**. SAP Testing skills are managed separately and remain an all-or-nothing feature controlled by the SAP testing folder.

## Using Skills

**Automatic:** Skills load on their own when Copilot detects a match. Nothing to do.

**Manual:** Type `/` in the Copilot Chat input to see all skills as slash commands. Select one to invoke it explicitly, for example:

- `/clean-abap review this method`
- `/abap-research find the transaction for this screen`

## Available Skills

| Skill | Slash command | When it loads |
|---|---|---|
| [Clean ABAP](#clean-abap) | `/clean-abap` | Clean ABAP style, readability, and maintainability |
| [ABAP Code Review Helper](#abap-code-review-helper) | `/abap-code-review-helper` | Correctness, runtime-safety, security, and performance review |
| [Code Writing Process](#code-writing-process) | `/abap-code-writing` | Building any ABAP solution |
| [Performance (ECC)](#performance-ecc) | `/abap-performance-ecc` | Non-HANA systems (Oracle, DB2, MSSQL) |
| [Performance (HANA)](#performance-hana) | `/abap-performance-hana` | S/4HANA / HANA DB systems |
| [SAP Research](#sap-research) | `/abap-research` | Searching for objects, transactions, messages |
| [System Personality Report](#system-personality-report) | `/sap-system-personality-report` | Analyzing a system's custom code landscape |
| [SAP Customizing](#sap-customizing) | `/sap-customizing` | SPRO/IMG settings and configuration tables |
| [SAP Data Workbook](#sap-data-workbook) | `/sap-data-workbook` | Multi-step SAP data analysis |

---

### Clean ABAP

SAP's official [Clean ABAP Style Guide](https://github.com/SAP/styleguides) condensed into AI-optimized rules. Use it for style, readability, naming, modern syntax, structure, formatting, and maintainability. For a general report correctness review, use the ABAP Code Review Helper first.

### ABAP Code Review Helper

The primary review guidance for ABAP reports and other objects. It focuses on reachable correctness and runtime defects such as wrong results, dumps, unsafe database access, lost updates, locking issues, security risks, and performance problems. It reports supported findings rather than lists of passed checks; use Clean ABAP separately for style-focused findings.

### Code Writing Process

A structured process for building ABAP solutions: validate requirements → explore the system → plan architecture → research existing objects → design → write code. Prevents the AI from guessing at parameters or reimplementing standard SAP functionality that already exists.

### Performance (ECC)

Performance patterns for traditional databases (Oracle, DB2, MSSQL, MaxDB). Covers simple SQL, buffering, index usage, and internal table optimization. Copilot checks the system type automatically and loads this skill only on non-HANA systems.

### Performance (HANA)

Performance patterns for S/4HANA. Covers code pushdown, CDS views, AMDP, and complex SQL aggregations. Copilot checks the system type automatically and loads this skill only on HANA-based systems.

### SAP Research

Teaches Copilot to find anything in an unfamiliar SAP system — the way a senior developer would. Covers which metadata tables to query for what (TSTCT for transactions, T100 for messages, TADIR for all objects, DD03L for table fields), wildcard strategies, package clustering, and tracing error messages back to code.

### System Personality Report

Generates a structured overview of any connected SAP system: number of custom objects, most-developed business areas, recent dump activity, and more. Useful for quickly understanding an unfamiliar system.

### SAP Customizing

Teaches Copilot to navigate SPRO/IMG configuration. Uses systematic lookup procedures to trace from an SPRO activity to its storage tables (via `CUS_IMGACH`, `CUS_ACTH`, `CUS_ACTOBJ`), reverse-look up tables to their SPRO path, and resolve domain fixed values (`DD07T`).

### SAP Data Workbook

Teaches Copilot to create `.sapwb` files — VS Code notebooks combining ABAP SQL and JavaScript cells for multi-step SAP data analysis. See [SAP Data Workbooks](../data-query/data-workbooks.md) for details on the workbook feature itself.

## Skill settings

Skill availability is stored at user level in `abapfs.skills.enabledSkills`. A missing skill entry means enabled; the panel writes `false` for skills that you untick. The setting affects general ABAP FS skills only. Testing skills continue to use the SAP Testing feature gate and are not listed in the general skills panel.
