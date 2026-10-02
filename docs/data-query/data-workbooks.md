# SAP Data Workbooks (.sapwb)

SAP Data Workbooks are VS Code notebooks that combine ABAP SQL queries, JavaScript processing, and Markdown in a single reusable `.sapwb` file. Use them for multi-step data analysis, data quality checks, and cross-system comparisons.

## Creating a Workbook

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: New SAP Data Workbook**

Alternatively, create any file with the `.sapwb` extension, or ask Copilot: *"Create a workbook to analyze material master data quality."*

## Cell Types

| Type | Purpose |
|------|---------|
| **Markdown** | Section headers, notes, documentation |
| **ABAP SQL** | Query SAP tables (`SELECT` and `WITH` only — no DML) |
| **JavaScript** | Process, filter, or compare results from earlier cells |

## Key Concepts

**Running cells**

- Run a single cell with the run button or `Shift+Enter`. If the cell has no system (see *System markers*), you are prompted to select a SAP system.
- **Run All** (`Ctrl+Shift+Enter`) uses the system markers. It shows the plan once (e.g. *Cells 3-22 -> dev, Cells 24-47 -> qas*) and runs every SQL cell on its system. SQL cells before the first marker use a system you pick once.
- When a JavaScript cell fails, its error message is shown in the cell output and the following cells are skipped.

**Naming cells**

Click `#n` in a cell's status bar to give it a name (letters, digits and `_`, unique in the workbook). Names are saved in the `.sapwb` file and keep working when cells are inserted, moved or deleted. When you rename a cell, ABAP FS offers to update the references in other cells.

**Referencing results between cells**

- In **JavaScript**: `cells.<name>.result` (also `cells["name"]`, or `cells[N]` by position: 0-based, counting markdown cells). Write references literally; only the cells you reference are passed to the cell. Each entry also has `.system` (the system an SQL cell ran on), `.index` and `.name`.
- In **ABAP SQL**: interpolate earlier results with `${cells.<name>.result.FIELD}` (or `${cells[N].result.FIELD}`). Strings are auto-quoted; arrays are auto-joined for `IN` clauses. The path after `.result` must be field names / indexes, e.g. `.ROLE_NAME` or `.rows[0].MATNR` — expressions are not evaluated.

```sql
-- params is a JavaScript cell that returns an array with a MATNRS property
SELECT matnr, werks FROM marc
  WHERE matnr IN (${cells.params.result.MATNRS})
```

**System markers**

System markers belong to ABAP SQL cells: JavaScript and markdown cells do not talk to SAP and have no system. Click the system item in an SQL cell's status bar (or run **SAP Data Workbook: Set System From This Cell…**) and pick an ABAP FS connection: connected systems are listed first, then the cell's current system, then systems that are configured but not connected. That SQL cell and every following SQL cell run on that system until the next marker. The status bar shows `dev ▸` on a marker and `dev (from #2)` on the SQL cells it covers; pick **Remove the system marker** to delete one.

If a marker names a system that is not connected, **Run All** asks which connected system to use instead and updates the marker. **SAP Data Workbook: Show Run Plan** lists every cell with the system it will use.

**Row limits**

Each SQL cell has a configurable row limit (default: 1000). Click `Rows: 1000` in the cell's status bar or run **SAP Data Workbook: Set Cell Row Limit**.

**Copilot and cell settings**

Copilot's notebook tools edit cell content but cannot see or set a cell's name, system marker or row limit. ABAP FS adds the **abapfs_workbook_cell_settings** tool for that: Copilot creates the cells, then sets every system, row limit and name in one call, so a cross-system workbook is ready for Run All without clicking markers. The tool:

- reads every cell's name, own or inherited system and row limit when called with only the workbook path;
- accepts only `.sapwb` files, and changes nothing if any requested setting is invalid (unknown cell, duplicate name, a system or row limit on a JavaScript or markdown cell, a row limit outside 1–100,000);
- saves a system that is not connected, but warns Copilot so it can tell you;
- applies all changes as one edit (one Undo), and saves the workbook unless it already had unsaved changes.

It is also available to other AI tools through the [MCP server](../mcp-server.md).

## Formatted Output

A JavaScript cell can return more than a plain table. The `display` helper is available in every JavaScript cell:

| Helper | Shows | Later cells receive |
|---|---|---|
| `display.table(rows, { wrap, highlight, title, limit })` | A table. `wrap` wraps long values; `highlight` colours cells whose whole value is `RED`/`FAIL`/`ERROR`, `YELLOW`/`WARN`, `GREEN`/`PASS`/`OK` or `INFO`; `limit` shows up to 5000 rows | the rows |
| `display.markdown(text)` | Formatted Markdown | the text |
| `display.html(html)` | HTML | the HTML |
| `display.json(value)` | Highlighted JSON | the value |
| `display.xml(value)` | Highlighted XML (an XML string is pretty-printed; rows/objects are converted) | the value |
| `display.text(text)` | Plain text | the text |
| `display.all(a, b, …)` | Several outputs in one cell | the first item with `data`, otherwise the first table |

Pass `{ data: x }` in the options to choose what later cells receive:

