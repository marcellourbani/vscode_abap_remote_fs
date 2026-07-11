# ABAP Revision History

Every time an ABAP object is activated, SAP stores a version snapshot — the same history you see in SE80 via **Utilities → Versions**. This extension surfaces that history in **VS Code's built-in Source Control view**, with a side-by-side diff editor.

## Opening Revision History

Revisions appear in the standard **Source Control view** (`Ctrl+Shift+G`), under a provider named `ABAP <connId>` (one per connected system).

There are four ways objects show up there:

1. **Automatic — Recent group.** Open any ABAP object in the editor. It's added to the **Recent** group of its connection's SCM provider, along with a diff decoration against the previous activated version.
2. **Whole transport.** In the **Transports** panel (ABAP FS activity bar), right-click a transport → **Add transport to source control**. Every object in that transport is added as its own SCM group.
3. **Object Property View.** ABAP FS activity bar → **Object Property** panel → **Revision history** section lists every stored version for the currently open object.
4. **Ask Copilot.** > "Show version history for ZCL_MY_CLASS" or ask to compare any two versions — uses the `get_version_history` tool (see below).

## Comparing Versions

### From the Source Control view

Click a resource in an `ABAP <connId>` group to open the default diff (current active version vs. previous revision), or use the inline icons on the row:

| Command | What it does |
|---|---|
| `Open diff with revision` | Side-by-side diff, active vs. previous revision |
| `Open diff normalized` | Same diff with formatting/comment differences stripped (SE80-style normalized compare) |
| `Open current version` | Just opens the current source, no diff |

Inline group actions:

- **Filter unchanged** — hides objects with no differences.
- **Clear** — empties the group.

### Stepping through revisions in the diff editor

While a revision diff is open, the editor toolbar exposes:

| Command | Scope |
|---|---|
| `Previous revision (left pane)` / `Next revision (left pane)` | Move the left (older) side back or forward in history |
| `Previous revision (right pane)` / `Next revision (right pane)` | Move the right (newer) side back or forward in history |
| `Toggle code normalization` | Strip formatting/comment differences on the fly |

### From the Object Property View

In the **Revision history** section, tick the checkbox next to any two versions to open a diff between exactly those two.

## Restoring an Old Version

There's no one-click restore. Open the diff to the version you want, copy the content from the pane holding the old version into the editor of the current active source, then save and activate as normal.

## vs. SE80 Version Management

| SE80 (Utilities → Versions) | This Extension |
|---|---|
| Opens in SAP GUI | Standard VS Code Source Control + diff editor |
| Text-based diff | Syntax-highlighted side-by-side diff |
| Normalized compare available | `Toggle code normalization` in diff toolbar |
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
