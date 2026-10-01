---
name: sap-data-workbook
description: Create SAP Data Workbooks (.sapwb) for SAP data analysis. Use when the user asks to analyze SAP data, create data quality checks, build reports, compare tables or systems, profile data, or any multi-step SAP data exploration. Workbooks have ABAP SQL cells (queries against SAP) and JavaScript cells (process and display results). Cells can be named, can run on different SAP systems, can show formatted tables/markdown/html/json/xml, and the workbook can be exported. They save as files and can be re-run.
argument-hint: '[what data to analyze or report to build]'
user-invocable: true
disable-model-invocation: false
---

# SAP Data Workbook — SAP Data Analysis Made Reproducible

You create `.sapwb` files — VS Code notebooks with ABAP SQL and JavaScript cells that query SAP and process results. The user opens the file and clicks "Run All."

## When To Create a Workbook

Create a workbook when the user wants to:
- Analyze SAP data (multi-table, aggregations, comparisons)
- Build a data quality check or report
- Profile table data (row counts, distributions, outliers)
- Compare data across criteria (e.g., "vendors with vs without recent orders") or **across SAP systems** (e.g., DEV vs QAS)
- Any task requiring multiple queries where later queries depend on earlier results

## How to Create the File

Pick one of the two ways:

**A. Notebook tools (default).** Mandatory: follow steps 1→2→3 in order.
1. Create the `.sapwb` file with ONLY metadata and an empty cells array: `{"version": 1, "title": "Your Title", "cells": []}`
2. Read the file back to confirm it was created.
3. Insert ALL cells (including the first markdown cell) using the notebook editing tools. Use language `"abap-sql"` for SQL cells (NOT `"sql"`), `"javascript"` for JS cells, and `"markdown"` for markdown cells.

**B. Complete JSON.** Use this when cells need a `name` or `system` (see below) and your notebook tools cannot set cell metadata. Write the whole file in one go **to a file that is not open in an editor**, then read it back and check that it parses as JSON.

## File Format

`.sapwb` files are JSON:

```json
{
  "version": 1,
  "title": "Descriptive Title",
  "cells": [
    { "type": "markdown", "content": "# Title\nExplanation" },
    { "type": "abap-sql", "content": "SELECT matnr, mtart FROM mara WHERE mtart = 'FERT'", "name": "materials" },
    { "type": "javascript", "content": "// first finished material\nconst rows = cells.materials.result;\nconst out = rows.map(r => ({ MATNR: r.MATNR, MTART: r.MTART }));\nout.FIRST = rows.length ? rows[0].MATNR : '';\nreturn out;", "name": "fert" },
    { "type": "abap-sql", "content": "SELECT matnr, werks FROM marc WHERE matnr = ${cells.fert.result.FIRST}", "name": "plants" }
  ]
}
```

Cell properties: `type`, `content`, and optionally `maxRows`, `name` and `system`.

## Critical Rules

1. **Get ABAP SQL syntax.** Call `abapfs_get_sql_syntax` before writing SQL cells. ABAP SQL differs from standard SQL (tilde for table~field, no semicolons, etc.).

2. **Cell types are exactly:** `"abap-sql"`, `"javascript"`, or `"markdown"`. No other values.

3. **SQL cells** execute ABAP SQL via ADT. Only SELECT and WITH are allowed. No DML. No semicolons. No comments containing `${...}`.

4. **Name the cells other cells read** (`"name": "materials"`): letters, digits and `_`, starting with a letter or `_`, unique in the workbook. Names keep working when cells are inserted, moved or deleted. Numeric references (`cells[3]`) also work, but they are **0-based, count markdown cells**, and break when cells move.

5. **JavaScript cells** run in an isolated worker thread. They read earlier results via `cells.<name>.result` (also `cells["name"]` or `cells[N]`):
   - Write references literally (`cells.materials`). The engine scans the code for them and only passes those results, so `cells[someVar]` receives nothing.
   - SQL cell results are arrays of objects with UPPERCASE keys: `[{FIELD1: "val", FIELD2: "val"}, ...]`. Date fields arrive as JS `Date` objects.
   - Each entry also has `.system` (the SAP system an SQL cell ran on), `.index` and `.name`.
   - Always end with `return <value>`. A JS cell with no `return` outputs `undefined`. Use `return null` if no value is needed.
   - Errors are shown in the cell output, and a failing cell stops the run.

6. **Formatted output.** A JS cell can return:
   - `display.table(rows, { wrap: true, highlight: true, title: "...", limit: 2000 })` — a table that wraps long values and colours cells whose whole value is RED/FAIL/ERROR, YELLOW/WARN, GREEN/PASS/OK or INFO.
   - `display.markdown(text)`, `display.html(html)`, `display.json(value)`, `display.xml(valueOrXmlString)`, `display.text(str)`.
   - `display.all(a, b, ...)` — several outputs in one cell, e.g. a markdown verdict above a summary table.
   - Pass `{ data: x }` in the options to choose what later cells receive; by default a table passes its rows.

   Returning a plain **array of objects** still renders as a table. A plain object renders as JSON text, a string as text. Keep the status word (RED/YELLOW/GREEN) in its own column, one finding per row, and do not truncate values: tables wrap.

