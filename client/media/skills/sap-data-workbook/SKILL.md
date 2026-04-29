---
name: sap-data-workbook
description: Create SAP Data Workbooks (.sapwb) for SAP data analysis. Use when the user asks to analyze SAP data, create data quality checks, build reports, compare tables, profile data, or any multi-step SAP data exploration. Workbooks have ABAP SQL cells (queries against SAP) and JavaScript cells (process results). They save as files and can be re-run.
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
- Compare data across criteria (e.g., "vendors with vs without recent orders")
- Any task requiring multiple queries where later queries depend on earlier results

## How to Create the File

Mandatory: You MUST follow steps 1→2→3 in order. Do NOT create the file with any cells. Do NOT skip the read-back step.

1. Create the `.sapwb` file with ONLY metadata and an empty cells array: `{"version": 1, "title": "Your Title", "cells": []}`
2. Read the file back to confirm it was created.
3. Now insert ALL cells (including the first markdown cell) using the notebook editing tools. When inserting cells, use language `"abap-sql"` for SQL cells (NOT `"sql"`), `"javascript"` for JS cells, and `"markdown"` for markdown cells.

## File Format

`.sapwb` files are JSON:

```json
{
  "version": 1,
  "title": "Descriptive Title",
  "cells": [
    { "type": "markdown", "content": "# Title\nExplanation" },
    { "type": "abap-sql", "content": "SELECT matnr, mtart FROM mara WHERE mtart = 'FERT'" },
    { "type": "javascript", "content": "const rows = cells[1].result;\nreturn rows.map(r => ({ MATNR: r.MATNR, MTART: r.MTART }));" },
    { "type": "abap-sql", "content": "SELECT matnr, werks FROM marc WHERE matnr = ${cells[2].result[0].MATNR}" }
  ]
}
```

## Critical Rules

1. **Get ABAP SQL syntax.** Call `get_abap_sql_syntax` before writing SQL cells. ABAP SQL differs from standard SQL (tilde for table~field, no semicolons, etc.).

2. **Cell types are exactly:** `"abap-sql"`, `"javascript"`, or `"markdown"`. No other values.

3. **SQL cells** execute ABAP SQL via ADT. Only SELECT and WITH are allowed. No DML. No semicolons.

4. **JavaScript cells** run in an isolated worker thread. They access previous cell results via `cells[N].result`:
   - `cells[N]` is **0-based and includes ALL cells** (markdown, SQL, and JS). A workbook starting with a markdown cell means the first SQL cell is `cells[1]`, not `cells[0]`.
   - SQL cell results are arrays of objects: `[{FIELD1: "val", FIELD2: "val"}, ...]`
   - JS cell results are whatever the cell returns
   - Always end with `return <value>`. A JS cell with no `return` outputs `undefined`. Use `return null` if no value is needed.
   - **Output rendering:** returning an **array of objects** renders as a table (preferred for tabular data). Returning a **plain object with nested arrays** does NOT render as a table. Returning a **string** renders as text. `console.log()` appears as diagnostic output above the result — do not rely on it for primary output.

5. **SQL interpolation:** SQL cells can reference previous results with `${cells[N].result.path}`. This resolves before execution. **Strings are single-quoted automatically — do NOT add your own quotes around interpolation expressions.** Arrays are joined with commas (each element auto-quoted). Numbers are inserted bare.

6. **SAP 255-character SQL literal limit.** SAP ADT rejects any SQL where a single literal exceeds 255 characters. This means interpolating large arrays into `IN (...)` clauses WILL FAIL. **Never interpolate arrays that could have more than ~10 values into SQL.** Instead, use a JavaScript cell to loop in small batches and filter the results programmatically. For example, instead of `SELECT ... WHERE matnr IN (${cells[1].result.ids})`, write a JS cell that takes the full result set and filters it using `cells[1].result`.

7. **maxRows** is optional per SQL cell (default 1000). Set it to however many rows the user needs. This maps directly to ADT's maxRows parameter: `{ "type": "abap-sql", "content": "...", "maxRows": 50000 }`

8. **Start every workbook with a markdown cell** explaining what it does.

9. **File path:** Write to the user's workspace root or a `workbooks/` subfolder.

## Cell Referencing Examples

```javascript
// Access SQL results (array of row objects)
const allRows = cells[1].result;              // full array
const firstRow = cells[1].result[0];          // first row
const value = cells[1].result[0].MATNR;       // specific field

// Access JS cell results
const count = cells[2].result;                // if cell 2 returned a number
const obj = cells[2].result.vendorIds;        // if cell 2 returned an object

// Use in SQL interpolation (quotes added automatically for strings — do NOT wrap in quotes)
// "SELECT ... WHERE matnr = ${cells[2].result}"
// "SELECT ... WHERE lifnr IN (${cells[3].result.ids})"  -- arrays auto-join with commas
```

## Example: Data Quality Workbook

```json
{
  "version": 1,
  "title": "Material Master Data Quality Check",
  "cells": [
    {
      "type": "markdown",
      "content": "# Material Master Data Quality\nChecks for materials missing descriptions, invalid UoM, and orphaned records."
    },
    {
      "type": "abap-sql",
      "content": "SELECT matnr, mtart, matkl, meins FROM mara WHERE ersda > '20250101'"
    },
    {
      "type": "javascript",
      "content": "const materials = cells[1].result;\nconst noUoM = materials.filter(m => !m.MEINS || m.MEINS.trim() === '');\nconst noGroup = materials.filter(m => !m.MATKL || m.MATKL.trim() === '');\nreturn {\n  total: materials.length,\n  missingUoM: noUoM.length,\n  missingGroup: noGroup.length,\n  issues: [...noUoM.slice(0, 10), ...noGroup.slice(0, 10)]\n};"
    },
    {
      "type": "markdown",
      "content": "## Results Summary\nThe JavaScript cell above returns counts and sample issues. Review the output for materials that need attention."
    }
  ]
}
```
