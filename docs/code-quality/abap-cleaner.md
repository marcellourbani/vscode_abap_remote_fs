# ABAP Cleaner Integration

ABAP Cleaner automatically formats and cleans up ABAP code — fixing indentation, modernizing syntax, and applying configurable cleanup rules in one step.

## Setup

ABAP Cleaner requires its standalone command-line tool (`abap-cleanerc.exe`).

1. Download ABAP Cleaner from [github.com/SAP/abap-cleaner](https://github.com/SAP/abap-cleaner) and extract it to a folder.
2. Open the Command Palette (`Ctrl+Shift+P`) and run **ABAP FS: Setup ABAP Cleaner Integration**.
3. Enter the path to `abap-cleanerc.exe` when prompted.

## Cleaning Code

With an ABAP file open, use any of these methods:

| Method | Action |
|---|---|
| Keyboard shortcut | `Ctrl+Shift+Alt+F` |
| Format on save | `Shift+Alt+F` (standard VS Code format — triggers ABAP Cleaner if configured as formatter) |
| Command Palette | **ABAP FS: Clean ABAP Code with ABAP Cleaner** |
| Toolbar button | Click the Cleaner button in the editor toolbar |

To clean only selected lines, select the code first, then trigger the command.

## What It Does

- Applies all configured ABAP Cleaner rules to the file
- Respects a custom cleanup profile if one is configured
- Targets the ABAP release you specify (avoids using syntax unavailable on your system)
- Reports which rules were applied and how many lines changed

## Configuration

In VS Code settings (`Ctrl+,`), search for **ABAP Cleaner** to configure:

- **Executable path** — path to `abap-cleanerc.exe`
- **Profile** — custom cleanup profile file (optional)
- **Target release** — ABAP release to target (e.g. `757`)
- **Clean on save** — automatically clean every time you save an ABAP file
