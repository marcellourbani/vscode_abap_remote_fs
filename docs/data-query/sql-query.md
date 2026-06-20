# SQL Query Execution

Query SAP tables directly from VS Code — the equivalent of SE16N or DBACOCKPIT, but driven by natural language and integrated with Copilot.

## How to Use

Open the Copilot chat (`Ctrl+Alt+I`) and describe what you want:

- *"Show me the first 10 records from MARA"*
- *"Query USR02 where the username starts with Z"*
- *"Compare open purchase orders in EKKO for vendor 1000"*

Copilot builds and executes the ABAP SQL query, then displays results in an interactive table in the editor.

## Working with Results

The result table supports:

| Action | How |
|---|---|
| Sort by column | Click a column header (click again to reverse) |
| Multi-column sort | Hold `Shift` and click additional headers |
| Filter rows | Type in the filter box — supports wildcards `*` and `?` |
| Export | Use the export button in the result toolbar |

You can also ask Copilot to refine results after the initial query: *"Now filter by plant 1000"* or *"Sort by creation date descending"*.

## Display Modes

**UI mode** (default) — results appear in a webview for you to explore interactively. Data stays in VS Code.

**Internal mode** — results are sent back to Copilot for further analysis (e.g., *"find duplicates"*, *"summarize by material type"*). Copilot automatically selects this mode when analysis is needed.

## Production System Protection

When Copilot would send data back to itself from a **production system**, a confirmation dialog appears:

- **Run & send to Copilot** — proceed with analysis
- **Run & show in UI only** — display results without sharing data with Copilot
- **Cancel**

This prevents sensitive production data from being inadvertently included in the AI context.

## Notes

- **Row limit:** Default 1000 rows, maximum 50,000. Copilot manages this automatically — the ABAP SQL `UP TO x ROWS` clause is not supported via ADT, so use natural language like *"limit to 500 rows"* instead.
- **Not just SAP data:** The same result viewer can display any structured data — JIRA issues, task lists, comparison tables — that Copilot assembles during a conversation.
