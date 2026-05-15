# ABAP Debugging

Debug ABAP programs directly inside VS Code — no SAP GUI required. You get the same core capabilities as the SAP GUI debugger (breakpoints, stepping, variable inspection, call stack) with a modern editor experience and Copilot integration.

> 💡 **See also:** [Debug Recording & Replay](debug-recording.md) — record a session and replay it offline with step-back support.

---

## vs. SAP GUI Debugger

| Feature | SAP GUI Debugger | VS Code (ABAP FS) |
|---|---|---|
| Breakpoints | Click in editor | Click in gutter or via Copilot |
| Conditional breakpoints | ✅ | ✅ |
| Variable inspection | Manual navigation | Pattern filtering, auto-expand |
| Step controls | Toolbar buttons | Keyboard shortcuts (F5–F8) |
| Call stack | ✅ | ✅ |
| Multi-thread | Limited | Up to 20 concurrent threads |
| AI assistance | ❌ | ✅ via Copilot |

---

## Starting a Debug Session

1. Open the ABAP object in VS Code.
2. Set at least one breakpoint (see below).
3. Ask Copilot **"Start debugging session"** — or use the Debug panel.
4. Trigger execution in the SAP system (run the transaction, report, etc.).
5. VS Code halts at the first breakpoint.

> ⚠️ **Production systems:** Starting a debug session on a production system prompts a confirmation dialog. Production debugging risks data exposure and performance impact. Use SAP GUI instead.

---

## Breakpoints

**Setting a breakpoint:** Click in the left gutter next to a line number — a red dot appears, identical to any VS Code language.

**Conditional breakpoints:** Right-click the gutter → *Add Conditional Breakpoint* → enter an ABAP expression. Execution pauses only when the condition is true.

**Jump to cursor:** Press **Shift+F12** to resume execution and halt at the current cursor position (equivalent to *Breakpoint at Cursor* in SAP GUI).

---

## Step Controls

| Action | Shortcut | SAP GUI Equivalent |
|---|---|---|
| Continue (run to next breakpoint) | **F5** | F8 |
| Step Over (execute line, skip into calls) | **F6** | F6 |
| Step Into (enter method/function) | **F7** | F5 |
| Step Return (finish current method) | **F8** | — |
| Jump to Line | — | *Goto Line* |

---

## Variable Inspection

Open the **Variables** panel in the Debug sidebar. Variables are grouped by scope: *Local Variables*, *Global Variables*, *SY fields*, etc.

**Filtering by pattern** — useful in large programs:

- `LT_*` — show all internal tables
- `LS_*` — show all structures
- `GV_*` — show all global variables

**Auto-expand:** Structures and tables expand inline so you can see component values without navigating into each one.

**Expression evaluation:** Type any ABAP variable or expression in the *Watch* panel or Debug Console to evaluate it at the current breakpoint.

**Via Copilot:** Ask naturally — *"Show me the value of lt_data"*, *"Expand ls_header"*, *"Show all variables starting with LT\_"*.

---

## Call Stack

The **Call Stack** panel lists every active stack frame with the program name, method, and line number. Click any frame to inspect local variables at that level — equivalent to navigating frames in the SAP GUI debugger.

---

## Multi-Thread Debugging

VS Code supports up to **20 concurrent debug threads** (configurable). Each thread appears as a separate entry in the Call Stack panel. This is useful when debugging background jobs or parallel processing scenarios that are difficult to debug in SAP GUI.
