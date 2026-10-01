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

**Naming cells**

Click `#n` in a cell's status bar to give it a name (letters, digits and `_`, unique in the workbook). Names are saved in the `.sapwb` file and keep working when cells are inserted, moved or deleted. When you rename a cell, ABAP FS offers to update the references in other cells.

**Referencing results between cells**

- In **JavaScript**: `cells.<name>.result` (also `cells["name"]`, or `cells[N]` by position: 0-based, counting markdown cells). Write references literally; only the cells you reference are passed to the cell. Each entry also has `.index` and `.name`.
- In **ABAP SQL**: interpolate earlier results with `${cells.<name>.result.FIELD}` (or `${cells[N].result.FIELD}`). Strings are auto-quoted; arrays are auto-joined for `IN` clauses. The path after `.result` must be field names / indexes, e.g. `.ROLE_NAME` or `.rows[0].MATNR` — expressions are not evaluated.

```sql
-- params is a JavaScript cell that returns an array with a MATNRS property
SELECT matnr, werks FROM marc
  WHERE matnr IN (${cells.params.result.MATNRS})
```

**Row limits**

Each SQL cell has a configurable row limit (default: 1000). Click `Rows: 1000` in the cell's status bar or run **SAP Data Workbook: Set Cell Row Limit**.

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

Run the same query against two systems by executing cells individually and selecting a different system each time. A JavaScript cell then diffs the results.

```
Cell 1 (Markdown):              # Pricing Condition Comparison: DEV vs QAS
Cell 2 (ABAP SQL, "dev_a005"):  SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                                → Run, select DEV
Cell 3 (ABAP SQL, "qas_a005"):  SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                                → Run, select QAS
Cell 4 (JavaScript):            const devMap = new Map(
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

Workbook files store no system IDs, so they can be shared with colleagues who use different system names.

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
