# AI Skills

Skills are built-in "cheat sheets" that Copilot reads automatically when your question or task matches their domain. They contain ABAP-specific knowledge — coding standards, performance rules, SAP navigation techniques — so you don't have to explain that context yourself.

Copilot only loads a skill's full content when relevant, so having many skills does not slow down unrelated conversations.

## Using Skills

**Automatic:** Skills load on their own when Copilot detects a match. Nothing to do.

**Manual:** Type `/` in the Copilot Chat input to see all skills as slash commands. Select one to invoke it explicitly, for example:

- `/clean-abap review this method`
- `/abap-research find the transaction for this screen`

## Available Skills

| Skill | Slash command | When it loads |
|---|---|---|
| [Clean ABAP](#clean-abap) | `/clean-abap` | Writing or reviewing ABAP code |
| [Code Writing Process](#code-writing-process) | `/abap-code-writing` | Building any ABAP solution |
| [Performance (ECC)](#performance-ecc) | `/abap-performance-ecc` | Non-HANA systems (Oracle, DB2, MSSQL) |
| [Performance (HANA)](#performance-hana) | `/abap-performance-hana` | S/4HANA / HANA DB systems |
| [SAP Research](#sap-research) | `/abap-research` | Searching for objects, transactions, messages |
| [System Personality Report](#system-personality-report) | `/sap-system-personality-report` | Analyzing a system's custom code landscape |
| [SAP Customizing](#sap-customizing) | `/sap-customizing` | SPRO/IMG settings and configuration tables |
| [SAP Data Workbook](#sap-data-workbook) | `/sap-data-workbook` | Multi-step SAP data analysis |

---

### Clean ABAP

SAP's official [Clean ABAP Style Guide](https://github.com/SAP/styleguides) condensed into AI-optimized rules. Covers naming conventions, modern syntax, class/method design, error handling, formatting, and unit testing patterns.

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