7. **SQL interpolation:** SQL cells reference previous results with `${cells.<name>.result.path}` (or `${cells[N].result.path}`). This resolves before execution.
   - **Strings are single-quoted automatically — do NOT add your own quotes.**
   - Arrays are joined with commas (each element auto-quoted). Numbers are inserted bare.
   - The path must start with `.FIELD` after `.result`. Publish named keys on the returned array (`out.FIRST = ...`) instead of using `result[0].X`.

8. **SAP 255-character SQL literal limit.** SAP ADT rejects any SQL where a single literal exceeds 255 characters. This means interpolating large arrays into `IN (...)` clauses WILL FAIL. **Never interpolate arrays that could have more than ~10 values into SQL.** Use a sub-query or filter in a JavaScript cell instead.

9. **maxRows** is optional per SQL cell (default 1000): `{ "type": "abap-sql", "content": "...", "maxRows": 50000 }`. The table shows the first 200 rows (`display.table` `limit` up to 5000); later cells and exports receive all rows.

10. **Several SAP systems:** a cell with `"system": "<ABAP FS connection id>"` is a marker. It and every following cell run on that system, until the next marker.
    - Put markers on section-header markdown cells.
    - Run All shows the plan once (e.g. *Cells 3-22 -> dev, 24-47 -> qas*) and offers to map markers that are not connected.
    - Cells before the first marker ask for a system as before.
    - When comparing systems, check `cells.a.system !== cells.b.system`.

11. **Start every workbook with a markdown cell** explaining what it does and, if relevant, which systems it uses.

12. **File path:** Write to the user's workspace root or a `workbooks/` subfolder.

13. **Tell the user about the toolbar:** **Export…** (data / code / comments to PDF, HTML, JSON, XML, Excel, CSV, Word or Markdown), collapse/expand all code or outputs, and the run plan.
    - In exported files, SQL and JavaScript cells and `display.json` / `display.xml` outputs appear as labelled, syntax-highlighted code blocks; JSON/XML are written exactly as produced.
    - Tables, strings, HTML and markdown appear as normal content.
    - Every output of `display.all(...)` is exported.

## Cell Referencing Examples

```javascript
// Access SQL results (array of row objects)
const allRows = cells.materials.result;              // full array
const value = cells.materials.result[0].MATNR;       // specific field
const ranOn = cells.materials.system;                // SAP system the query ran on

// Access JS cell results
const count = cells.summary.result;                  // whatever that cell returned

// Use in SQL interpolation (quotes added automatically for strings — do NOT wrap in quotes)
// "SELECT ... WHERE matnr = ${cells.fert.result.FIRST}"
// "SELECT ... WHERE lifnr IN (${cells.vendors.result.IDS})"  -- arrays auto-join with commas
```

## Example: Data Quality Workbook

```json
{
  "version": 1,
  "title": "Material Master Data Quality Check",
  "cells": [
    {
      "type": "markdown",
      "content": "# Material Master Data Quality\nChecks for materials missing a unit of measure or material group."
    },
    {
      "type": "abap-sql",
      "content": "SELECT matnr, mtart, matkl, meins FROM mara WHERE ersda > '20250101'",
      "name": "materials",
      "maxRows": 20000
    },
    {
      "type": "javascript",
      "name": "quality",
      "content": "// one row per check, status in its own column\nconst m = cells.materials.result;\nconst noUoM = m.filter(r => !r.MEINS || !r.MEINS.trim()).length;\nconst noGroup = m.filter(r => !r.MATKL || !r.MATKL.trim()).length;\nconst rows = [\n  { Status: m.length ? 'GREEN' : 'YELLOW', Check: 'Materials read', Count: m.length },\n  { Status: noUoM ? 'RED' : 'GREEN', Check: 'Missing unit of measure', Count: noUoM },\n  { Status: noGroup ? 'YELLOW' : 'GREEN', Check: 'Missing material group', Count: noGroup }\n];\nconst worst = rows.some(r => r.Status === 'RED') ? 'RED' : rows.some(r => r.Status === 'YELLOW') ? 'YELLOW' : 'GREEN';\nreturn display.all(\n  display.markdown('## ' + worst + ' — material master quality'),\n  display.table(rows, { wrap: true, highlight: true })\n);"
    },
    {
      "type": "markdown",
      "content": "## Next steps\nUse **Export…** in the toolbar to send the results as Excel or PDF."
    }
  ]
}
```
