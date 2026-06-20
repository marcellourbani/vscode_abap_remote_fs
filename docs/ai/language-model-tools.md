# ABAP Language Model Tools (AI Assistant Features)

Language Model Tools are the built-in capabilities that GitHub Copilot uses automatically when you ask it questions in chat. You don't call these tools yourself — Copilot selects and runs the right tool based on what you ask.

**How to open Copilot Chat:** `Ctrl+Shift+I` (new chat) or `Ctrl+L` (inline chat)

Make sure you are in **Agent mode** (not Ask or Edit) for full tool access.

## Connection Requirement

Most tools require an active SAP connection. When no SAP system is connected, tools are hidden from Copilot to save context tokens. The **abap_fs_documentation** tool is always available regardless of connection status — use it to ask about features and setup.

Connect to a SAP system (`Ctrl+Shift+P` → **ABAP FS: Connect to an ABAP system**) to enable all 40+ tools.

## How it works

When you type a question, Copilot picks the appropriate tool behind the scenes:

| What you ask | Tool Copilot uses |
|---|---|
| "Where is BAPI_USER_GET_DETAIL used?" | `find_where_used` |
| "Show me the code for ZCL_MY_CLASS" | `get_abap_object_lines` |
| "Find all classes with 'pricing' in the name" | `search_abap_objects` |
| "Create a new class ZCL_TEST" | `create_object_programmatically` |
| "Run ATC on ZTEST_PROG" | `run_atc_analysis` |

## Available Tools

### Search & Navigation

1. **search_abap_objects** — Search for objects by name pattern using wildcards (e.g. `Z*PRICING*`, `BAPI_USER*`)
2. **get_abap_object_lines** — Read source code from any ABAP object. Use `methodName` to extract a single method (e.g. "Show me the FACTORY method from CL_SALV_TABLE")
3. **search_abap_object_lines** — Search for text within source code; supports regex and can list all methods in a class
4. **get_abap_object_info** — Get metadata about an object (type, line count, cache status)
5. **get_batch_lines** — Read source code from multiple objects in one call
6. **get_object_by_uri** — Access an object directly using its ADT URI path
7. **find_where_used** — Find all places where an object, method, or symbol is referenced
8. **get_connected_systems** — List the SAP system connection IDs currently active in VS Code

### Object Management

9. **create_object_programmatically** — Create new ABAP objects (classes, reports, function groups, etc.). Note: transport dialogs still appear during creation.
10. **get_abap_object_url** — Generate a SAP GUI WebGUI URL for an object (useful for browser automation)
11. **get_abap_object_workspace_uri** — Get the VS Code `adt://` URI for an object (needed before editing it)
12. **open_object** — Open an object in the VS Code editor
13. **abap_activate** — Activate ABAP objects after editing (similar to pressing the Activate button in SE80)

### Code Quality & Testing

14. **run_unit_tests** — Run ABAP unit tests and show results in the Testing panel
15. **create_test_include** — Create a unit test class include for an existing class
16. **run_atc_analysis** — Run ATC (ABAP Test Cockpit) code quality checks on an object
17. **get_atc_decorations** — Read the current ATC warning/error highlights visible in the editor

### Transport & Text

18. **manage_transport_requests** — Get transport details, list user transports, compare transports. Falls back to direct SQL on older systems.
19. **manage_text_elements** — Read, create, or update text elements in programs, classes, or function groups. READ works on all systems; CREATE/UPDATE requires a newer system.

### Data & SQL

20. **execute_data_query** — Run ABAP SQL queries and display results in an interactive table view
21. **get_abap_sql_syntax** — Get ABAP SQL syntax rules (Copilot calls this before writing queries to avoid syntax errors)

### Diagrams

22. **create_mermaid_diagram** — Generate and display flowcharts, sequence diagrams, ER diagrams, and more
23. **validate_mermaid_syntax** — Check Mermaid diagram code for syntax errors
24. **get_mermaid_documentation** — Retrieve Mermaid syntax reference for a specific diagram type
25. **detect_mermaid_diagram_type** — Auto-detect the type of a Mermaid diagram from its code

### Runtime Analysis

26. **analyze_abap_dumps** — List and analyze ST22 runtime errors
27. **analyze_abap_traces** — Analyze performance traces; detects bottlenecks automatically
28. **get_version_history** — View version history, retrieve source code at a past version, or compare two versions of an object

### Debugging

29. **abap_debug_session** — Start or stop an ABAP debugging session
30. **abap_debug_breakpoint** — Set or remove breakpoints (supports conditions)
31. **abap_debug_step** — Step over, step into, step return, or continue execution
32. **abap_debug_variable** — Inspect variable values and internal table contents during a debug session
33. **abap_debug_stack** — View the current call stack
34. **abap_debug_status** — Check whether a debug session is active

### System & Extension

35. **get_sap_system_info** — Get SAP system details: client, release, system type (S/4HANA vs ECC), timezone. Results are cached for 24 hours. Use the **Refresh SAP System Info Cache** command to clear the cache.
36. **abap_fs_documentation** — Search the ABAP FS extension documentation and settings reference
37. **adt_discovery_export** — Export the full ADT discovery tree from a connected SAP system to markdown files for API investigation
38. **manage_subagents** — Configure AI subagents that delegate tasks to cheaper/faster models to reduce API costs
39. **manage_heartbeat** — Control the background heartbeat monitoring service (add monitoring tasks, set reminders, check status)

### Documentation

40. **create_test_documentation** — Generate a Word document from Playwright test screenshots, organized by scenario
