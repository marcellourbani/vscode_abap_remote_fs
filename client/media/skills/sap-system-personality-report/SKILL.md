---
name: sap-system-personality-report
description: Generate a comprehensive SAP System Personality Report. Analyzes custom code landscape, functional footprint, development activity, health metrics, and package breakdown. Use when a user asks to characterize a system, understand a system, get a system overview, system report, system personality, or "what does this system do?" Collects data via SQL queries and presents results in a structured webview.
argument-hint: '[connectionId of the SAP system to analyze]'
user-invocable: true
disable-model-invocation: false
---

# SAP System Personality Report

Generate a rich, structured report that characterizes an SAP system in human-readable terms. You will collect data by running SQL queries, then present the results in a webview table AND provide a narrative AI summary.

**CRITICAL:** Before running ANY query, call `get_abap_sql_syntax` to understand ABAP SQL syntax. Use `get_object_lines` to check table structures before running SQL queries.

**CRITICAL:** All queries must use ABAP SQL syntax (e.g., `ORDER BY field DESCENDING` not `DESC`). Use the `execute_data_query` tool with `displayMode: "internal"` to collect data, then assemble final results into a `displayMode: "ui"` call.

---

## Step 1: System Identity

Get basic system information first. Use the `get_sap_system_info` tool — it returns system type (S/4HANA vs ECC), release, timezone, and client details. No SQL needed for this step.

---

## Step 2: Custom Code Landscape — Object Counts

Run these queries to count custom objects. Use `displayMode: "internal"` with `rowRange: {start: 0, end: 5}` since we only need counts.

**Run all of these in parallel** (they are independent):

### Classes
```sql
SELECT COUNT(*) AS CNT FROM SEOCLASS WHERE CLSNAME LIKE 'Z%' OR CLSNAME LIKE 'Y%'
```

### Interfaces
**NOTE:** The `SEOINTERF` table does NOT exist in S/4HANA. Use TADIR instead:
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'INTF' AND OBJ_NAME LIKE 'Z%'
```
Then separately for Y:
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'INTF' AND OBJ_NAME LIKE 'Y%'
```
Sum both counts.

### Programs/Reports (by type)
**CRITICAL:** The TRDIR table contains ALL program types (reports, includes, class pools, etc.). Using a raw count is very misleading since includes (SUBC='I') dominate the count. Always break down by SUBC field:

```sql
SELECT SUBC, COUNT(*) AS CNT FROM TRDIR WHERE NAME LIKE 'Z%' OR NAME LIKE 'Y%' GROUP BY SUBC ORDER BY CNT DESCENDING
```

SUBC values: '1'=Executable Reports, 'I'=Includes, 'M'=Module Pools, 'S'=Subroutine Pools, 'K'=Class Pools, 'J'=Interface Pools, 'X'=XSLT Programs.

In the final report, present these as separate line items:
- **Executable Reports** (SUBC='1') — the actual standalone reports
- **Module Pools** (SUBC='M') — dialog programs
- **Includes** (SUBC='I') — sub-objects (generated for classes, FMs, etc.) — show for context but note they are generated
- **Subroutine Pools** (SUBC='S') — standalone subroutine containers

Omit class pools (K) and interface pools (J) from the report since those are already counted under Classes and Interfaces.

### Function Modules
```sql
SELECT COUNT(*) AS CNT FROM TFDIR WHERE FUNCNAME LIKE 'Z%' OR FUNCNAME LIKE 'Y%'
```

### Function Groups
```sql
SELECT COUNT(*) AS CNT FROM TLIBG WHERE AREA LIKE 'Z%' OR AREA LIKE 'Y%'
```

### Database Tables (transparent tables only)
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE TABNAME LIKE 'Z%' AND TABCLASS = 'TRANSP' AND AS4LOCAL = 'A'
```
Then separately for Y:
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE TABNAME LIKE 'Y%' AND TABCLASS = 'TRANSP' AND AS4LOCAL = 'A'
```
Sum both counts.

### Structures
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE TABNAME LIKE 'Z%' AND TABCLASS = 'INTTAB' AND AS4LOCAL = 'A'
```
Then separately for Y and sum.

### Data Elements
```sql
SELECT COUNT(*) AS CNT FROM DD04L WHERE ROLLNAME LIKE 'Z%' AND AS4LOCAL = 'A'
```
Then separately for Y and sum.

### Domains
```sql
SELECT COUNT(*) AS CNT FROM DD01L WHERE DOMNAME LIKE 'Z%' AND AS4LOCAL = 'A'
```
Then separately for Y and sum.

### Table Types
```sql
SELECT COUNT(*) AS CNT FROM DD40L WHERE TYPENAME LIKE 'Z%' AND AS4LOCAL = 'A'
```
Then separately for Y and sum.

### CDS Views
```sql
SELECT COUNT(*) AS CNT FROM DDDDLSRC WHERE DDLNAME LIKE 'Z%'
```
Then separately for Y and sum.

### Message Classes
```sql
SELECT COUNT(*) AS CNT FROM T100A WHERE ARBGB LIKE 'Z%' OR ARBGB LIKE 'Y%'
```

### Custom Transactions
```sql
SELECT COUNT(*) AS CNT FROM TSTC WHERE TCODE LIKE 'Z%' OR TCODE LIKE 'Y%'
```

### Enhancement Implementations (BAdIs)
Shows how heavily the system extends SAP standard:
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'ENHO' AND (OBJ_NAME LIKE 'Z%' OR OBJ_NAME LIKE 'Y%')
```

