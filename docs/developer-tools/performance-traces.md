# Performance Traces

Analyze ABAP runtime performance directly in VS Code — the equivalent of **SAT** (ABAP Trace) and **ST05** (SQL Trace) in the SAP GUI, but without leaving your editor.

## Opening the Traces Panel

**Activity Bar → ABAP FS icon → Traces**

Or ask Copilot (Ctrl+Alt+I): *"Show me recent trace runs"*

## Workflow

1. **Record a trace** in the SAP system first (via SAT or ST05 as usual).
2. In VS Code, open the **Traces** panel to see your recorded runs.
3. Click a trace run to open it, then choose an analysis action.
4. Ask Copilot to interpret results: *"Analyze this trace for bottlenecks"*

## Analysis Actions

| Action | What it shows | Equivalent in SAP GUI |
|---|---|---|
| **List runs** | Recent trace executions with summary | SAT / ST05 hit list |
| **Analyze run** | Automatic bottleneck detection | SAT summary screen |
| **Get statements** | Statement-level timing (non-aggregated traces) | ST05 statement list |
| **Get hitlist** | Hit counts and total timing (aggregated traces) | SAT aggregated view |
| **List configurations** | Available trace configs on the system | SAT configuration |

> **Note:** For aggregated traces, *Get statements* automatically falls back to the hitlist.

## What Copilot Can Do

Ask Copilot directly instead of navigating the panel:

- *"Show me trace runs from today"*
- *"Analyze trace [name] for bottlenecks"*
- *"What are the slowest SQL statements in the last trace?"*
- *"Is there a database bottleneck in trace [name]?"*

Copilot automatically identifies:

- **Database bottlenecks** — expensive or repeated SELECT statements
- **ABAP processing hotspots** — slow internal table operations or loops
- **Performance outliers** — statements disproportionate to total runtime

## When to Use This vs. SAT/ST05

Use the VS Code Traces panel when you are already working in VS Code and want to stay in context, or when you want Copilot to interpret results for you. Use SAT/ST05 in the SAP GUI when you need to configure detailed trace settings or record a new trace interactively.