```javascript
// verdict headline + colour-coded summary; later cells read cells.summary.result.log
return display.all(
  display.markdown("## RED — 3 differences"),
  display.table(summary, { wrap: true, highlight: true, data: { summary, log } })
)
```

Tables wrap long values by default (setting `abapfs.workbook.tableWrap`). Dates are shown as `YYYY-MM-DD`.

## Exporting a Workbook

Click **Export…** in the workbook toolbar (or run **SAP Data Workbook: Export…**):

1. Tick what to include — any of **Data** (results of the cells that have run; all rows, not only the rows on screen), **Code** (SQL and JavaScript cells) and **Comments** (Markdown cells).
2. Pick a format: **PDF**, **HTML**, **JSON**, **XML**, **Excel**, **CSV**, **Word** or **Markdown**.

| Content | In the exported file |
|---|---|
| SQL and JavaScript cells | Labelled, syntax-highlighted code blocks (`ABAP SQL · name · system`) |
| `display.json` / `display.xml` output (and plain objects) | Code blocks, written exactly as produced |
| Tables, strings, `display.html`, `display.markdown` | Normal content (tables, paragraphs, formatted text) |
| Several outputs from `display.all` | All of them, in order |
| Markdown tables / fenced code in comment cells | Real tables / code blocks (PDF, Word) |

- **Excel:** one sheet per result table, plus *Contents* and *Code & Comments* sheets; status values are coloured.
- **CSV:** data only, one file per result table.
- **PDF / Word:** landscape; tables over 3,000 (PDF) / 2,000 (Word) rows are cut with a note — use Excel or CSV for all rows. The PDF uses the standard PDF fonts, so characters outside Western European languages appear as `?`.
- Results are kept in memory, so run the workbook before exporting data.

## Example: Data Quality Check

```
Cell 1 (Markdown):            # Material Data Quality Check
Cell 2 (ABAP SQL, "fert"):    SELECT matnr, mtart, meins FROM mara WHERE mtart = 'FERT'
Cell 3 (JavaScript, "check"): const rows = cells.fert.result;
                              const out = rows.filter(r => !r.MEINS);
                              out.MATNRS = out.length ? out.slice(0, 10).map(r => r.MATNR) : [''];
                              return out;
Cell 4 (ABAP SQL):            SELECT matnr, werks FROM marc
                                WHERE matnr IN (${cells.check.result.MATNRS})
```

## Example: Cross-System Comparison

Put a system marker on the first SQL cell of each section; Run All runs each section on its own system.

```
Cell 1 (Markdown):                         # Pricing conditions in DEV
Cell 2 (ABAP SQL, "dev_a005", system dev): SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
Cell 3 (Markdown):                         # Pricing conditions in QAS
Cell 4 (ABAP SQL, "qas_a005", system qas): SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
Cell 5 (JavaScript):                       if (cells.dev_a005.system === cells.qas_a005.system) return 'Both cells ran on the same system'
                                           const devMap = new Map(
                                             cells.dev_a005.result.map(r => [r.KSCHL + r.VKORG + r.MATNR, r])
                                           );
                                           return cells.qas_a005.result
                                             .filter(r => {
                                               const d = devMap.get(r.KSCHL + r.VKORG + r.MATNR);
                                               return d && d.KBETR !== r.KBETR;
                                             })
                                             .map(r => ({
                                               ...r,
                                               DEV_KBETR: devMap.get(r.KSCHL + r.VKORG + r.MATNR).KBETR
                                             }));
```

System markers store connection ids. A colleague whose connections have other names gets a prompt on Run All to map them to their own systems.

## Limitations

- SQL supports `SELECT` and `WITH` only — no `INSERT`, `UPDATE`, or `DELETE`
- String literals are limited to 255 characters (SAP ADT constraint)
- Avoid interpolating more than ~10 values into an `IN` clause — filter in a JavaScript cell instead
- Cancelling a cell shows "Interrupted" immediately, but the query continues running on the SAP side
- Results are kept in memory and lost when the workbook is closed

## Commands

| Command | Shortcut / Notes |
|---------|-----------------|
| `ABAP FS: New SAP Data Workbook` | Creates a new `.sapwb` file |
| `ABAP FS: SAP Data Workbook: Set Cell Row Limit` | Sets the row limit for an SQL cell (also: click `Rows:` in the status bar) |
| `ABAP FS: SAP Data Workbook: Name Cell…` | Names / renames a cell (also: click `#n` in the status bar) |
| `ABAP FS: SAP Data Workbook: Set System From This Cell…` | Sets or removes a system marker on an ABAP SQL cell (also: click the system in its status bar) |
| `ABAP FS: SAP Data Workbook: Show Run Plan (cell → system)` | Lists every cell with the system it will run on (toolbar button) |
| `ABAP FS: SAP Data Workbook: Collapse/Expand All Code` | Toolbar button; also separate *Collapse All Code* / *Expand All Code* commands |
| `ABAP FS: SAP Data Workbook: Collapse/Expand All Outputs` | Toolbar button; also separate *Collapse All Outputs* / *Expand All Outputs* commands |
| `ABAP FS: SAP Data Workbook: Export…` | Exports data / code / comments to PDF, HTML, JSON, XML, Excel, CSV, Word or Markdown (toolbar button) |