### Number Range Objects
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'NROB' AND (OBJ_NAME LIKE 'Z%' OR OBJ_NAME LIKE 'Y%')
```

**NOTE:** Some queries may fail on specific systems (missing tables, authorization). If a query fails, record the count as "N/A" and continue with the rest.

---

## Step 3: Package Breakdown

This is the most valuable section. Get object counts per custom package.

**CRITICAL:** The column `OBJECT` is a reserved keyword in ABAP SQL. Do NOT alias it (e.g., `OBJECT AS OBJ_TYPE` will cause a parser error `Unknown column name "O"`). Use the column name `OBJECT` directly without alias.

```sql
SELECT DEVCLASS, OBJECT, COUNT(*) AS OBJ_COUNT
FROM TADIR
WHERE DEVCLASS LIKE 'Z%'
  AND PGMID = 'R3TR'
GROUP BY DEVCLASS, OBJECT
ORDER BY DEVCLASS ASCENDING
```

Use `displayMode: "internal"` with a large enough `rowRange` (start: 0, end: 1000) and `maxRows: 5000`.

Note: We no longer filter by specific OBJECT types in the WHERE clause — instead retrieve all R3TR objects and filter/pivot in post-processing. This avoids issues with long IN() lists and captures all object types.

Then run the same for Y packages:
```sql
SELECT DEVCLASS, OBJECT, COUNT(*) AS OBJ_COUNT
FROM TADIR
WHERE DEVCLASS LIKE 'Y%'
  AND PGMID = 'R3TR'
GROUP BY DEVCLASS, OBJECT
ORDER BY DEVCLASS ASCENDING
```

**Pivot the results** into a table with columns:
| Package | Classes | FMs | Reports | DD Objects | CDS | Interfaces | Other | Total |

Where "DD Objects" = sum of TABL + DTEL + DOMA + TTYP + VIEW + ENQU + SHLP for that package.

Sort by Total descending. Show top 30 packages.

---

## Step 4: Development Timeline & Object Quality

### Oldest and newest custom objects
Shows when custom development started and when the most recent object was created:
```sql
SELECT MIN( CREATED_ON ) AS OLDEST, MAX( CREATED_ON ) AS NEWEST
FROM TADIR
WHERE (OBJ_NAME LIKE 'Z%' OR OBJ_NAME LIKE 'Y%')
  AND PGMID = 'R3TR'
  AND CREATED_ON <> '00000000'
```

### Inactive objects
Objects changed but never activated — a code quality smell:
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE (TABNAME LIKE 'Z%' OR TABNAME LIKE 'Y%') AND AS4LOCAL = 'M'
```
```sql
SELECT COUNT(*) AS CNT FROM DD04L WHERE (ROLLNAME LIKE 'Z%' OR ROLLNAME LIKE 'Y%') AND AS4LOCAL = 'M'
```

`AS4LOCAL = 'M'` means modified/inactive. Sum the counts across DD02L and DD04L for a rough inactive object count. If the count is high relative to active objects, it's a quality concern worth noting.

---

## Step 5: Development Activity (Last 90 Days)

### Active developers and transport counts
```sql
SELECT AS4USER, COUNT(*) AS TR_COUNT
FROM E070
WHERE AS4DATE >= '<CALCULATE: today minus 90 days, format YYYYMMDD>'
  AND STRKORR <> ''
GROUP BY AS4USER
ORDER BY TR_COUNT DESCENDING
```

**Date calculation:** You must compute the date yourself. Today's date minus 90 days, formatted as YYYYMMDD (e.g., 20251205 for Dec 5, 2025). ABAP SQL dates are stored as YYYYMMDD strings.

Use `maxRows: 100`, `rowRange: {start: 0, end: 50}`.

### Total transport count
```sql
SELECT COUNT(*) AS TOTAL
FROM E070
WHERE AS4DATE >= '<90 days ago YYYYMMDD>'
  AND STRKORR <> ''
```

---

## Step 6: System Health (Last 30 Days)

### Dump trend
```sql
SELECT DATUM, COUNT(*) AS DUMP_COUNT
FROM SNAP
WHERE DATUM >= '<CALCULATE: today minus 30 days, format YYYYMMDD>'
GROUP BY DATUM
ORDER BY DATUM ASCENDING
```

