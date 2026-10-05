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

You (GitHub Copilot in VS Code) create and edit workbooks with your notebook tools. Follow these rules exactly:

1. **Create the whole workbook in ONE `create_file` call**, inside the workspace. Write the cells in your own notebook cell format, NOT the on-disk JSON shown under *File Format* (on-disk JSON written this way ends up as empty or Python cells):

   ```xml
   <VSCode.Cell language="markdown">
   # Title
   What the workbook does.
   </VSCode.Cell>
   <VSCode.Cell language="abap-sql">
   SELECT mandt, mtext FROM t000
   </VSCode.Cell>
   <VSCode.Cell language="javascript">
   return cells[1].result.length
   </VSCode.Cell>
   ```

   The JSON form with `cell_type`, `metadata.language` and `source` also works. Languages are exactly `abap-sql` (NOT `sql`), `javascript` and `markdown`.

2. **Read the workbook back** with your notebook read tool and check that every cell is there, with its content and the right language. A file that is valid but has empty cells, missing cells or Python cells is a failure: fix it before you tell the user it is done.

3. **Set systems, row limits and names with `abapfs_workbook_cell_settings`** (see below), in one call, after all cells exist.

4. **One edit at a time.** Wait for each notebook edit to finish before you start the next; never run edits in parallel (for example inserting a query while changing another cell fails). Read the workbook back after a series of edits.

5. **Never rewrite an existing workbook** (no `create_file` over it, no replacing all cells, no converting it with a generic notebook writer). Notebook tools cannot carry a cell's `name`, `system` or `maxRows`, so a rewrite silently deletes them. Change only the cells that need changing, one at a time.

## Cell Names, Systems and Row Limits

These are stored with each cell. Your notebook tools can neither see nor set them; the **`abapfs_workbook_cell_settings`** tool does both.

**Read** the current settings: pass only `filePath`. You get one line per cell: index, language, name, own or inherited system (and whether it is connected), row limit and first line. Do this before changing an existing workbook, and whenever you are unsure which index a cell has.

**Change** settings: pass `filePath` and `cells`, one entry per cell, with `index` (0-based, counting markdown cells: the N of `cells[N]`) and at least one of:

| Field | Effect |
|---|---|
| `system` | System marker: this ABAP SQL cell and every following SQL cell run on that connection id, until the next marker. SQL cells only. |
| `clearSystem: true` | Remove the marker; the cell inherits the marker above. |
| `maxRows` | Row limit of this ABAP SQL cell, 1 to 100000. Leave it out unless the user needs more than 1000 rows. |
| `name` | Cell name (letters, digits, `_`, unique); other cells can then use `cells.<name>`. |
| `clearName: true` | Remove the name. |

```json
{
  "filePath": "C:/work/workbooks/clients.sapwb",
  "cells": [
    { "index": 1, "system": "SYS1" },
    { "index": 2, "system": "SYS2" },
    { "index": 3, "system": "SYS3", "maxRows": 5000 }
  ]
}
```

Rules:
- Make **one call with all settings, after the last cell insert or move**: indexes shift when cells move. If cells moved, read the settings again first.
- If the tool returns an error, **nothing was changed**: fix every listed problem and call it again.
- Pass on its **warnings** to the user: a system that is not connected must be connected before Run All; cells that still reference a renamed cell must be updated.
- Use connection ids from `abapfs_get_connected_systems`, or exactly what the user named.
- **Reference earlier cells by position** (`cells[N]`) when you write the cells. Name cells only when the user asks or the workbook will be edited a lot; once a cell has a name, `cells.<name>` keeps working when cells move.
- If `abapfs_workbook_cell_settings` is not available, tell the user what to set instead, as a short list at the end of your answer: *"Click the system in the status bar of cell #1 and pick SYS1, cell #2 → SYS2"*, *"Click `Rows: 1000` on cell #2 and set 50000"*.

## File Format

For reference (reading a `.sapwb` file, or tools that write plain files and have no notebook tools), `.sapwb` files are JSON on disk:

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

Cell properties: `type`, `content`, and optionally `maxRows`, `name` and `system` (ABAP SQL cells only). If you are GitHub Copilot in VS Code, do not write this format: use the cell format under *How to Create the File*.

## Critical Rules

1. **Get ABAP SQL syntax.** Call `abapfs_get_sql_syntax` before writing SQL cells. ABAP SQL differs from standard SQL (tilde for table~field, no semicolons, etc.).

2. **Cell types are exactly:** `"abap-sql"`, `"javascript"`, or `"markdown"`. No other values.

3. **SQL cells** execute ABAP SQL via ADT. Only SELECT and WITH are allowed. No DML. No semicolons. No comments containing `${...}`.

4. **Cell references:** `cells[N]` is 0-based and counts markdown cells. A named cell (`"name"` in the file, `#n · name` in the status bar) can also be referenced as `cells.<name>` and keeps working when cells move. Names are letters, digits and `_`, start with a letter or `_`, and are unique.

5. **JavaScript cells** run in an isolated worker thread. They read earlier results via `cells[N].result` (or `cells.<name>.result` for named cells):
   - Write references literally (`cells[3]`, `cells.materials`). The engine scans the code for them and only passes those results, so `cells[someVar]` receives nothing.
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

7. **SQL interpolation:** SQL cells reference previous results with `${cells[N].result.path}` (or `${cells.<name>.result.path}`). This resolves before execution.
   - **Strings are single-quoted automatically — do NOT add your own quotes.**
   - Arrays are joined with commas (each element auto-quoted). Numbers are inserted bare.
   - The path must start with `.FIELD` after `.result`. Publish named keys on the returned array (`out.FIRST = ...`) instead of using `result[0].X`.

