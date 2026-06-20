# Debug Recording & Replay

> ⚠️ **BETA FEATURE** — Please report any issues.

Record a live ABAP debug session and replay it offline — forward and backward — like a DVR. No SAP connection needed during replay.

**When is this useful?**

- You stepped too far and want to go back without restarting
- You want to share a bug reproduction with a colleague
- You need to analyse a complex execution path at your own pace

---

## Recording a Session

> Each step takes ~1–3 seconds longer than normal because the extension captures all variable data before SAP discards it.

1. Start a debug session as usual (set breakpoints, attach to user/terminal)
2. Open the Command Palette (`Ctrl+Shift+P`) → **ABAP: Start Debug Recording**
3. Step through your code normally — every step is captured
4. `Ctrl+Shift+P` → **ABAP: Stop Debug Recording**
5. At the prompt, choose **Save** (plain `.abaprecord`) or **Compress & Save** (`.abaprecord.gz`, ~80–95% smaller)

**What is captured per step:**

- Full call stack with source references
- All variables across all scopes (Local, Global, SY) — structures expanded, tables up to 2,000 rows
- Source file contents for offline viewing

---

## Replaying a Recording

1. `Ctrl+Shift+P` → **ABAP: Replay Debug Recording**
2. Select a `.abaprecord` or `.abaprecord.gz` file — both are handled automatically
3. The replay session opens showing code, stack, and variables exactly as recorded

**Replay controls:**

| Action | Shortcut |
|--------|----------|
| Step forward (next snapshot) | `F7`, `F10`, or `F11` |
| Step back (previous snapshot) | `Shift+F7` or `Shift+F11` |
| Jump to end | `F5` (Continue) |
| Jump to start | Reverse Continue |
| Close session | Terminate |

> In replay mode all three step buttons (Step Over / Into / Out) do the same thing: move to the next recorded snapshot.

You can inspect variables, expand structures, browse table rows, evaluate expressions, and hover over variables — all without a SAP connection.

---

## Compression

Large sessions can produce files tens of MB in size. Use gzip to reduce storage and sharing size.

| Command | Description |
|---------|-------------|
| **ABAP: Compress Debug Recording** | Compress an existing `.abaprecord` → `.abaprecord.gz` |
| **ABAP: Decompress Debug Recording** | Convert `.abaprecord.gz` back to plain JSON |

After compression the extension shows the size reduction (e.g. *42 MB → 3.2 MB, 92% smaller*). Both formats are fully interchangeable.

---

## All Commands

| Command | Description |
|---------|-------------|
| `ABAP: Start Debug Recording` | Begin recording the active debug session |
| `ABAP: Stop Debug Recording` | Stop and save (plain or compressed) |
| `ABAP: Replay Debug Recording` | Open and replay a recording file |
| `ABAP: Compress Debug Recording` | Compress an existing `.abaprecord` file |
| `ABAP: Decompress Debug Recording` | Decompress a `.abaprecord.gz` file |

---

## Limitations

| Limitation | Detail |
|------------|--------|
| Table rows | First 2,000 rows captured; remainder skipped (marked in replay) |
| Variable depth | Structures/tables beyond 4 levels deep are not expanded |
| Source unavailable | Shows `[source unavailable]` if caching failed during recording |
| No conditional breakpoints | Replay only steps through what was recorded |
| Step speed | ~1–3 seconds per step during recording (variable capture overhead) |