### Top dump types
**CRITICAL:** The SNAP table in S/4HANA does NOT have a `FESSION` (or `SEESSION`) field for error type. The S/4HANA SNAP table only contains: `DATUM`, `UZEIT`, `AHOST`, `UNAME`, `MANDT`, `MODNO`, `SEQNO`, `XHOLD`, and `FLIST01-08` (text blobs).

Use the `SNAP_ADT` table instead — it has a structured `RUNTIME_ERROR` field with the error type name:
```sql
SELECT RUNTIME_ERROR, COUNT(*) AS CNT
FROM SNAP_ADT
WHERE DATUM >= '<30 days ago YYYYMMDD>'
GROUP BY RUNTIME_ERROR
ORDER BY CNT DESCENDING
```

Use `maxRows: 20`, `rowRange: {start: 0, end: 10}`.

### Test class count (rough indicator)
```sql
SELECT COUNT(*) AS CNT FROM SEOCLASS WHERE CLSNAME LIKE 'Z%TEST%' OR CLSNAME LIKE 'Y%TEST%' OR CLSNAME LIKE 'ZCL%TEST%' OR CLSNAME LIKE 'ZCL_TEST%'
```

**NOTE:** SNAP table may not be accessible due to authorization. On S/4HANA, the SNAP table has a simplified structure — use `SNAP_ADT` for error type breakdowns instead. If both SNAP and SNAP_ADT queries fail, skip the health section and note "Dump data unavailable — likely authorization restriction."

---

## Step 7: Assemble and Present

### Determine Functional Footprint

From the package breakdown data collected in Step 3, categorize packages by SAP functional area.

**Use your own knowledge to categorize:** Look at package names, their descriptions (if available), and the types of objects they contain. Common patterns:
- SD: sales, order, delivery, billing, pricing, shipping
- MM: material, purchasing, procurement, inventory, vendor
- FI: finance, accounting, payment, bank, tax, invoice
- CO: controlling, cost, profit, overhead
- PP: production, manufacturing, plant, BOM, routing
- QM: quality, inspection, lot
- PM: maintenance, equipment, notification
- WM/EWM: warehouse, storage, bin
- HR/HCM: personnel, payroll, time, absence
- BC/BASIS: tools, utilities, framework, logging, middleware

Group packages into these areas and calculate percentages.

### Build the Final Display

Use `execute_data_query` with `displayMode: "ui"` and `data` parameter (direct data input) to create the final report as a structured table.

Create ONE comprehensive display with these sections as a data table:

**Title:** "System Personality Report: {connectionId}"

Build a summary data table with columns:
| Category | Metric | Value |
|----------|--------|-------|

Rows should include:
- System type, release, timezone
- Development timeline: oldest custom object date → newest custom object date
- Each object type count broken down properly:
  - Executable Reports (SUBC='1'), Module Pools (SUBC='M'), Includes (SUBC='I' — note as "generated/sub-objects"), Subroutine Pools (SUBC='S')
  - Classes, Interfaces, Function Modules, Function Groups
  - DB Tables, Structures, Data Elements, Domains, Table Types, CDS Views, Message Classes
  - Custom Transactions, Enhancement Implementations, Number Range Objects
- Total custom objects (exclude includes and class/interface pools from the total to avoid double-counting)
- Inactive objects count (if > 0, note as quality concern)
- Test class count and coverage %
- Top 5 packages by object count
- Active developers count and top 5 by transport count
- Total transports (90 days)
- Average dumps per day (30 days)
- Top 3 dump types

### AI Narrative Summary

After collecting all data, write a 5-20 sentence narrative paragraph summarizing the system's personality. Include:

1. What kind of company/industry this appears to be (inferred from functional footprint)
2. Scale of custom development and how long it's been going (development timeline)
3. Team size and activity level
4. Code quality indicators (dump rate trend, test coverage, inactive object count)
5. Enhancement footprint — how heavily standard SAP is extended
6. Any notable patterns (heavy CDS adoption = modernization, few tests = risk, one developer doing 50% of work = key-person dependency, many inactive objects = cleanup needed, many custom transactions = heavy user-facing customization)
7. One actionable recommendation

Present this narrative to the user as part of your response text, alongside the data table.

---

## Error Handling

- If a query fails, skip that section and note it in the report. Never let one failed query block the entire report.
- If the system has zero custom objects, say so: "This system has no custom Z/Y development."
- If SNAP is inaccessible, skip health. If E070 is inaccessible, skip activity.
- Always present whatever data you successfully collected.

---

## Performance Notes

- All queries are read-only SELECTs on metadata tables — very lightweight
- Run independent queries in parallel when possible (Steps 2 queries can all run simultaneously)
- Total data collection should take 10-30 seconds depending on system
- Package breakdown (Step 3) is the heaviest query but still fast since it's aggregated
