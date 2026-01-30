This documentation covers all features in detail. The goal: make ABAP development faster, more intelligent, and less frustrating.

> **🔌 Using a non-GitHub Copilot AI tool?** (Cursor, Claude Code, Windsurf, Claude Desktop, etc.)  
> See [MCP Server for External AI Tools](#mcp-server-for-external-ai-tools) to use ABAP FS tools with your preferred AI assistant.

- [Installation Steps](#installation-steps)
  - [Updates](#updates)
- [MCP Server for External AI Tools](#mcp-server-for-external-ai-tools)
  - [How It Works](#how-it-works)
  - [Setup Instructions](#setup-instructions)
    - [1. Enable MCP Server in VS Code](#1-enable-mcp-server-in-vs-code)
    - [2. Connect to SAP System](#2-connect-to-sap-system)
    - [3. Configure Your AI Tool](#3-configure-your-ai-tool)
    - [4. Verify Connection](#4-verify-connection)
  - [Limitations](#limitations)
  - [Available Tools](#available-tools)
  - [Troubleshooting](#troubleshooting)
- [1. Editor, AI Integration \& Chat](#1-editor-ai-integration--chat)
  - [1.1 ABAP Language Model Tools (AI Assistant Features)](#11-abap-language-model-tools-ai-assistant-features)
  - [1.2 Enhanced Hover Information](#12-enhanced-hover-information)
- [2. SAP GUI Integration](#2-sap-gui-integration)
  - [2.1 Embedded SAP GUI (WebView)](#21-embedded-sap-gui-webview)
  - [2.2 Native Desktop SAP GUI](#22-native-desktop-sap-gui)
  - [2.3 Web Browser SAP GUI](#23-web-browser-sap-gui)
- [3. Object Management](#3-object-management)
  - [3.1 Object Search](#31-object-search)
  - [3.2 Create Objects](#32-create-objects)
  - [3.3 Open Objects](#33-open-objects)
  - [3.4 Object Activation](#34-object-activation)
  - [3.5 Favorites Management](#35-favorites-management)
  - [3.6 Show Table Contents](#36-show-table-contents)
  - [3.7 Compare Objects Across Systems](#37-compare-objects-across-systems)
- [4. Code Quality \& Analysis](#4-code-quality--analysis)
  - [4.1 ABAP Test Cockpit (ATC) Analysis](#41-abap-test-cockpit-atc-analysis)
  - [4.2 ABAP Cleaner Integration](#42-abap-cleaner-integration)
  - [4.3 Syntax Validation](#43-syntax-validation)
  - [4.4 Where-Used Analysis](#44-where-used-analysis)
- [5. Debugging Features](#5-debugging-features)
  - [5.1 ABAP Debugging](#51-abap-debugging)
- [6. Data Query \& Visualization](#6-data-query--visualization)
  - [6.1 SQL Query Execution](#61-sql-query-execution)
- [7. Transport Management](#7-transport-management)
  - [7.1 Transport Request View](#71-transport-request-view)
  - [7.2 Transport Object Operations](#72-transport-object-operations)
- [8. Version Control](#8-version-control)
  - [8.1 abapGit Integration](#81-abapgit-integration)
  - [8.2 ABAP Revision History](#82-abap-revision-history)
- [9. Testing Features](#9-testing-features)
  - [9.1 Run Unit Tests](#91-run-unit-tests)
  - [9.2 Create Test Classes](#92-create-test-classes)
  - [9.3 Test Documentation Generator](#93-test-documentation-generator)
- [10. Documentation \& Diagrams](#10-documentation--diagrams)
  - [10.1 Mermaid Diagram Creation](#101-mermaid-diagram-creation)
  - [10.2 ABAP Documentation](#102-abap-documentation)
- [11. Developer Tools](#11-developer-tools)
  - [11.1 ABAP Dumps Analysis](#111-abap-dumps-analysis)
  - [11.2 Performance Traces](#112-performance-traces)
  - [11.3 Text Elements Management](#113-text-elements-management)
  - [11.4 Regex Search in Code](#114-regex-search-in-code)
  - [11.5 Enhanced Views \& Panels](#115-enhanced-views--panels)
      - [Activity Bar Views:](#activity-bar-views)
      - [Explorer Views:](#explorer-views)
      - [Panel Views:](#panel-views)
  - [11.8 Custom Editors](#118-custom-editors)
  - [11.9 ADT Feed Reader](#119adt-feed-reader)
  - [11.10 Run SAP Transaction](#1110-runsap-transaction)
  - [11.11 Message Class Editor](#1111-message-classeditor)
  - [11.12 SAP Connection Manager](#1112-sap-connection-manager)
  - [11.13 Dependency Graph Visualizer](#1113-dependency-graph-visualizer)
  - [⚠️ Important Considerations](#️-important-considerations)
  - [🎯 Key Differences: Commands vs Tools](#-key-differences-commands-vs-tools)
    - [Commands (User-Invoked Manually):](#commands-user-invoked-manually)
    - [Language Model Tools (Copilot Uses Automatically):](#language-model-tools-copilot-uses-automatically)
  - [🔒 Privacy \& Telemetry](#-privacy--telemetry)
    - [What Happens by Default](#what-happens-by-default)
    - [For Organizations Wanting Central Telemetry](#for-organizations-wanting-central-telemetry)
    - [Local Telemetry File Location](#local-telemetry-file-location)

# Installation Steps

1. **Uninstall old version (less than v2.0.0)** (if installed)
   - Open Extensions (`Ctrl+Shift+X`)
   - Search for "ABAP remote filesystem"
   - Uninstall and restart VS Code

2. **Install latest version from VSCode Marketplace**
   - Open Extensions (`Ctrl+Shift+X`)
   - Search for "ABAP remote filesystem"
   - Install and restart VS Code

3. **Configure SAP system connections**
   - Press `Ctrl+Shift+P`
   - Run: **ABAP FS: Connection Manager**
   - Modern webview UI opens with comprehensive connection management:
     - **Add Connection** - Fill in system details (URL, client, username, language, SAP GUI settings)
     - **Import/Export** - Import connections from JSON or export for backup/sharing
     - **Bulk Operations** - Edit multiple connections at once, bulk username changes
     - **Cloud Support** - Create connections from BTP Service Key or Endpoint
   - Save to User settings (global) or Workspace settings (project-specific)
   - Passwords stored securely in OS credential manager (not in settings files)

4. **Connect to SAP systems**
   - Press `Ctrl+Shift+P`
   - Run: **ABAP FS: Connect to an SAP system**
   - Select system and enter password if prompted
   - Wait for a minute for VSCode to connect to the system
   - Good to go

5. **Verify connection**
   - Check Activity Bar for "ABAP FS" icon
   - Expand views: Transports, Dumps, ATC Finds, Traces, abapGit
   - Try: `Ctrl+Shift+P` → **ABAP FS: Search for object**

## Updates
  - Extension will auto update if installed from VSCode Marketplace (if auto-update is enabled in extension page in VSCode)

# MCP Server for External AI Tools

> **Prerequisites:** Complete the [Installation Steps](#installation-steps) first. You need VS Code with ABAP FS installed and configured with your SAP system connections before setting up MCP.

**Why MCP?** ABAP FS includes 30+ Language Model Tools that provide deep SAP integration - searching objects, reading code, running tests, executing queries, and more. These tools are natively available to **GitHub Copilot** in VS Code. However, if you use other AI assistants like **Cursor**, **Claude Code**, **Windsurf**, **Claude Desktop**, or any MCP-compatible client, they cannot access VS Code's Language Model Tools directly.

The **MCP (Model Context Protocol) Server** bridges this gap by exposing all ABAP FS tools via a local HTTP endpoint that any MCP-compatible AI client can connect to.

## How It Works

```
┌─────────────────┐     MCP Protocol      ┌──────────────────┐     VS Code API     ┌─────────────┐
│  Cursor/Claude  │ ◄──────────────────► │  MCP Server      │ ◄─────────────────► │  ABAP FS    │
│  Desktop/etc.   │    localhost:4847     │  (in VS Code)    │                     │  Tools      │
└─────────────────┘                       └──────────────────┘                     └─────────────┘
```

**Important:** VS Code must remain open and connected to your SAP system. The MCP server runs inside VS Code and acts as a bridge - your external AI tool sends requests to the MCP server, which invokes the actual ABAP FS tools and returns results.

## Setup Instructions

### 1. Enable MCP Server in VS Code

Open VS Code Settings (`Ctrl+,`) and search for `mcpServer`:

- **`abapfs.mcpServer.autoStart`**: Set to `true` to start MCP server automatically
- **`abapfs.mcpServer.port`**: Default is `4847` (change if port conflicts)

Alternatively, add to your `settings.json`:
```json
{
  "abapfs.mcpServer.autoStart": true,
  "abapfs.mcpServer.port": 4847
}
```

Reload VS Code after changing settings. You'll see a notification: "🔌 MCP Server running on port 4847"

### 2. Connect to SAP System

In VS Code, connect to your SAP system as usual (`ABAP FS: Connect to an SAP system`). The MCP server needs an active SAP connection to work.

### 3. Configure Your AI Tool

**For Cursor:**
Add to your MCP configuration (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp"
    }
  }
}
```

**For Claude Desktop:**
Add to Claude's config file:
```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp"
    }
  }
}
```

**For other MCP clients:**
Use the Streamable HTTP endpoint: `http://localhost:4847/mcp`

### 4. Verify Connection

In your AI tool, you should now see ABAP FS tools available. Try asking:
- "Search for classes containing 'USER'"
- "Show me the code for CL_ABAP_TYPEDESCR"
- "Run unit tests for ZCL_MY_CLASS"

## Limitations

- **VS Code must stay open** - The MCP server runs inside VS Code; closing it stops the server
- **Active SAP connection required** - Tools need a connected SAP system in VSCode to work
- **Webview features** - Some features like Mermaid diagrams, data query results, etc. open in VS Code's webview panels (you'll need to look at VS Code for these)
- **No direct code editing** - Unlike GitHub Copilot which can edit ABAP files directly in VS Code, MCP tools are read-only. External AI tools (Cursor, Claude Code, etc.) cannot access VS Code's virtual `adt://` filesystem. The AI can read code and suggest changes, but you'll need to apply edits manually in VS Code or copy the AI's suggestions
- **No syntax checking** - ABAP syntax checking only works in VS Code with the ABAP FS extension. In external AI tools, ABAP code is treated as plain text
- **No go-to-definition or hover** - Navigation features like "Go to Definition", "Find References", and hover documentation require VS Code's ABAP integration
- **Transport handling in VS Code** - Transport request management UI and workflows are only available in VS Code
- **Debugging requires VS Code** - The ABAP debugger integration is VS Code-specific

## Available Tools

All 30+ ABAP FS Language Model Tools are exposed via MCP, including:
- `search_abap_objects` - Search for ABAP objects by pattern
- `get_abap_object_lines` - Read source code from objects
- `find_where_used` - Where-used analysis
- `run_unit_tests` - Execute ABAP unit tests
- `run_atc_analysis` - Run ATC checks
- `execute_data_query` - Run SQL queries
- `manage_transport_requests` - Transport management
- And many more...

## Troubleshooting

**Server not starting:**
- Check if `abapfs.mcpServer.autoStart` is `true`
- Check VS Code Output panel for errors
- Try a different port if 4847 is in use

**Tools not working:**
- Ensure VS Code is connected to an SAP system
- Check that the MCP server notification appeared on VS Code startup
- Verify your AI tool's MCP configuration points to the correct URL

# 1. Editor, AI Integration & Chat

## 1.1 ABAP Language Model Tools (AI Assistant Features)

**Purpose:** Backend tools that Copilot Chat uses to help you

**How to Use:** **ASK COPILOT** in chat in **Agent mode**

**Example Questions:**

- \"Where is BAPI_USER_GET_DETAIL used?\" → Copilot calls
  find_where_used tool

- \"Show me the code for ZCL_MY_CLASS\" → Copilot calls
  get_abap_object_lines tool

- \"Find all classes with \'pricing\' in the name\" → Copilot calls
  search_abap_objects tool

- \"Create a new class ZCL_TEST\" → Copilot calls
  create_object_programmatically tool

- \"Run ATC on ZTEST_PROG\" → Copilot calls run_atc_analysis tool

**Available Tools for Copilot:**

1.  **search_abap_objects** - Search by name patterns with wildcards

2.  **get_abap_object_lines** - Read source code from objects. For classes, Copilot can use `methodName` parameter to extract a specific method only (e.g., "Show me the FACTORY method from CL_SALV_TABLE")

3.  **search_abap_object_lines** - Search text within code (supports regex). Can also discover class structure using regex patterns

4.  **get_abap_object_info** - Get metadata about objects

5.  **get_batch_lines** - Read multiple objects at once

6.  **get_object_by_uri** - Direct ADT URI access

7.  **create_object_programmatically** - Create new ABAP objects
    **(Note: Still shows transport dialogs despite name)**

8.  **get_abap_object_url** - Generate SAP GUI URLs for automation

9.  **get_abap_object_workspace_uri** - Get VS Code workspace URI

10. **open_object** - Open objects in editor

11. **run_unit_tests** - Execute unit tests

12. **create_test_include** - Create test class includes

13. **run_atc_analysis** - Run code quality checks

14. **get_atc_decorations** - Get current ATC highlights

15. **manage_text_elements** - Read/create/update text elements (READ
    works on all systems, CREATE/UPDATE only on newer systems)

16. **manage_transport_requests** - Get transport info, compare transports (has fallback for older systems)

17. **find_where_used** - Find all references to objects/symbols

18. **analyze_abap_dumps** - Analyze runtime errors

19. **analyze_abap_traces** - Performance trace analysis

20. **execute_data_query** - Run SQL queries and display results

21. **get_abap_sql_syntax** - **Copilot can get ABAP SQL syntax information for generating correct SQL queries

22. **create_mermaid_diagram** - Generate flowcharts and diagrams

23. **validate_mermaid_syntax** - Check diagram syntax

24. **get_mermaid_documentation** - Get diagram syntax help

25. **detect_mermaid_diagram_type** - Auto-detect diagram types

26. **create_test_documentation** - Generate Word docs from screenshots

27. **get_sap_system_info** - Get SAP system info (client, system type S/4HANA vs ECC, release, components). Results are cached for 24 hours. Use command "Refresh SAP System Info Cache" to clear.

28. **get_version_history** - Get version history, retrieve code at historical versions, or compare versions (see Section 8.2)

29. **Debugging Tools (for Copilot):** -- Needs more work to stabilize

- **abap_debug_session** - Start/stop debugging

- **abap_debug_breakpoint** - Set/remove breakpoints

- **abap_debug_step** - Control execution flow

- **abap_debug_variable** - Inspect variables

- **abap_debug_stack** - View call stack

- **abap_debug_status** - Check debug status

## 1.2 Enhanced Hover Information

**Purpose:** Rich contextual information on hover over ABAP code

**How to Use:**

- Hover over ABAP keywords, variables, objects, system fields

- Wait for hover delay (configurable, default 700ms)

**Features:**

- System variable explanations (sy-subrc, sy-tabix, etc.)

- Built-in type information

- Object metadata

- Function module signatures/definitions

- Class/method signatures/implementations

# 2. SAP GUI Integration

## 2.1 Embedded SAP GUI (WebView)

**Purpose:** Run programs in embedded SAP GUI within VS Code

**How to Use:**

- Press **Ctrl+Shift+F7** with ABAP file open OR

- Click embedded GUI button in editor toolbar OR

- Command palette: ABAP FS: Open SAP GUI in embedded WebView

**Features:**

- Full SAP GUI experience in VS Code webview

- No need to switch windows

- Integrated within editor

**Requirements:**

- Chrome/Chromium browser (for rendering)

- WebGUI enabled on SAP system

- Proper SAP GUI configuration in connection settings

**Keyboard Shortcut:** Ctrl+Shift+F7

## 2.2 Native Desktop SAP GUI

**Purpose:** Launch programs in desktop SAP GUI application

**How to Use:**

- Press **Ctrl+Shift+F5** with ABAP file open OR

- Click desktop GUI button in editor toolbar OR

- Command palette: ABAP FS: Open in native SAP GUI desktop
  application

**Features:**

- Opens in installed SAP GUI

- Full SAP GUI functionality

- Better performance for complex transactions

**Requirements:**

- SAP GUI for Windows installed

- Proper connection configuration

**Keyboard Shortcut:** Ctrl+Shift+F5

## 2.3 Web Browser SAP GUI

**Purpose:** Open programs in external web browser

**How to Use:**

- Press **Ctrl+Shift+F6** with ABAP file open OR

- Click browser GUI button in editor toolbar OR

- Command palette: ABAP FS: Open SAP GUI in external web browser

**Features:**

- Opens in default browser

- Useful for sharing URLs

- Works on any OS

**Requirements:**

- WebGUI enabled on SAP system

**Keyboard Shortcut:** Ctrl+Shift+F6

# 3. Object Management

## 3.1 Object Search

**Purpose:** Find ABAP objects across the system

**How to Use:**

- Command palette: ABAP FS: Search for object OR

- Ask Copilot: \"Find all classes starting with ZCL\_\"

**Features:**

- Wildcard support (Z\*, \*USER\*, etc.)

- Multiple object type filtering

- Quick navigation to results

- You can select object types to search and choose to save default types
  to search to avoid selecting each time

**Note: Unsupported object types will be automatically opened in SAP
GUI**

**Supported Object Types:**

- FUNC (Function Modules)

- CLAS (Classes)

- TABL (Database Tables)

- PROG (Programs/Reports)

- INTF (Interfaces)

- DTEL (Data Elements)

- DDLS (CDS Views)

- DOMA (Domains)

- TTYP (Table Types)

- ENQU (Lock Objects)

- MSAG (Message Classes)

- FUGR (Function Groups)

- DEVC (Packages)

- TRAN (Transactions)

- VIEW (Views)

- ENHC/ENHS (Enhancements)

- BADI (BAdI Definitions)

- And 30+ more types

## 3.2 Create Objects

**Purpose:** Create new ABAP development objects

**How to Use:**

- Command palette: ABAP FS: Create object OR

- Right-click in explorer → Create object OR

- Ask Copilot: \"Create a new class ZCL_TEST with description \'Test
  class\'\"

**How it Works:**

- **Manual Creation:** Shows wizard dialogs for input

- **Programmatic Creation (via Copilot):** Still shows transport request
  dialog (not fully automated)

**Supported Creation Types:**

- Reports/Programs (PROG/P)

- Classes (CLAS/OC)

- Interfaces (INTF/OI)

- Function Groups (FUGR/F)

- Data Elements (DTEL/DE)

- Domains (DOMA)

- Database Tables (TABL/DT)

- CDS Views (DDLS)

- Message Classes (MSAG/N)

- Packages (DEVC/K)

- And more\...

**Limitations:**

- Transport request selection still requires user interaction

- Package selection may still show dialog

- Not fully \"programmatic\" despite the feature name

## 3.3 Open Objects

**Purpose:** Open objects in VS Code editor

**How to Use:**

- Ask Copilot: \"Open ZCL_MY_CLASS\" OR

- Command: ABAP FS: Search for object → Select object

- Double-click in explorer views

**Features:**

- Opens in VS Code editor

- Syntax highlighting

- Full editing capabilities

- Shows in file explorer

## 3.4 Object Activation

**Purpose:** Save and activate ABAP objects

**How to Use:**

- Press **Alt+Shift+F3** OR

- Click activation button in editor toolbar OR

- Save file (if auto-activate enabled)

**Features:**

- **Mass Activation:** If multiple related objects are inactive (e.g.,
  program + includes), shows dialog to select which objects to activate
  together

- Auto-save before activation

- Includes detection (program + includes)

- Child object activation (class + methods)

- Visual feedback

**Keyboard Shortcut:** Alt+Shift+F3

**Mass Activation Details:**

- Detects inactive related objects automatically

- Shows selection dialog with all inactive objects

- Pre-selects all objects

- User can deselect objects they don\'t want to activate

- Activates selected objects together

## 3.5 Favorites Management

**Purpose:** Quick access to frequently used objects

**How to Use:**

- Right-click object in explorer → Add favourite

- View in \"Favorites\" panel in explorer

- Click to open

**Features:**

- Persisted across sessions

- Quick navigation

- Delete from favorites

**Location:** Explorer sidebar → Favorites view

## 3.6 Show Table Contents

**Purpose:** View database table data

**How to Use:**

- Open database table object

- Click \"Show table contents\" button OR

- Right-click table → Show table contents

**Features:**

- Interactive data grid

- Sorting and filtering

- Export capabilities

- Pagination

- like SE16N

## 3.7 Compare Objects Across Systems

**Purpose:** Compare the same ABAP object between different SAP systems (DEV vs QA, QA vs PROD, etc.)

**How to Use:**

- Right-click ABAP file in Explorer → **Compare With another SAP System** OR

- Right-click inside editor → **Compare With another SAP System** OR

- Command palette: **ABAP FS: Compare With another SAP System**

**Features:**

- Side-by-side diff view of same object in different systems

- Quick system selection from connected systems

- Automatic path translation for SAP version differences:
  - Newer systems: "Source Code Library"
  - Older systems: "Source Library"
  - Automatically tries both paths

- Works from both Explorer context menu and Editor context menu

- Clean diff title showing: `OBJECT_NAME: DEV100 ↔ QA100`

**Requirements:**

- At least 2 SAP systems connected

- Same object must exist in both systems, will throw error otherwise

**Use Cases:**

- Compare DEV vs QA to verify transport

- Compare QA vs PROD to check production version

- Debug why code works in one system but not another

- Verify code differences before deployment

**Limitations:**

- Only shows connected systems in quick pick

- If object doesn't exist in target system, shows error after trying both path variants

# 4. Code Quality & Analysis

## 4.1 ABAP Test Cockpit (ATC) Analysis

**Purpose:** Comprehensive code quality and security checks

**How to Use:**

- Press **Ctrl+Shift+F2** with ABAP file open OR

- Command palette: ABAP FS: Run ABAP Test cockpit OR

- Ask Copilot: \"Run ATC on this file\"

**Features:**

- Full ATC check execution

- **Visual decorations in editor** - Errors, warnings, and info messages
  shown as colored underlines

- **Enhancements in standard code shown in VSCode** - Shows where
  enhancements are applied with 🎯 markers

- Results in dedicated ATC panel

- Quick fixes for some issues

- Severity filtering (error, warning, info)

- **Exemption request** support

- AI-powered fix suggestions

- **Auto-refresh on activation** (configurable)

**Results Panel Features:**

- **Filter exempted findings** - Toggle to show/hide exempted issues

- **Auto-refresh** - Toggle to automatically re-run ATC after activation

- **Request exemption** - Request exemption for single or multiple
  findings

- **Show documentation** - View detailed docs for check

- **Navigate to code** - Click to jump to issue location

**Keyboard Shortcut:** Ctrl+Shift+F2

**Location:** Activity Bar → ABAP FS → ATC finds

**Enhancement Decorations:**

- 🎯 Markers show where enhancements are implemented

- Hover shows enhancement details

- Click link to open enhancement source code

- Works for standard SAP code with enhancements

## 4.2 ABAP Cleaner Integration

**Purpose:** Automated code formatting and cleanup

**How to Use:**

- Press **Ctrl+Shift+Alt+F** with ABAP file open OR

- Click Cleaner button with ABAP file open OR

- Command palette: ABAP FS: Clean ABAP Code with ABAP Cleaner with
  ABAP file open OR

- Enable auto-clean on save

**Features:**

- Full ABAP Cleaner rule execution

- Custom profile support

- Target ABAP release selection

- Statistics display

- Applied rules reporting

- Line range cleaning (selected lines only)

**Requirements:**

- ABAP Cleaner command-line tool installed (abap-cleanerc.exe)

- Executable path configured

**Setup:**

1.  Download ABAP Cleaner from https://github.com/SAP/abap-cleaner

2.  Extract abap-cleanerc.exe to a folder

3.  Run command: ABAP FS: Setup ABAP Cleaner Integration

4.  Provide path to executable

**Keyboard Shortcut:** Ctrl+Shift+Alt+F

## 4.3 Syntax Validation

**Purpose:** Syntax checking triggers automatically when opening ABAP
files, editing, saving changes and during activation

**How to Use:**

- Open/Edit/Save/Activate ABAP files

- Errors shown in Problems panel

- Inline error indicators

**Features:**

- Error highlighting

- Quick navigation to errors

- Quick fixes with inline AI chat

## 4.4 Where-Used Analysis

**Purpose:** Find all references to objects, methods, variables

**How to Use:**

- Ask Copilot: \"Where is BAPI_USER_GET_DETAIL used?\" OR

- Right-click symbol → Find References

**Features:**

- System-wide search

- Method/variable-level precision

- Code snippets in results

- Filtering options:

  - Exclude standard objects (find only custom Z/Y code)

  - Filter by object type

  - Object name pattern filtering

- Pagination for large result sets (1000+ references)

**Limitations:**

- Large result sets (1000+) require pagination

- Custom Z/Y objects often at end of results - use filters to find them
  efficiently

# 5. Debugging Features

## 5.1 ABAP Debugging

**Purpose:** Full debugging support in VS Code

**How to Use:**

- Set breakpoints by clicking in gutter OR

- Press **Shift+F12** to jump to cursor during debugging OR

- Ask Copilot to set breakpoints or start debugging

**Features:**

- Visual breakpoints

- Conditional breakpoints

- Variable inspection with enhanced features:

  - Pattern-based filtering (LT\_\* for tables, LS\_\* for structures)

  - Auto-expand structures

  - Auto-expand tables

  - Advanced filters

  - Scope inspection (Local Variables, SY, etc.)

  - Expression evaluation

- Call stack viewing

- Step operations:

  - Continue (F5)

  - Step Over (F6)

  - Step Into (F7)

  - Step Return (F8)

  - Jump to Line

- Session management

- Multi-threaded debugging (up to 20 concurrent threads, configurable)

**Debug Tools (via Copilot):**

- \"Start debugging session\"

- \"Set breakpoint at line 42\"

- \"Show me the value of lt_data\"

- \"Show me all variables starting with LT\_\"

- \"Expand the structure ls_header\"

- \"Show me the call stack\"

- \"Step into this method\"

**Safety:**

- **Production System Guard:** When Copilot tries to start a debug session on a 
  production system, a dialog prompts for confirmation. Production debugging 
  poses security risks (sensitive data exposure), stability risks (VS Code 
  debugging can be fragile), and performance impacts. 
  **Recommendation:** Use SAP GUI for production debugging.

**Keyboard Shortcuts:**

- Jump to cursor: Shift+F12

- Standard VS Code debugging shortcuts work

# 6. Data Query & Visualization

## 6.1 SQL Query Execution

**Purpose:** Execute SQL queries and display results interactively

**How to Use:**

- Ask Copilot: \"Show me the first 10 records from MARA\" OR

- Ask Copilot: \"Query users from table USR02 where name starts with
  \'Z\'\"

**Features:**

- Interactive data tables with Tabulator

- Sorting (single and multi-column)

- Filtering (supports wildcards \*, ?)

- Row range extraction

- Export capabilities

- SQL syntax tool that Copilot can use to understand correct ABAP SQL
  syntax before generating queries

- **Displays ANY structured data** - not just SAP SQL, can show JIRA
  issues, task lists, etc.

**Query Options:**

- SQL mode: Run ABAP SQL queries on SAP tables

- Data mode: Display any structured data (columns + values)

**Safety Features:**

- Max row limit (default 1000, max 50000)

- Row range restriction for internal processing

- Prevents accidental large data transfers

- **Production System Guard:** When Copilot requests data in internal mode
  (data sent back to Copilot) from a production system, a dialog prompts you to:
  - Run & send results to Copilot
  - Run & show in UI only (data not sent to Copilot)
  - Cancel the query
  
  This protects sensitive production data from being inadvertently shared.

**Display Modes:**

- **UI mode:** Shows results in interactive webview for user

- **Internal mode:** Returns data to Copilot for analysis (requires row
  range)

**Note:** ABAP SQL UP TO x ROWS doesn\'t work via ADT - use maxRows
parameter instead (Copilot will handle that)

# 7. Transport Management

## 7.1 Transport Request View

**Purpose:** Manage SAP transport requests

**How to Use:**

- View in Activity Bar → ABAP FS → Transports panel

**Features:**

- List user\'s transports

- List transports for any user

- View transport objects

- Compare transports (find differences)

- Copy transport number to clipboard

- Run ATC on transport

- Open transport in GUI

- Release transports

- Delete transports

- Change transport owner

- Add users to transport

- Add transport to source control

- Refresh transports list

**Transport Request Tool (via Copilot):**

- \"Show me my transports\"

- \"Get details for transport DEVK900123\"

- \"What objects are in transport DEVK900123?\"

- \"Compare transports DEVK900123 and DEVK900124\"

**Fallback for Older Systems:** If the ADT transport API is not
available, tool automatically queries transport tables directly (E070,
E071, E071K) using SQL

**Location:** Activity Bar → ABAP FS → Transports

## 7.2 Transport Object Operations

**Purpose:** Work with objects in transports

**How to Use:**

- Right-click transport object in Transports view

**Features:**

- Open object in editor

- Diff with current version

- Reveal in explorer

# 8. Version Control

## 8.1 abapGit Integration

**Purpose:** Git version control for ABAP objects

**How to Use:**

- Activity Bar → ABAP FS → abapGit panel

**Features:**

- Create Git repositories

- Link existing repos

- Pull from Git (overwrites local changes)

- Push to Git (commit changes)

- Stage/unstage changes

- Register in VS Code source control

- View repository status

- Unlink repositories

**Location:** Activity Bar → ABAP FS → abapGit

## 8.2 ABAP Revision History

**Purpose:** View and compare historical versions of objects

**How to Use:**

- Command palette: ABAP: Show object history OR

- Right-click object in transports → Add transport to source control OR

- Ask Copilot: "Show version history for ZCL_MY_CLASS"

**Features:**

- View revision history

- Diff with any revision

- Normalized diff (formatted comparison)

- Navigate revisions (previous/next)

- Code normalization toggle

- Restore old versions

**Version History Tool (via Copilot):**

The `get_version_history` tool provides three actions:

- **list_versions** (default) - Shows version history with dates, authors, transports, and titles

- **get_version_source** - Retrieves complete source code at a specific historical version

- **compare_versions** - Compares two versions and shows added/removed lines

**Example Copilot Questions:**

- "Show version history for ZCL_MY_CLASS"

- "Who changed ZCL_MY_CLASS recently?"

- "Get the code from version 2 of ZCL_MY_CLASS" (version 1 = most recent)

- "Compare version 1 and version 3 of ZCL_MY_CLASS"

- "What changed between the last two versions of ZTEST_PROGRAM?"

# 9. Testing Features

## 9.1 Run Unit Tests

**Purpose:** Execute ABAP unit tests

**How to Use:**

- Click test beaker icon in editor toolbar OR

- Command palette: ABAP FS: Run ABAP Unit Tests OR

- Ask Copilot: \"Run unit tests for ZCL_MY_CLASS\"

**Features:**

- Executes all unit tests in object

- Results in VS Code Testing panel

- Pass/fail indicators

- Test coverage information

- Test duration reporting

**Unit Test Tool (via Copilot):**

The `run_unit_tests` tool returns **structured results to Copilot**:

- **Pass/Fail Status:** Copilot receives whether all tests passed or some failed

- **Test Counts:** Total tests, passed count, failed count

- **Execution Time:** Total time and per-method timing

- **Detailed Results:** Individual test class and method results with failure alerts

- **Actionable Feedback:** Copilot can analyze failures and suggest fixes

**Example Copilot Questions:**

- "Run unit tests for ZCL_MY_CLASS"

- "Execute tests on this class and tell me what failed"

- "Check if ZCL_PRICING tests pass"

- "Run tests and fix any failures"

**Requirements:**

- ABAP unit test classes defined in object

**Location:** Results appear in VS Code Testing view (beaker icon in
sidebar) AND returns to Copilot for analysis

## 9.2 Create Test Classes

**Purpose:** Generate unit test class skeleton

**How to Use:**

- Right-click class file → Create test class include OR

- Command palette: ABAP FS: Create test class include OR

- Ask Copilot: \"Create test class for ZCL_MY_CLASS\"

**Features:**

- Creates test include file

- Opens in editor

- Proper test class structure

- Links to main class

**Create Test Include Tool (via Copilot):**

The `create_test_include` tool creates a unit test class for an existing ABAP class.

**Example Copilot Questions:**

- "Create test class for ZCL_MY_CLASS"

- "Add unit tests to this class"

- "Set up testing for ZCL_PRICING"

**Requirements:**

- Must be a class file (\*.clas.abap)

## 9.3 Test Documentation Generator

**Purpose:** Create professional Word documents from test screenshots

**How to Use:**

- Ask Copilot with screenshot file paths:

- \"Create test documentation with these screenshots:

- Scenario 1: Login Happy Path

- \- C:\\tests\\login1.png - Login page

- \- C:\\tests\\login2.png - Successful login\"

**Features:**

- Professional Word document output

- Organized by test scenarios

- Screenshot embedding

- Descriptions for each screenshot

- Scenario-based organization

- Custom titles and dates

- Proper formatting

**Use Case:**

- Playwright test documentation

- Manual test documentation

- QA reporting

- Test evidence collection

# 10. Documentation & Diagrams

## 10.1 Mermaid Diagram Creation

**Purpose:** Generate flowcharts and diagrams for ABAP code

**How to Use:**

- Ask Copilot: \"Create a flowchart showing the flow of method
  PROCESS_DATA\" OR

- Ask Copilot: \"Generate a class diagram for ZCL_MY_CLASS\"

**Features:**

- Interactive webview with zoom controls (default 200%)

- Smooth 20% zoom increments

- Save diagrams

- Multiple diagram types supported:

  - Flowcharts

  - Sequence diagrams

  - Class diagrams

  - State machines

  - ER diagrams

  - User journeys

  - Gantt charts

  - Pie charts

  - Git graphs

  - Mind maps

  - Timelines

  - Sankey diagrams

  - XY charts

  - Block diagrams

  - Packet diagrams

**Themes:** default, dark, forest, neutral

**Tools (via Copilot):**

- create_mermaid_diagram - Create and display diagram

- validate_mermaid_syntax - Check syntax before rendering

- get_mermaid_documentation - Get syntax help

- detect_mermaid_diagram_type - Auto-detect diagram type

## 10.2 ABAP Documentation

**Purpose:** View SAP help for ABAP keywords

**How to Use:**

- Press **F1** with cursor on ABAP keyword OR

- Command palette: ABAP FS: Show ABAP documentation

**Features:**

- Context-sensitive help

- Opens SAP documentation

- Keyword-based lookup

**Keyboard Shortcut:** F1

# 11. Developer Tools

## 11.1 ABAP Dumps Analysis

**Purpose:** Analyze runtime errors and dumps

**How to Use:**

- Activity Bar → ABAP FS → Dumps panel OR

- Ask Copilot: \"Analyze the latest dumps\" OR

- Ask Copilot: \"Show me dumps from today\"

**Features:**

- List available dumps (with ID, error type, timestamp, content size)

- Detailed dump analysis (specific dump by ID)

- AI-powered root cause analysis

- Fix suggestions

- Structured dump data parsing

- HTML content analysis (safe structure parsing)

**Dump Actions:**

- List dumps - Shows all available dumps

- Analyze dump - Deep analysis of specific dump

- Refresh - Update dump list

- Delete - Remove old dumps

**Tools (via Copilot):**

- \"List all dumps from today\"

- \"Analyze dump with ID xyz123\"

- \"What caused the RABAX error?\"

**Location:** Activity Bar → ABAP FS → Dumps

## 11.2 Performance Traces

**Purpose:** Analyze ABAP performance traces

**How to Use:**

- Activity Bar → ABAP FS → Traces panel OR

- Ask Copilot: \"Show me recent trace runs\" OR

- Ask Copilot: \"Analyze trace for performance bottlenecks\"

**Features:**

- List trace runs (with performance summary)

- List trace configurations

- Detailed trace analysis with bottleneck detection

- Statement-level performance data

- Hit count and timing analysis

- Auto-fallback to hitlist for Aggregated Traces

- **Automatic bottleneck identification:**

  - Database bottlenecks

  - ABAP processing issues

  - Performance hotspots

**Trace Actions:**

- List runs - Recent trace executions

- List configurations - Available trace configs

- Analyze run - Detailed analysis with bottlenecks

- Get statements - Statement-level performance

- Get hitlist - Hit count and timing

- Refresh - Update trace list

- Delete - Remove trace data

**Tools (via Copilot):**

- \"Show me trace runs from today\"

- \"Analyze trace xyz for bottlenecks\"

- \"What are the slowest statements in trace xyz?\"

**Perfect For:**

- Performance optimization

- Bottleneck analysis

- SQL performance tuning

- Identifying slow code

**Location:** Activity Bar → ABAP FS → Traces

## 11.3 Text Elements Management

**Purpose:** Manage translatable text elements in programs, classes, and
function groups

**How to Use:**

- Command palette: ABAP FS: Text Elements Manager OR

- Right-click ABAP file → Text Elements Manager OR

- Ask Copilot: \"Show me text elements for ZTEST_PROGRAM\"

**Features:**

- **Read text elements** - Works on ALL SAP systems (newer and older)

- **Create text elements** - Only on newer systems with ADT text
  elements API

- **Update text elements** - Only on newer systems with ADT text
  elements API

- **Fallback for older systems:** Opens text elements editor in SAP GUI
  if ADT API not available

**Limitations:**

- CREATE/UPDATE only work on systems with ADT text elements API support

- Older systems automatically fallback to SAP GUI editor

- READ operation works on all systems

**Tool (via Copilot):**

- \"Show me text elements for ZTEST_PROGRAM\"

- \"Read text elements from ZCL_MY_CLASS\" (works on all systems)

- \"Create text element 001 with text \'Hello World\'\" (newer systems
  only)

**Manual Command:** Opens interactive webview editor for
creating/editing text elements

**Supported Object Types:**

- Programs (PROG)

- Classes (CLAS)

- Function Groups (FUGR)

## 11.4 Regex Search in Code

**Purpose:** Advanced search within ABAP source code

**How to Use:**

- Ask Copilot: \"Find all methods matching \'METHOD.\*get\' in
  ZCL_MY_CLASS\" OR

- Copilot uses search_abap_object_lines tool automatically

**Features:**

- **Regex support:** Full regular expression patterns

- **Word boundaries:** \\bICT\\b matches whole word ICT only

- **Pattern matching:** METHOD.\*restrict finds method definitions
  containing \"restrict\"

- **Character classes:** \[A-Z\]+ finds uppercase sequences

- **Context lines:** Configurable lines before/after match (default 3)

- **Wildcard object search:** Search multiple objects with Z\* patterns

- **Max objects control:** Limit how many objects to search (1-10)

- **Class structure discovery:** Copilot can use regex `^\s*(CLASS-)?METHODS?\s+\w+` with `contextLines=0` to list all methods in a class with their line numbers

**Class Structure Discovery:**

Copilot can use regex to discover class structure:

- "List all methods in CL_SALV_TABLE" → Uses regex to find all METHOD declarations

- Returns method names with line numbers for quick navigation

**Method Extraction:**

For extracting specific method code, use `get_abap_object_lines` with `methodName` parameter:

- "Show me the FACTORY method from CL_SALV_TABLE"

- Returns complete method code from METHOD...ENDMETHOD

- Handles comments correctly (ignores commented METHOD/ENDMETHOD lines)

- Supports interface method syntax (e.g., IF_INTERFACE~METHOD_NAME)

**Literal vs Regex:**

- Literal mode (default): Fast exact text matching

- Regex mode: Powerful pattern matching with regex syntax

**Limitations:**

- Searches **committed code only** - doesn\'t see unsaved local edits

- Use VS Code search for local unsaved changes

## 11.5 Enhanced Views & Panels

#### Activity Bar Views:

1. **Transports** - Transport request management
2. **Dumps** - Runtime error analysis
3. **ATC Finds** - Code quality results
4. **Traces** - Performance trace analysis
5. **abapGit** - Git repository management

#### Explorer Views:

1. **Favorites** - Quick access to frequent objects

#### Panel Views:

1. **ATC Documentation** - Detailed check documentation

## 11.8 Custom Editors

**Purpose:** Specialized editors for specific file types

**Editors:**

1.  **Message Class Editor** (\*.msagn.xml) - Visual message class
    editing

2.  **HTTP Service Editor** (\*.http.xml) - HTTP service configuration

## 11.9 ADT Feed Reader

Purpose: Monitor SAP system events and show notifications in real-time

How to Use:

- Setup: Command palette: ABAP FS: Configure ADT Feeds

<!-- -->

- Access \"Feed Inbox\" view in the sidebar

Features:

- Subscribe to system feeds (ABAP Runtime Errors, ATC Findings, System Messages, URI Creation Errors, etc.)

<!-- -->

- Configure polling intervals per feed

<!-- -->

- Enable/disable notifications for new entries

<!-- -->

- Use default queries or create custom query filters

<!-- -->

- View all feed entries in a unified inbox

<!-- -->

- Mark entries as read/unread

<!-- -->

- Click entries to open details in a WebView

Configuration:

- Select which feeds to monitor per connected system

<!-- -->

- Set polling intervals (default: 120 seconds for most feeds, 24 hours
  for ATC)

<!-- -->

- Enable/disable notifications per feed

<!-- -->

- Use quick templates or custom queries to filter entries

Supported Feeds:

- ABAP Runtime Errors (Dumps)

<!-- -->

- ATC Findings

<!-- -->

- System Messages

<!-- -->

- URI Creation Errors

<!-- -->

- And other system-specific feeds

Limitations:

- Only works on systems with ADT Feeds API support

- Older systems may not support all feed types

## 11.10 Run SAP Transaction

Purpose: Execute SAP transaction codes directly from VS Code

How to Use:

- Command palette: ABAP Copilot: Run SAP Transaction

<!-- -->

- Search for t-codes by name or enter directly (e.g., \"MM43\",
  \"SE38\")

Features:

- Search for transaction codes by name

<!-- -->

- Enter t-code directly in the search box

<!-- -->

- Opens transaction in your preferred GUI type

<!-- -->

- Respects connection-specific GUI preferences

Configuration: Configure GUI preference in connection settings
(sapGui.guiType):

How it Works:

1.  Select your SAP system (if multiple connected)

       2. Search for transaction or type tcode directly (e.g., \"MM43\")

      3. Press Enter or select from results

      4. Transaction opens in your configured GUI preference

Limitations:

- Native SAP GUI only works on Windows

<!-- -->

- Embedded WebView requires manual login (no SSO support)

<!-- -->

- Some transactions may not work properly in embedded mode

## 11.11 Message Class Editor

Purpose: Edit SAP message classes in a user-friendly table view instead
of raw XML

How to Use:

- Search for a message class (e.g., \"ZMY_MESSAGES\")

<!-- -->

- Message class automatically opens in custom table editor

<!-- -->

- Or manually open .msagn.xml files

Features:

- View: All messages displayed in an easy-to-read table format

<!-- -->

- Add: Click ➕ button to add new messages with automatic number
  suggestion

<!-- -->

- Edit: Click ✏️ button or double-click message text to edit

<!-- -->

- Delete: Click 🗑️ button to delete messages

<!-- -->

- Save: Ctrl+S to save all changes back to SAP

<!-- -->

- Validation: Automatic validation (max 72 characters, required fields)

How it Works:

- Add: System suggests next available message number (skips deleted
  ones)

<!-- -->

- Edit: Message text is validated and updated

- Delete: Message is marked as deleted (sent to SAP
  as \<mc:deletedmessages\>)

- Save: All changes (add/edit/delete) are saved together

Message Format:

- Message numbers are zero-padded (001, 002, etc.)

<!-- -->

- Message text limited to 72 characters

<!-- -->

- All standard SAP attributes preserved

Limitations:

- Only works with message classes (MSAG/N object type)

- Long text editing not supported

Visual Editor Features:

- Clean table layout with message number and text

<!-- -->

- Action buttons (Add, Edit, Delete) for each operation

<!-- -->

- Real-time validation feedback

<!-- -->

- Notifications for successful operations

## 11.12 SAP Connection Manager

**Purpose:** Modern webview-based UI for managing SAP system connections

**How to Use:**

- Command palette: **ABAP FS: Connection Manager** 

**Features:**

**Connection Management:**
- **Add/Edit/Delete** connections with visual form interface
- **Bulk operations:** Delete multiple connections, bulk edit usernames  
- **Dual storage:** Save to user settings (global) or workspace settings (project-specific)
- **Validation:** Automatic name validation, JSON syntax verification, rollback on error
- **Security:** Passwords stored in OS credential manager(will be asked during first connect), never in settings files

**Import/Export:**
- **Export connections** to JSON file for backup/sharing (user/passwords excluded for security)
- **Import from JSON** - merge connections from exported files
- **Cloud connection wizards:**
  - Create from BTP Service Key (JSON)
  - Create from BTP Endpoint (interactive CF login flow)

**Connection Configuration:**
- **Basic:** ADT URL, username, client, language
- **SSL:** Allow self-signed certificates, custom CA
- **SAP GUI:** Server, system number, router, message server, GUI type (Desktop/Embedded WebGUI/Browser)
- **OAuth:** Client ID, secret, login URL
- **Advanced:** ATC approver, ATC variant, max debug threads, diff formatter

**Bulk Operations:**
- **Select multiple connections** with checkboxes
- **Bulk delete** - remove multiple connections at once
- **Bulk username edit** - update username across multiple connections
- Visual confirmation dialogs for bulk actions

**Visual Features:**
- Color-coded sections (User vs Workspace settings)
- Expandable connection cards
- Real-time validation feedback
- Success/error notifications
- Automatic refresh after changes

**Requirements:** None - works on all systems

**Location:** Command Palette → ABAP FS: Connection Manager

## 11.13 Dependency Graph Visualizer

**Purpose:** Interactive visual dependency graph showing where-used relationships with expandable nodes

**How to Use:**

- Right-click in ABAP code → **Visualize Dependency Graph**
- Place cursor on specific method/variable for symbol-level graph
- Graph auto-builds for small graphs (<100 nodes), shows filter summary for large graphs
- For large graphs, update filters if needed and click "Build Graph" button

**Features:**

**Graph Visualization:**
- **Interactive nodes:** Double-click to open objects in editor
- **Dynamic expansion:** Right-click node → "Expand Dependencies" to discover deeper relationships
- **Symbol-level precision:** Place cursor on method/variable before opening graph to see its specific usage
- **Root node tracking:** Reset to original root object at any time
- **Color-coded nodes:**
  - Red = Root object (what you searched for)
  - Purple = Expanded nodes (where you've explored dependencies)
  - Dynamic colors per object type (auto-generated for maximum distinction)
  - Double border = Can expand further (more dependencies available)
  
**Layout Options:**
- **Cose** - Physics-based clustering (default)
- **Concentric** - Root in center, dependencies in rings
- **Breadthfirst** - Level-based tree from root
- **Circle** - Circular arrangement
- **Grid** - Ordered grid layout

**Filtering:**
- **Custom/Standard toggle:** Show only Z*/Y* objects or only SAP standard objects
- **Object type filter:** Show only specific types (CLAS, PROG, FUNC, etc.)
- **Usage type filter:** Filter by edge usage types (if available)
- **Name pattern filter:** Filter by object name with wildcards (e.g., Z*MD*)
- **Real-time counts:** Shows filtered/total count for each object type
- **Reset filters:** Clear all filters with one click

**Navigation:**
- **Double-click node:** Opens object in VS Code editor at exact usage location
- **Right-click node:** Context menu with Open/Expand/Focus options
- **Hover tooltip:** Shows object details (type, package, responsible, parent class for methods)
- **Fit to view:** Auto-zoom to fit entire graph
- **Pan/Zoom:** Mouse wheel zoom, drag to pan
- **Reset to root:** Restore original graph and clear expansions

**Expansion:**
- **Right-click node** → "Expand Dependencies" to fetch where this object is used
- **Tracks expansion state:** Purple nodes show what you've explored
- **Merge results:** New dependencies integrate into existing graph
- **Unlimited depth:** Explore dependencies as deep as needed

**Export:**
- **Export SVG:** Save graph as SVG image (non-interactive)
- No JSON export

**Context-Aware:**
- Automatically detects object type from open file
- Symbol-level analysis when cursor is on specific variable/method/class
- Shows exact line and column where object is used
- Parent class tracking for methods (enables filtering by class)

**Performance:**
- Graphs >100 nodes show filter summary first (apply filters and click "Build Graph" to render)
- Aggressive node spacing reduces overlap

**Requirements:** 
- ABAP file open in editor
- Active SAP connection
- Works on all object types (classes, programs, functions, etc.)

**Location:** Right-click menu → Visualize Dependency Graph

## ⚠️ Important Considerations

1.  **Create Objects \"Programmatically\"** - Still shows transport request dialogs (not fully automated)

2.  **Text Elements CREATE/UPDATE** - Only works on newer SAP systems with ADT API support

3.  **Transport Management** - May require direct table queries on older systems (automatic fallback)

4.  **Copilot Code Search** - Only searches committed code, not unsaved local changes

5.  **Mass Activation** - Requires user selection from dialog (not automatic)
    
6.  **Save/Activation** - Code changes are saved to SAP only when user manually saves (Ctrl+S, Keep button, etc) or activates(activate button). No more automatic saving to SAP as and when code is changed in VS Code editor. This is to ensure a human element always remain before code is commmitted to SAP (particularly for changes made by AI).

## 🎯 Key Differences: Commands vs Tools

### Commands (User-Invoked Manually):

- Run from Command Palette (Ctrl+Shift+P)

- Click buttons in UI
- Use keyboard shortcuts
- Examples:
  - ABAP FS: Create object
  - ABAP FS: Run ABAP Unit Tests
  - ABAP FS: Text Elements Manager

### Language Model Tools (Copilot Uses Automatically):

- Ask Copilot in chat to use them
- Copilot decides which tools to call
- Examples:
  - "Where is BAPI_USER_GET_DETAIL used?" → Copilot calls find_where_used
  - "Show me code for ZCL_MY_CLASS" → Copilot calls get_abap_object_lines
  - "Run ATC on this file" → Copilot calls run_atc_analysis

---

## 🔒 Privacy & Telemetry

**This extension does NOT send any telemetry data to external servers.**

### What Happens by Default

- **Local storage only**: Usage telemetry (tools/commands usage, number of code lines changed by Copilot) is stored in a local CSV file within the extension's storage folder on your machine
- **No external transmission**: No data is sent to any remote server, cloud service, or third party
- **No tracking**: The extension does not track users, collect personal data, or phone home
- **Your data stays with you**: All telemetry files remain on your local machine and are never uploaded

### For Organizations Wanting Central Telemetry

If your organization wants to collect telemetry centrally for analytics or monitoring purposes, you can:

1. **Fork the public repository** from GitHub
2. **Add your own Azure Application Insights connection string** in the telemetry service configuration
3. **Build your own VSIX package** with your App Insights key
4. **Distribute internally** to your organization's users

This gives organizations full control over:
- Whether to collect telemetry at all
- Where telemetry data is stored
- Who has access to the data
- Data retention policies

### Local Telemetry File Location

The local CSV telemetry file is stored at:
```
<VS Code Global Storage>/extension-path/telemetry-<date>.csv
```

You can delete these files at any time - it only contains local usage statistics for your own reference.

---

