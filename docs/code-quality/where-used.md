# Where-Used Analysis

The VS Code equivalent of **Ctrl+Shift+F3** (Where-Used List) in SAP GUI. Finds every place an object, method, variable, or symbol is referenced across the entire system.

## How to Use

**Option 1 — Editor shortcut:**
1. Place the cursor on any symbol (class name, method, variable, etc.)
2. Press `Shift+F12` (Find All References) or right-click → **Find All References**
3. Results appear in the References panel with file locations and code snippets

**Option 2 — Ask Copilot:**
> "Where is `BAPI_USER_GET_DETAIL` used?"
> "Find all usages of method `FACTORY` in `ZCL_MY_CLASS`"

## Filtering Results

For large result sets (1,000+ references), filters prevent having to page through SAP standard objects to find your custom code:

| Filter | What it does |
|--------|-------------|
| Exclude standard objects | Shows only Z\* / Y\* custom code |
| Object type | Restrict to programs, classes, interfaces, etc. |
| Object name pattern | e.g. `Z*INVOICE*` to narrow by naming convention |

> **Tip:** Custom Z/Y objects often appear at the end of large result sets. Apply the "exclude standard objects" filter to jump straight to them.

## Compared to SAP GUI

| SAP GUI (Ctrl+Shift+F3) | VS Code |
|-------------------------|---------|
| Modal dialog, one object at a time | Inline results panel, stays open |
| No snippet preview | Shows code context around each reference |
| No pattern filtering | Filter by type, name pattern, custom-only |
| Paginated per transaction | Pagination + filters in one view |
