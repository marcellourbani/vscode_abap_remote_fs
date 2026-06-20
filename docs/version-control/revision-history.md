# ABAP Revision History

Every time an ABAP object is activated, SAP stores a version snapshot — the same history you see in SE80 via **Utilities → Versions**. This extension brings that history directly into VS Code with a visual diff editor.

## Opening Revision History

**Option 1 — Command Palette** (`Ctrl+Shift+P`):
> `ABAP: Show object history`

**Option 2 — Explorer context menu:**
Right-click any ABAP object → **Show object history**

**Option 3 — Ask Copilot:**
> "Show version history for ZCL_MY_CLASS"

## Comparing Versions

Once the history panel is open:

1. Select any revision from the list — it shows date, author, and transport number.
2. Click a revision to open a **side-by-side diff** against the current active version.
3. Use the **previous/next** arrows to step through revisions one at a time.
4. Toggle **Code Normalization** to strip formatting differences (like SE80's normalized comparison), so only meaningful changes are highlighted.

## Restoring an Old Version

1. Open the revision you want to restore.
2. Copy the content from the left pane into your editor, or use the restore action if prompted.
3. Save and activate as normal.

## vs. SE80 Version Management

| SE80 (Utilities → Versions) | This Extension |
|---|---|
| Opens in SAP GUI | Opens inside VS Code |
| Text-based diff | Syntax-highlighted side-by-side diff |
| Normalized compare available | Normalization toggle available |
| Manual copy to restore | Copy from diff pane |

## Using Copilot for Version History

The `get_version_history` tool supports three actions. Version numbers are **1-based**, where **1 = most recent**.

| Action | What it does |
|---|---|
| `list_versions` | Lists all versions with date, author, and transport |
| `get_version_source` | Returns full source code at a specific version number |
| `compare_versions` | Shows added/removed lines between two version numbers |

**Example questions:**

- "Show version history for ZCL_MY_CLASS"
- "Who last changed ZCL_MY_CLASS and when?"
- "Get the code from version 2 of ZCL_MY_CLASS"
- "Compare version 1 and version 3 of ZTEST_PROGRAM"
- "What changed between the last two versions of ZTEST_PROGRAM?"