8. **SAP 255-character SQL literal limit.** SAP ADT rejects any SQL where a single literal exceeds 255 characters. This means interpolating large arrays into `IN (...)` clauses WILL FAIL. **Never interpolate arrays that could have more than ~10 values into SQL.** Use a sub-query or filter in a JavaScript cell instead.

9. **Row limit** per SQL cell: 1000 by default; set `maxRows` with `abapfs_workbook_cell_settings` (see above). The table shows the first 200 rows (`display.table` `limit` up to 5000); later cells and exports receive all rows.

10. **Several SAP systems:** a system marker on an ABAP SQL cell applies to it and every following SQL cell, until the next marker. JavaScript and markdown cells have no system.
    - Use one SQL cell per system (repeat the query) and set each cell's system with `abapfs_workbook_cell_settings` (see above).
    - Run All shows the plan once (e.g. *Cells 3-22 -> dev, 24-47 -> qas*) and offers to map markers that are not connected.
    - When comparing systems, check `cells[1].system !== cells[3].system` and say so in the output if the queries ran on the same system.

11. **Start every workbook with a markdown cell** explaining what it does and, if relevant, which cell runs on which system.

12. **File path:** Write to the user's workspace root or a `workbooks/` subfolder.

13. **Tell the user about the toolbar:** **Export…** (data / code / comments to PDF, HTML, JSON, XML, Excel, CSV, Word or Markdown), collapse/expand all code or outputs, and the run plan.
    - In exported files, SQL and JavaScript cells and `display.json` / `display.xml` outputs appear as labelled, syntax-highlighted code blocks; JSON/XML are written exactly as produced.
    - Tables, strings, HTML and markdown appear as normal content.
    - Every output of `display.all(...)` is exported.

## Cell Referencing Examples

```javascript
// Access SQL results (array of row objects)
const allRows = cells[1].result;                     // full array
const value = cells[1].result[0].MATNR;              // specific field
const ranOn = cells[1].system;                       // SAP system the query ran on

// Access JS cell results
const count = cells[2].result;                       // whatever that cell returned

// Use in SQL interpolation (quotes added automatically for strings — do NOT wrap in quotes)
// "SELECT ... WHERE matnr = ${cells[2].result.FIRST}"
// "SELECT ... WHERE lifnr IN (${cells[2].result.IDS})"  -- arrays auto-join with commas
```

## Example: One Query on Three Systems

*"Get the clients from T000 in SYS1, SYS2 and SYS3, add them up and show them in one table."*

```xml
<VSCode.Cell language="markdown">
# Clients (T000) in SYS1, SYS2 and SYS3
Cells #1, #2 and #3 run the same query on SYS1, SYS2 and SYS3.
</VSCode.Cell>
<VSCode.Cell language="abap-sql">
SELECT mandt, mtext FROM t000
</VSCode.Cell>
<VSCode.Cell language="abap-sql">
SELECT mandt, mtext FROM t000
</VSCode.Cell>
<VSCode.Cell language="abap-sql">
SELECT mandt, mtext FROM t000
</VSCode.Cell>
<VSCode.Cell language="javascript">
// one table with every client, plus the totals
const parts = [cells[1], cells[2], cells[3]];
const rows = parts.flatMap(c => c.result.map(r => ({ System: c.system, Client: r.MANDT, Name: r.MTEXT })));
const systems = new Set(parts.map(c => c.system));
const counts = parts.map(c => c.system + ': ' + c.result.length).join(', ');
const note = systems.size === 3 ? '' : '\n\n**YELLOW:** the queries ran on ' + systems.size + ' system(s) only. Check the systems of cells #1, #2 and #3.';
return display.all(
  display.markdown('## ' + rows.length + ' clients (' + counts + ')' + note),
  display.table(rows, { wrap: true, title: 'Clients per system' })
);
</VSCode.Cell>
```

Then read the workbook back, and set the systems in one call:

```json
{ "filePath": "<path of the workbook>", "cells": [ { "index": 1, "system": "SYS1" }, { "index": 2, "system": "SYS2" }, { "index": 3, "system": "SYS3" } ] }
```

Tell the user the workbook is ready for Run All, and pass on any warning (e.g. a system that is not connected).

## Example: Data Quality Workbook

```xml
<VSCode.Cell language="markdown">
# Material Master Data Quality
Checks for materials missing a unit of measure or material group.
</VSCode.Cell>
<VSCode.Cell language="abap-sql">
SELECT matnr, mtart, matkl, meins FROM mara WHERE ersda > '20250101'
</VSCode.Cell>
<VSCode.Cell language="javascript">
// one row per check, status in its own column
const m = cells[1].result;
const noUoM = m.filter(r => !r.MEINS || !r.MEINS.trim()).length;
const noGroup = m.filter(r => !r.MATKL || !r.MATKL.trim()).length;
const rows = [
  { Status: m.length ? 'GREEN' : 'YELLOW', Check: 'Materials read', Count: m.length },
  { Status: noUoM ? 'RED' : 'GREEN', Check: 'Missing unit of measure', Count: noUoM },
  { Status: noGroup ? 'YELLOW' : 'GREEN', Check: 'Missing material group', Count: noGroup }
];
const worst = rows.some(r => r.Status === 'RED') ? 'RED' : rows.some(r => r.Status === 'YELLOW') ? 'YELLOW' : 'GREEN';
return display.all(
  display.markdown('## ' + worst + ' — material master quality'),
  display.table(rows, { wrap: true, highlight: true })
);
</VSCode.Cell>
<VSCode.Cell language="markdown">
## Next steps
Use **Export…** in the toolbar to send the results as Excel or PDF.
</VSCode.Cell>
```

If the user needs more than 1000 materials, set `maxRows` on cell #1 with `abapfs_workbook_cell_settings`.
