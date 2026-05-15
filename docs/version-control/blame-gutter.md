# Blame Gutter

Shows who last changed each line of an ABAP file — author, date, and transport number — displayed inline in the editor, similar to GitLens for Git repositories.

## Activating Blame

With an ABAP file open, use any of:

| Method | Action |
|--------|--------|
| Keyboard | **Ctrl+Alt+B** (toggles on/off) |
| Editor title bar | Click the blame icon ($(git-commit)) |
| Command Palette | `ABAP FS: Show Blame` |

> Blame is per-file — it can be active on one file while other files show no annotations.

## Reading the Annotations

Each annotated line shows: `AUTHOR · DATE · TRANSPORT — Transport description`

Example: `JSMITH · Jan 15, 2026 · KD1K900123 — S 8000005926: Fix pricing logic`

- **Color-coded left border** — each author gets a distinct color for quick visual grouping
- **`│` continuation marker** — consecutive lines from the same author/transport are grouped
- **All annotations are column-aligned** — regardless of line length
- **Hover over an annotation** for full date and transport details

## Render Modes

Control the layout with the `abapfs.blame.renderMode` setting:

| Value | Layout |
|-------|--------|
| `classic` | Blame text appears inline after each line of code |
| `gitlens` | Blame moves into a fixed lane to the left of the code |

Change via **File > Preferences > Settings**, search for `abapfs blame`.

## Requirements

- Object must have SAP version history — objects in `$TMP` with no transports have no versions
- File must be saved (no unsaved changes); blame auto-hides when you start editing
- ABAP files only (`.abap`)

## Performance Notes

- **Cached** — re-opening blame on the same file is instant
- **Cache clears on save** — ensures fresh results after transport releases
- **Progress notification** shown while fetching; click **Cancel** to abort

## How It Works

Blame walks backward through SAP version history (same algorithm as `git blame`):

1. Fetches all versions of the object from SAP (in parallel batches)
2. Diffs each consecutive pair, newest-to-oldest
3. Lines added/changed in a newer version → attributed to that version's author
4. Unchanged lines → checked against the next older version
5. Lines still unattributed after all versions → attributed to the oldest version
