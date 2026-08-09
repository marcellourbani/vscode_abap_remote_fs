# SAP Testing Troubleshooting

## Setup

### The SAP Testing skills and commands don't appear

The feature is off. It switches on only when `abapfs.testing.folder` points at a folder that exists — run **ABAP FS: Enable SAP UI Testing Features**.

If it worked before and stopped, the folder was probably moved, renamed, or deleted. Point it at a folder that exists again.

### VS Code asks me to approve every file Copilot writes

The test folder isn't open in your workspace, so every edit counts as an out-of-workspace change and needs confirmation. **File → Add Folder to Workspace** and pick your test folder.

You'll also get no IntelliSense or error checking in the generated test scripts until you do, because the `tsconfig.json` in the test folder only applies to workspace folders. Copilot warns about this when it looks the folder up.

### The managed files keep coming back / my edits disappeared

That's intended. `tsconfig.json`, `node_modules`, `playwright.config.js`, and `.sap-active-system` are managed by ABAP FS and rewritten at startup and after every update, because they contain absolute paths into the extension's install directory. Don't edit them; if you delete them, reload VS Code and they come back.

### `ERROR: No abapfs.remote entry for "..."` or `has no "client" property`

The connection Copilot was given doesn't exist or is incomplete. SAP Testing needs both a `url` and a `client` on the connection to build the WebGUI URL — see [Connection Manager](../getting-started/connection-manager.md).

## Models

### "SAP testing subagent model configuration is invalid"

One of the models you chose is no longer offered by Copilot. Click **Configure Models** on the notification, or run **ABAP FS: Set Models for SAP Testing Subagents**, and pick replacements.

### "No language models are currently available"

Copilot hadn't finished starting up when the panel loaded. Use **Refresh** in the panel.

## Running tests

### The test fails on a SAP logon screen

Auto-login didn't produce a session. Two normal causes: the connection has `webGuiAutoLogin` turned off, or the system doesn't issue reentrance tickets.

Check the **ABAP FS** output channel at Debug level and look for `[sso]` lines — they name the cause directly, and distinguish an authentication problem from a test problem. Never work around this by putting credentials in a test script; Copilot is instructed to refuse.

### Cases come back BLOCKED instead of passed or failed

Blocked means the test never reached SAP because its data wasn't ready. It's a data problem, not a bug in the program.

Run phase 5 again for that system (`prepare-data`) and re-run. Copilot separates blocked from failed in its report for exactly this reason — six blocked cases and six failures mean very different things.

### A test passed on screen but is reported as failed

That's the framework working. The screen said success but the database check that case declared came back wrong, which usually means a real defect: SAP reported success without persisting the right data. Investigate before dismissing it.

### Microsoft Edge was not found

Set `abapfs.testing.edgePath` to your browser executable, or install Edge. Recording needs it; test runs strongly prefer it.

### An ABAP FS tool returns HTTP 401, 403, or 5xx

ABAP FS can't reach the SAP system — almost always an expired session. Check the connection and reload VS Code to re-establish it, then retry. This is not a permissions restriction to work around, and Copilot is told not to fall back to reading tables through the browser or to invent values.

### `_index.docx` couldn't be written

The file is open in Word. Close it and rebuild. If it can't get the lock, Copilot writes a timestamped copy instead and tells you both paths.

## Working with Copilot

### Copilot says a tool is missing

VS Code doesn't always surface every tool immediately, and `playwright_test` is the usual casualty. Starting a fresh chat normally fixes it. Copilot is instructed to tell you rather than fake a result or fall back to a terminal command — so treat the report as accurate.

### Copilot redid work that looked finished

A reviewer agent or a gated tool rejected it. The reviewers read the actual ABAP source and challenge the analysis or the test plan, and `build_test_index` and `playwright_test` refuse to run until the required review or readiness check genuinely passed. This is the framework catching a gap — see [Quality gates](technical-reference.md#quality-gates).

### Copilot keeps asking instead of just doing it

By design. A control it can't drive, data it can't find, or an ambiguous screen is a stop-and-ask situation, because the alternative — a plausible guess — produces a test that looks finished and silently proves nothing. Give it the answer, a sample file, or a [recording](recording.md).

### Copilot won't click a button

Anything destructive — post, delete, release, approve, or Execute on a program in update mode — needs your explicit approval first. Confirm in chat, ideally after checking the system is safe to write in.
