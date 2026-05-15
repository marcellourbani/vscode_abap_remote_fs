# Show Table Contents

View the contents of any database table directly in VS Code — similar to **SE16 / SE16N** in SAP GUI.

## Opening Table Contents

1. Open a database table (e.g. from the object explorer or via `Ctrl+Shift+A` to search by name)
2. Click the **Show table contents** button in the editor toolbar, **or** right-click the table → **Show table contents**

## Working with the Data Grid

The results open in an interactive grid with the following capabilities:

| Feature | How to use |
|---|---|
| **Sort** | Click a column header |
| **Filter** | Use the filter row below the header |
| **Paginate** | Navigate pages using the controls at the bottom |
| **Export** | Use the export button to download results |

## Notes

- Only the first **1 000 rows** are fetched by default — add filters to narrow results for large tables.
- For more complex queries (JOINs, aggregations, custom WHERE clauses), use the [Data Query](../data-query/sql-query.md) feature instead.
