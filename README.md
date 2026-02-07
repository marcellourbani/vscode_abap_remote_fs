# ABAP FS 🚀
- [ABAP FS 🚀](#abap-fs-)
  - [🎯 What Makes This Different?](#-what-makes-this-different)
  - [� Documentation](#-documentation)
  - [�🚀 Installation](#-installation)
    - [Prerequisites](#prerequisites)
    - [Installation Steps](#installation-steps)
  - [✨ Key Features](#-key-features)
    - [🤖 AI Integration \& Chat](#-ai-integration--chat)
    - [� MCP Server (For Non-GitHub Copilot Users)](#-mcp-server-for-non-github-copilot-users)
    - [�🔍 Object Management](#-object-management)
    - [🖥️ SAP GUI Integration](#️-sap-gui-integration)
    - [📊 Data \& Analysis](#-data--analysis)
    - [🧪 Debugging \& Testing](#-debugging--testing)
    - [🧹 Code Quality](#-code-quality)
    - [📦 Transport \& Version Control](#-transport--version-control)
    - [🔧 Developer Tools](#-developer-tools)
  - [📚 How It Works](#-how-it-works)
    - [AI Language Model Tools (26+ tools)](#ai-language-model-tools-26-tools)
    - [Commands (Manual Execution)](#commands-manual-execution)
  - [🔒 For Organization Administrators](#-for-organization-administrators)
    - [1. SAP System Whitelist (Optional Access Control)](#1-sap-system-whitelist-optional-access-control)
    - [2. Telemetry with Application Insights (Optional - For Organizations Only)](#2-telemetry-with-application-insights-optional---for-organizations-only)
    - [Building and Distributing](#building-and-distributing)
    - [Proxy Support](#proxy-support)
  - [⚠️ Limitations](#️-limitations)
    - [Third-Party Libraries](#third-party-libraries)

**AI-Powered ABAP Development in VS Code**

ABAP FS is a VS Code extension that brings AI-powered ABAP development to Visual Studio Code. It provides comprehensive AI integration through GitHub Copilot's Language Model Tools API (with [MCP support](DOCUMENTATION.md#mcp-server-for-external-ai-tools) for Cursor, Claude Code, Windsurf, Claude Desktop, and other AI tools). 30+ specialized tools give your AI assistant deep SAP system awareness—searching objects, reading code, running tests, executing queries, and more.

## 🎯 What Makes This Different?

**Context Awareness**: Connects directly to your SAP system. When you ask for help, it searches your actual system, reads real function signatures, queries actual tables, and understands your custom objects. The AI doesn't guess—it knows.

**Autonomous Investigation**: The AI explores your codebase independently. Ask "How does BAPI_USER_GET_DETAIL work?" and it finds the function, reads the code, checks where it's used, examines related objects—without you opening anything manually.

**Integrated Workflow**: Everything in one place—code, SAP GUI execution, debugging, ATC findings, runtime dumps, performance traces, transport management—without switching between tools. The AI can help with all of it because it has access to all of it.

**Natural Interaction**: Instead of memorizing commands or navigating menus, ask questions in plain language. "Where is this BAPI used?" "Show me all Z classes with 'pricing' in the name." "Run ATC and explain the findings." The AI uses the right tools automatically.

**Built for Reality**: Features like automatic fallbacks for older SAP systems, optional whitelist-based access control, and telemetry reflect real-world development needs.

## � Documentation

For comprehensive documentation covering all features in detail, see [DOCUMENTATION.md](DOCUMENTATION.md).

## �🚀 Installation

### Prerequisites
- VS Code 1.39.0 or higher
- SAP system with ADT (ABAP Development Tools) enabled
- GitHub Copilot subscription (for AI features)

**Note:** Unless your SAP system is very modern (NetWeaver 7.51 or later), write support will require you to install [abapfs_extensions plugin](https://github.com/marcellourbani/abapfs_extensions) in your development server. Browsing and reading work without it.

### Installation Steps

1. **Uninstall old version** (if installed)
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

## ✨ Key Features

### 🤖 AI Integration & Chat
- **30+ Language Model Tools** - Backend tools that GitHub Copilot uses automatically
- **Autonomous Agent Mode** - AI explores your codebase independently without manual navigation
- **Context-Aware Assistance** - AI understands your SAP system structure and objects
- Ask questions like:
  - "Where is BAPI_USER_GET_DETAIL used?"
  - "Show me the code for ZCL_MY_CLASS"
  - "Find all classes with 'pricing' in the name"
  - "Run ATC and explain the findings"
  - "Create a new class with unit tests"

### � MCP Server (For Non-GitHub Copilot Users)
- **Works with Cursor, Claude Code, Windsurf, Claude Desktop** - Any MCP-compatible AI tool
- **All 30+ tools exposed** - Read code, search, run tests, analyze dumps, etc.
- **Read-only limitation** - MCP tools can read but cannot edit ABAP files directly (apply changes manually in VS Code)
- **VS Code as host** - VS Code stays open as the SAP connection bridge
- See [MCP Server Documentation](DOCUMENTATION.md#mcp-server-for-external-ai-tools) for setup and full limitations

### �🔍 Object Management
- **Unified Object Search** - Search all SAP object types with wildcards (30+ types supported)
- **Programmatic Object Creation** - Create classes, programs, function groups, tables, CDS views, and more
- **Where-Used Analysis** - Find all references to objects, methods, variables with filtering
- **Mass Activation** - Activate multiple related objects together
- **Favorites** - Quick access to frequently used objects

### 🖥️ SAP GUI Integration
- **Embedded WebView GUI** - SAP GUI directly in VS Code
- **Desktop GUI Integration** - Launch native SAP GUI applications  
- **Web Browser GUI** - Open SAP GUI in external browser
- **Transaction Execution** - Run any SAP transaction code from VS Code

### 📊 Data & Analysis
- **SQL Query Browser** - Execute ABAP SQL with interactive results (sorting, filtering, export). Production system guard prompts before sending data to Copilot.
- **Runtime Dump Analysis** - AI-assisted error investigation with root cause analysis
- **Performance Trace Analysis** - Automatic bottleneck detection and optimization suggestions
- **Flow Diagrams** - Generate Mermaid diagrams (flowcharts, sequence diagrams, class diagrams, etc.)

### 🧪 Debugging & Testing
- **ABAP Debugger** - Full debugging with breakpoints, variable inspection, call stack. Production guard warns about security/stability risks.
- **Advanced Variable Inspection** - Pattern-based filtering (`LT_*`), auto-expand, scope inspection
- **Unit Test Runner** - Execute and view unit test results
- **Test Class Creation** - Generate test includes for classes
- **Test Documentation Generator** - Create professional Word documents with screenshots from Playwright tests

### 🧹 Code Quality
- **ATC Integration** - Run code quality checks with AI-assisted analysis
- **ABAP Cleaner** - Automated code formatting and cleanup
- **Syntax Validation** - Real-time syntax checking
- **Text Elements Manager** - Read/create/update translatable text elements

### 📦 Transport & Version Control
- **Transport Management** - View, compare, release transports with AI assistance
- **abapGit Integration** - Git version control for ABAP objects
- **Revision History** - View and compare object versions

### 🔧 Developer Tools
- **ADT Feed Reader** - Monitor SAP system events (dumps, ATC findings, messages) in real-time
- **Message Class Editor** - Visual table-based editor for message classes
- **Regex Code Search** - Advanced search within source code with regex patterns
- **Custom Editors** - Specialized editors for HTTP services and message classes

## 📚 How It Works

### AI Language Model Tools (26+ tools)

Copilot automatically uses these tools when you ask questions:

**Object Management:**
- `search_abap_objects` - Find objects by name patterns
- `get_abap_object_lines` - Read source code
- `search_abap_object_lines` - Search within code (regex support)
- `open_object` - Open in editor
- `create_object_programmatically` - Create new objects
- `find_where_used` - Where-used analysis

**Code Quality:**
- `run_atc_analysis` - Run code quality checks
- `get_atc_decorations` - Get current ATC highlights
- `manage_text_elements` - Read/create/update text elements

**Testing & Debugging:**
- `run_unit_tests` - Execute unit tests
- `create_test_include` - Create test classes
- `abap_debug_*` - Debugging operations (breakpoints, step, variables, call stack)

**Data & Analysis:**
- `execute_data_query` - Run SQL queries and display results (with production system guard)
- `get_abap_sql_syntax` - Get ABAP SQL syntax reference
- `get_sap_system_info` - Get SAP system info (cached for 24 hours)
- `analyze_abap_dumps` - Analyze runtime errors
- `analyze_abap_traces` - Performance trace analysis

**Transport & Documentation:**
- `manage_transport_requests` - Transport operations
- `create_mermaid_diagram` - Generate diagrams
- `create_test_documentation` - Generate Word test docs

**And many more...**

### Commands (Manual Execution)

Available via Command Palette (`Ctrl+Shift+P`):
- ABAP FS: Connect to an ABAP system
- ABAP FS: Search for object
- ABAP FS: Create object
- ABAP FS: Run ABAP Unit Tests
- ABAP FS: Text Elements Manager
- ABAP FS: Run SAP Transaction
- ABAP FS: Configure ADT Feeds
- And many more commands...

## 🔒 For Organization Administrators

If you want to deploy ABAP FS internally for your organization, you can configure two optional features before building and distributing the extension:

### 1. SAP System Whitelist (Optional Access Control)

Control which SAP systems users can connect to (e.g., allow only DEV systems, block PROD).

**Purpose:**
- Restrict connections to authorized systems only
- Prevent accidental connections to production systems
- Centrally manage allowed systems via network-accessible file

**How to Configure:**

1. **Create a whitelist JSON file** based on client/src/services/whitelist.example.json
   ```json
   {
     "version": {
       "minimumExtensionVersion": "1.0.0"
     },
     "allowedDomains": [
       "*dev*",
       "*test*",
       "*qa*"
     ],
     "developers": [
       {
         "manager": "Team_Lead_Name",
         "userIds": [
           "developer1",
           "dev1_alt_id"
         ]
       },
       {
         "manager": "Another_Manager",
         "userIds": [
           "developer2"
         ]
       }
     ]
   }
   ```
   
   **Important**: Each `developer` object represents ONE person with their multiple SAP user IDs across different systems. All `userIds` within one developer object will be tracked as the SAME person in telemetry (anonymized). Do NOT mix different people's IDs in one developer object.

2. **Deploy the file** to a network-accessible location (e.g., internal web server, artifact repository)
   - File must be directly accessible via HTTP/HTTPS without authentication
   - Users only need read access

3. **Update the whitelist URL** in client/src/services/sapSystemValidator.ts:
   ```typescript
   private readonly WHITELIST_URL = 'https://your-internal-server.com/whitelist.json';
   ```

4. **Allow all systems/users** (disable whitelist completely): Default is True. Make it false if you want to enable whitelist based control.
   ```typescript
   private readonly ALLOW_ALL_SYSTEMS = true;  // Skip system validation
   private readonly ALLOW_ALL_USERS = true;    // Skip user validation
   ```

**How It Works:**
- Extension fetches whitelist on startup and every 2 hours
- System IDs are matched against `allowedDomains` patterns (supports wildcards like `*dev*`, `*test*`)
- User IDs are validated against all `userIds` across all `developers` entries
- The `manager` field groups users for telemetry team analytics
- If fetch fails, falls back to hardcoded backup whitelist
- Corporate network retry: automatically retries for 10 minutes if initial fetch fails (useful for VPN scenarios)
- Users see status bar notification during retry attempts

**Validation Logic:**
- System validation: Checks if system hostname/domain matches any pattern in `allowedDomains`
- User validation: Checks if SAP username exists in any `userIds` array across all developers
- Both must pass for connection to succeed
- Multiple user IDs per person: If a developer has different user IDs on different systems (e.g., "john.doe" on DEV, "j0d0o3e" on QA), add all IDs to the same developer object

### 2. Telemetry with Application Insights (Optional - For Organizations Only)

**⚠️ IMPORTANT: The extension from VS Code Marketplace does NOT send any telemetry to external servers.**

By default, all telemetry is stored **locally only** in CSV files on your machine. No data is transmitted anywhere. This section is only relevant for organizations who want to set up their own central telemetry.

**Default Behavior (VS Code Marketplace Version):**
- ✅ Usage data stored in local CSV files only (`telemetry-YYYY-MM-DD.csv` in extension storage)
- ✅ No external transmission - nothing leaves your machine
- ✅ No tracking, no phone home, no third-party data collection
- ✅ You can delete local telemetry files anytime

---

**For Organizations Wanting Central Analytics:**

If your organization wants to collect usage analytics centrally, you can fork this repository and configure Azure Application Insights.

**Purpose:**
- Count how often each command is executed (e.g., "command_activate_called")
- Count how often each language model tool is used by Copilot (e.g., "tool_search_abap_objects_called")
- Track which SAP system and team each usage comes from
- Data helps prioritize feature development based on actual usage patterns

**How to Configure:**

1. **Fork this repository** from GitHub

2. **Create an Azure Application Insights resource** in your Azure subscription

3. **Get the connection/Instrumentation Key string** from Azure Portal → Application Insights → Overview → Connection String

4. **Update the connection string** in client/src/services/appInsightsService.ts:
   ```typescript
   const connectionString = 'InstrumentationKey=YOUR-KEY;IngestionEndpoint=https://...';
   ```

5. **Build your own VSIX** and distribute to your organization's users

**What Gets Collected:**
The telemetry service logs only action strings like:
- `command_activate_called` - When activation command is executed
- `tool_create_test_include_called` - When Copilot uses the test creation tool
- `tool_search_abap_objects_called` - When Copilot searches for objects

Each entry includes:
- **Anonymous user ID** - Hashed from `hostname + username + platform` (cannot be reverse-engineered)
- **Session ID** - Random ID per VS Code session
- **Extension version** - Version number for compatibility tracking
- **VS Code version** - VS Code version number
- **Platform** - OS type (Windows/Linux/Mac)
- **SAP system** - Which system was accessed (if applicable)
- **Manager/Team** - From whitelist developer mapping (if configured)

**What is NOT Collected:**
- No SAP credentials or passwords
- No source code or ABAP code content
- No object names or identifiers
- No business data or table contents
- No error messages or stack traces (by default - disabled via `setAutoCollectExceptions(false)`)
- No performance metrics or execution times (by default - disabled via `setAutoCollectPerformance(false, false)`)
- No HTTP requests (disabled via `setAutoCollectRequests(false)`)
- No dependencies (disabled via `setAutoCollectDependencies(false)`)
- No console logs (disabled via `setAutoCollectConsole(false)`)

**Note for Administrators**: The default configuration disables auto-collection of exceptions, performance metrics, requests, dependencies, and console logs. To enable additional telemetry before building the extension, modify client/src/services/appInsightsService.ts in the `initialize()` method:

- **Enable exception tracking**: Change `.setAutoCollectExceptions(false)` to `.setAutoCollectExceptions(true)` - automatically captures unhandled exceptions
- **Enable performance metrics**: Change `.setAutoCollectPerformance(false, false)` to `.setAutoCollectPerformance(true, true)` - tracks memory, CPU usage
- **Enable request tracking**: Change `.setAutoCollectRequests(false)` to `.setAutoCollectRequests(true)` - tracks HTTP requests
- **Enable dependency tracking**: Change `.setAutoCollectDependencies(false)` to `.setAutoCollectDependencies(true)` - tracks external dependencies

You can also add custom tracking by calling `appInsights.defaultClient.trackException()`, `appInsights.defaultClient.trackMetric()`, or `appInsights.defaultClient.trackEvent()` in your custom code.

**Privacy & Data:**
- User ID: Hashed from `hostname + username + platform` (anonymized, cannot be reverse-engineered to identify individuals)
- Session ID: Random generated per VS Code session
- Data stored locally in extension storage first (CSV files in extension global storage)
- If App Insights configured, events also sent to Azure (batched every 30 seconds)
- If network unavailable, events stored locally and retried later

**How It Works:**
- Telemetry service runs automatically in background
- Every command execution or tool usage is logged
- Events logged to local CSV files first (`telemetry-YYYY-MM-DD.csv`)
- If App Insights connection string configured, events also sent to Azure
- Local storage flushes every 5 minutes or when buffer reaches 25 entries
- Whitelist integration: If whitelist configured with `developers` structure, multiple `userIds` of same person are grouped together

**Telemetry Integration with Whitelist:**
If whitelist is configured with `developers` structure, telemetry will group users:
- Multiple `userIds` in the same developer object are tracked as one person (anonymized)
- `manager` field enables team-level analytics
- Example: If John has SAP IDs "john.doe", "j0d0o3e", and "john.d" across different systems, all three IDs in one developer object will be recognized as the same person in analytics

This helps answer questions like "Which team uses debugging most?" or "What features does Team X use?" while maintaining user anonymity.

### Building and Distributing

After configuration:

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build and package the extension**:
   ```bash
   # Windows
   build-and-install.bat
   
   # Or manually:
   npm run compile
   npx vsce package
   ```

3. **Distribute the `.vsix` file** to your users via:
   - Internal artifact repository
   - Shared network drive
   - Internal VS Code marketplace
   - Direct download

Users install via: Extensions → `...` → "Install from VSIX..."

**Note:** Both whitelist and telemetry are optional. The extension works fully without them.

### Proxy Support

There's no direct proxy support in the extension, but you can use VS Code's builtin proxy support. Enable it in your settings (workspace or global):

```json
{
  "http.proxySupport": "on",
  "http.proxy": "http://localhost:3128"
}
```

If you only want proxy for a specific system, configure it in that workspace's settings .

## ⚠️ Limitations

- **Text Elements** - CREATE/UPDATE only works on newer SAP systems with ADT API; older systems fall back to GUI
- **Transport Management** - May require direct table queries on older systems (automatic fallback)
- **Copilot Code Search** - Only searches committed code, not unsaved local changes
- **Save/Activation** - Code changes are saved to SAP only when user manually saves (Ctrl+S, Keep button, etc) or activates(activate button). No more automatic saving to SAP as and when you type.


### Third-Party Libraries
- **[Mermaid](https://github.com/mermaid-js/mermaid)** (MIT) - Diagram generation and visualization
- **[Tabulator](https://github.com/olifolkerd/tabulator)** (MIT) - Interactive data tables
- **[docx](https://github.com/dolanmiu/docx)** (MIT) - Word document generation
- **[Application Insights](https://github.com/Microsoft/ApplicationInsights-node.js)** (MIT) - Telemetry SDK
- **[Cytoscape.js](https://github.com/cytoscape/cytoscape.js)** (MIT) - Dependency Graph

See THIRD_PARTY_LICENSES.md for complete license details.

---

**License:** MIT (see LICENSE)
