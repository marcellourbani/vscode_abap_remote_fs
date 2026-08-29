# ABAP Language Model Tools (AI Assistant Features)

Language Model Tools are the built-in capabilities that GitHub Copilot uses automatically when you ask it questions in chat. You don't call these tools yourself — Copilot selects and runs the right tool based on what you ask.

**How to open Copilot Chat:** `Ctrl+Shift+I` (new chat) or `Ctrl+L` (inline chat)

Make sure you are in **Agent mode** (not Ask or Edit) for full tool access.

## Connection Requirement

Most tools require an active SAP connection. When no SAP system is connected, tools are hidden from Copilot to save context tokens. The **abapfs_search_documentation** tool is always available regardless of connection status — use it to ask about features and setup.

Connect to a SAP system (`Ctrl+Shift+P` → **ABAP FS: Connect to an ABAP system**) to enable all 40+ tools.

## How it works

When you type a question, Copilot picks the appropriate tool behind the scenes:

| What you ask | Tool Copilot uses |
|---|---|
| "Where is BAPI_USER_GET_DETAIL used?" | `abapfs_find_usages` |
| "Show me the code for ZCL_MY_CLASS" | `abapfs_get_object_source` |
| "Find all classes with 'pricing' in the name" | `abapfs_search_objects` |
| "Create a new class ZCL_TEST" | `abapfs_create_object` |
| "Run ATC on ZTEST_PROG" | `abapfs_run_atc_analysis` |

## Available Tools

### Search & Navigation

1. **abapfs_search_objects** — Search for objects by name pattern using wildcards (e.g. `Z*PRICING*`, `BAPI_USER*`)
2. **abapfs_get_object_source** — Read source code from any ABAP object. Use `methodName` to extract a single method (e.g. "Show me the FACTORY method from CL_SALV_TABLE")
3. **abapfs_search_object_source** — Search for text within source code; supports regex and can list all methods in a class
4. **abapfs_get_object_info** — Get metadata about an object (type, line count, cache status)
5. **abapfs_batch_get_lines** — Read source code from multiple objects in one call
6. **abapfs_get_object_by_uri** — Access an object directly using its ADT URI path
7. **abapfs_find_usages** — Find all places where an object, method, or symbol is referenced
8. **abapfs_get_connected_systems** — List the SAP system connection IDs currently active in VS Code

### Object Management

9. **abapfs_create_object** — Create new ABAP objects (classes, reports, function groups, etc.). Note: transport dialogs still appear during creation.
10. **abapfs_get_object_url** — Generate a SAP GUI WebGUI URL for an object (useful for browser automation)
11. **abapfs_get_workspace_uri** — Get the VS Code `adt://` URI for an object (needed before editing it)
12. **abapfs_open_object** — Open an object in the VS Code editor
13. **abapfs_activate_object** — Activate ABAP objects after editing (similar to pressing the Activate button in SE80)

### Code Quality & Testing

14. **abapfs_run_unit_tests** — Run ABAP unit tests and show results in the Testing panel
15. **abapfs_create_test_include** — Create a unit test class include for an existing class
16. **abapfs_run_atc_analysis** — Run ATC (ABAP Test Cockpit) code quality checks on an object
17. **abapfs_get_atc_highlights** — Read the current ATC warning/error highlights visible in the editor

### Transport & Text

18. **abapfs_manage_transports** — Get transport details, list user transports, compare transports. Falls back to direct SQL on older systems.
19. **abapfs_manage_text_elements** — Read, create, or update text elements in programs, classes, or function groups. READ works on all systems; CREATE/UPDATE requires a newer system.

### Data & SQL

20. **abapfs_run_sql_query** — Run ABAP SQL queries and display results in an interactive table view
21. **abapfs_get_sql_syntax** — Get ABAP SQL syntax rules (Copilot calls this before writing queries to avoid syntax errors)

### Diagrams

22. **abapfs_create_mermaid_diagram** — Generate and display flowcharts, sequence diagrams, ER diagrams, and more
23. **abapfs_validate_mermaid_syntax** — Check Mermaid diagram code for syntax errors
24. **abapfs_get_mermaid_documentation** — Retrieve Mermaid syntax reference for a specific diagram type
25. **abapfs_detect_mermaid_diagram_type** — Auto-detect the type of a Mermaid diagram from its code

### Runtime Analysis

26. **abapfs_analyze_dumps** — List and analyze ST22 runtime errors
27. **abapfs_analyze_traces** — Analyze performance traces; detects bottlenecks automatically
28. **abapfs_get_version_history** — View version history, retrieve source code at a past version, or compare two versions of an object

### Debugging

29. **abapfs_manage_debug_session** — Start or stop an ABAP debugging session
30. **abapfs_manage_breakpoints** — Set or remove breakpoints (supports conditions)
31. **abapfs_step_debugger** — Step over, step into, step return, or continue execution
32. **abapfs_inspect_variable** — Inspect variable values and internal table contents during a debug session
33. **abapfs_get_debug_stack** — View the current call stack
34. **abapfs_get_debug_status** — Check whether a debug session is active

### System & Extension

35. **abapfs_get_sap_system_info** — Get SAP system details: client, release, system type (S/4HANA vs ECC), timezone. Results are cached for 24 hours. Use the **Refresh SAP System Info Cache** command to clear the cache.
36. **abapfs_search_documentation** — Search the ABAP FS extension documentation and settings reference
37. **abapfs_export_adt_discovery** — Export the full ADT discovery tree from a connected SAP system to markdown files for API investigation
38. **abapfs_manage_subagents** — Configure AI subagents that delegate tasks to cheaper/faster models to reduce API costs
39. **abapfs_manage_heartbeat** — Control the background heartbeat monitoring service (add monitoring tasks, set reminders, check status)

### Documentation

40. **abapfs_build_test_documentation** — Generate a Word document from Playwright test screenshots, organized by scenario
