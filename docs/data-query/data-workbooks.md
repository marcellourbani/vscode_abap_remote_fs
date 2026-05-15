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

- Run a single cell with the run button or `Shift+Enter`. You are prompted to select a SAP system.
- **Run All** (`Ctrl+Shift+Enter`) prompts once and uses that system for all SQL cells.

**Referencing results between cells**

- In **JavaScript**: access a previous cell's rows via `cells[N].result` (0-indexed, so cell 2 is `cells[1]`).
- In **ABAP SQL**: interpolate earlier results using `${...}`. Strings are auto-quoted; arrays are auto-joined for `IN` clauses.

```sql
-- Use results from cell 2 (index 1) as a filter
SELECT matnr, werks FROM marc
  WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

**Row limits**

Each SQL cell has a configurable row limit (default: 1000). Adjust with **ABAP FS: Set Cell Max Rows**.

## Example: Data Quality Check

```
Cell 1 (Markdown):   # Material Data Quality Check
Cell 2 (ABAP SQL):   SELECT matnr, mtart, meins FROM mara WHERE mtart = 'FERT'
Cell 3 (JavaScript): const rows = cells[1].result;
                     return rows.filter(r => !r.MEINS).length + " materials missing UoM";
Cell 4 (ABAP SQL):   SELECT matnr, werks FROM marc
                       WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

## Example: Cross-System Comparison

Run the same query against two systems by executing cells individually and selecting a different system each time. A JavaScript cell then diffs the results.

```
Cell 1 (Markdown):   # Pricing Condition Comparison: DEV vs QAS
Cell 2 (ABAP SQL):   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                     → Run, select DEV
Cell 3 (ABAP SQL):   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                     → Run, select QAS
Cell 4 (JavaScript): const devMap = new Map(
                       cells[1].result.map(r => [r.KSCHL + r.VKORG + r.MATNR, r])
                     );
                     return cells[2].result
                       .filter(r => {
                         const d = devMap.get(r.KSCHL + r.VKORG + r.MATNR);
                         return d && d.KBETR !== r.KBETR;
                       })
                       .map(r => ({
                         ...r,
                         DEV_KBETR: devMap.get(r.KSCHL + r.VKORG + r.MATNR).KBETR
                       }));
```

Workbook files store no system IDs, so they can be shared with colleagues who use different system names.

## Limitations

- SQL supports `SELECT` and `WITH` only — no `INSERT`, `UPDATE`, or `DELETE`
- String literals are limited to 255 characters (SAP ADT constraint)
- Avoid interpolating more than ~10 values into an `IN` clause — filter in a JavaScript cell instead
- Cancelling a cell shows "Interrupted" immediately, but the query continues running on the SAP side

## Commands

| Command | Shortcut / Notes |
|---------|-----------------|
| `ABAP FS: New SAP Data Workbook` | Creates a new `.sapwb` file |
| `ABAP FS: Set Cell Max Rows` | Sets row limit for the current SQL cell |
