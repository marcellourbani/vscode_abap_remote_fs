# ABAP FS — ABAP Development in VS Code

**ABAP FS** is a VS Code extension that connects directly to your SAP system — giving you (and your AI assistant) live access to read code, query tables, run tests, debug, and manage objects without leaving the editor.

Ask Copilot "How does BAPI_USER_GET_DETAIL work?" and it finds the function, reads the code, checks where it's used, and examines related objects — all autonomously using 40 specialized SAP tools.

If you're used to SE38, SE24, or ADT in Eclipse, ABAP FS brings that same direct-system connectivity into VS Code — plus AI assistance, modern tooling, and the full VS Code extension ecosystem.

> **GitHub Repository:** [github.com/marcellourbani/vscode_abap_remote_fs](https://github.com/marcellourbani/vscode_abap_remote_fs)

---

## What you can do

> **Note:** ABAP FS has 40+ AI tools, but only the documentation tool is available until you connect to a SAP system. Add SAP connections using Connection manager and then run `ABAP FS: Connect to an ABAP system` from the Command Palette to unlock all tools.

This is a high-level summary. See the left navigation for full feature pages.

| Area | Capabilities |
|------|-------------|
| **AI-Powered Development** | 40 tools give Copilot deep SAP awareness — search objects, read code, run tests, explain dumps, all via natural language |
| **Edit & Activate** | Browse, open, edit, and activate ABAP objects on the live system |
| **Editor Experience** | Enhanced hover info, custom editors, object properties, and dedicated ABAP views/panels |
| **Debug** | Full ABAP debugger with breakpoints, variable inspection, stepping, and debug recording |
| **Test** | Run unit tests, create test classes, generate test documentation |
| **SAP UI Testing** | Let Copilot analyse a report, design a test plan, automate it against SAP WebGUI, and produce a Word evidence report — see [SAP Testing](#sap-testing) |
| **Code Quality** | ATC analysis, syntax validation, where-used, ABAP Cleaner formatting |
| **Transport** | View and manage transport requests directly |
| **Version Control** | abapGit integration, revision history, blame gutter |
| **Data & SQL** | Run SQL queries against SAP tables, build multi-step data workbooks |
| **SAP GUI** | Launch embedded, native, or browser-based SAP GUI from the editor |
| **Diagrams & Docs** | Generate Mermaid diagrams and ABAP documentation from within VS Code |
| **Developer Tools** | REPL, Dumps/traces analysis, regex search, dependency graph, feed reader, communication log, RAP generator |

---

## New to ABAP FS?

1. [Installation](#installation-steps) — install the extension and connect to your SAP system
2. [Walkthrough](#getting-started-walkthrough) — a guided tour of the main features
3. [Connection Manager](#sap-connection-manager) — manage multiple SAP connections

---

## Using a non-GitHub Copilot AI tool?

Works with **Cursor, Claude Code, Windsurf, Claude Desktop**, and any MCP-compatible client.  
See [MCP Server](#mcp-server-for-external-ai-tools) for setup.

---

> **Tip:** GitHub Copilot (and any AI connected via MCP) has access to this documentation. Just ask your AI assistant about any feature and it can guide you.

# Installation Steps

Before proceeding, ensure you meet the [Prerequisites](prerequisite.md).

> **Note:** ABAP FS registers 40+ AI tools for Copilot, but only the documentation tool is available until you connect to a SAP system. Connect to SAP first to unlock all tools.

## 1. Install the extension

1. Press `Ctrl+Shift+X` or Click on the extension icon on the activity bar to open the **Extensions** panel (left sidebar)
2. Search for **murbani.vscode-abap-remote-fs** or **ABAP remote filesystem**
3. Click **Install**, then restart VS Code

![Installation instructions](installationImage.png)

## 2. Configure a SAP system connection

1. Press `Ctrl+Shift+P` to open the **Command Palette** (the search bar for VS Code commands)
2. Type and run: **ABAP FS: Connection Manager**
3. In the connection manager window, click **Add SAP System** and fill in:
   - **URL** – your SAP system URL
   - **Client**, **Username**, **Language**
   - SAP GUI settings (optional)
4. Choose where to save the connection:
   - **User settings** – available in all your VS Code workspaces
   - **Workspace settings** – stored in the current project folder only

**Tips:**

- Passwords are stored in the OS credential manager, not in settings files.
- If a colleague already has connections configured, ask them to export via **Import/Export** and send you the JSON. User IDs and passwords are excluded from exports. You can then import and update your credentials in bulk using **Bulk Operations**.
- For SAP BTP systems, use **Cloud Support** to create a connection from a BTP Service Key or Endpoint.

## 3. Connect to a SAP system

1. Press `Ctrl+Shift+P` and run: **ABAP FS: Connect to an SAP system**
2. Select the system you configured
3. Enter your password if prompted
4. Wait a moment for VS Code to establish the connection

## Password Management

- **Change password:** `Ctrl+Shift+P` → **ABAP FS: Change Connection Password** — select a system and enter your new password.
- **Forget password:** `Ctrl+Shift+P` → **ABAP FS: Forget connection password** — removes the stored password so you're prompted again on next connect.

## 4. Verify the connection

- Look for the **ABAP FS** icon in the **Activity Bar** (the vertical icon strip on the far left)
- Expand the views: **Transports**, **Dumps**, **ATC Finds**, **Traces**, **abapGit**
- Test object search: `Ctrl+Shift+P` → **ABAP FS: Search for object**

## Updates

The extension updates automatically if installed from the VS Code Marketplace and auto-update is enabled. To check: open the Extensions panel (`Ctrl+Shift+X`), find the extension, and verify **Auto Update** is on.

# Getting Started Walkthrough

When you install ABAP FS, VS Code automatically opens an interactive walkthrough. It guides you through the extension's features in a structured, step-by-step format.

## Walkthrough Stages

The walkthrough covers four progressive stages:

1. **Getting Connected** — Activate the extension, connect to an SAP system, navigate objects, search, run transactions, and launch SAP GUI.

2. **Core Features** — ABAP Cleaner, ATC code analysis, blame annotations, debugging, dump analysis, performance traces, transport management, unit tests.

3. **AI & Copilot** — AI-powered search, data queries, diagrams, where-used analysis, version history comparisons, AI-assisted unit tests, and skills.

4. **Advanced** — Communication log, cross-system comparison, debug recording & replay, dependency graphs, feed inbox, heartbeat monitoring, MCP setup, subagents, text elements.

## Re-opening the Walkthrough

The walkthrough shows automatically only once. To open it again:

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) to open the **Command Palette** — a search bar for all VS Code commands.
2. Type **ABAP FS:Show Walkthrough** and press `Enter`.
3. Search for **ABAP** and select the walkthrough you want.

Alternatively, open **Help → Welcome** from the menu bar, then select the ABAP FS walkthrough from the list.

# SAP Connection Manager

> **Important:** ABAP FS has 40+ AI tools for Copilot, but they are only available once you connect to a SAP system. Use the Connection Manager to add your first system.

The Connection Manager is a visual interface for adding, editing, and organizing your SAP system connections. Open it from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) by typing **ABAP FS: Connection Manager**.

## Adding a Connection

1. Open the Command Palette (`Ctrl+Shift+P`) and run **ABAP FS: Connection Manager**.
2. Click **Add Connection**.
3. Fill in the required fields (see [Configuration Fields](#configuration-fields) below).
4. Choose where to save: **User Settings** (available in all workspaces) or **Workspace Settings** (this project only).
5. Click **Save**. You will be prompted for your password on the first connect — it is stored securely in the OS credential manager, never in settings files.

## Configuration Fields

| Section | Fields |
|---|---|
| **Basic** | ADT URL, username, SAP client, language |
| **SSL** | Allow self-signed certificates, custom CA certificate |
| **SAP GUI** | Server, system number, router string, message server, GUI type (Desktop / Embedded WebGUI / Browser) |
| **OAuth** | Client ID, secret, login URL |
| **Advanced** | ATC approver, ATC check variant, max debug threads, diff formatter |

## Import / Export

- **Export** — saves all connections to a JSON file (passwords excluded) for backup or sharing with colleagues.
- **Import** — merges connections from a previously exported JSON file.
- **BTP Service Key** — create a connection from a BTP Service Key JSON file.
- **BTP Endpoint** — create a connection via an interactive Cloud Foundry login flow.

## Bulk Operations

Select multiple connections using the checkboxes to:

- **Bulk delete** — remove several connections at once.
- **Bulk username edit** — update the username across multiple connections simultaneously.

A confirmation dialog appears before any bulk action is applied.

## Password Management

Passwords are stored securely in the OS credential manager (never in settings files).

| Command | What it does |
|---|---|
| **ABAP FS: Change Connection Password** | Select a system and enter a new password |
| **ABAP FS: Forget connection password** | Removes the stored password; you'll be prompted on next connect |

## User vs. Workspace Settings

Connections saved to **User Settings** are global — they appear in every VS Code workspace on your machine. Connections saved to **Workspace Settings** are stored in the `.vscode/settings.json` of the current project folder, making them easy to commit or share per project.

# MCP Server for External AI Tools

> **Prerequisites:** Complete the [Installation Steps](#installation-steps) first. You need VS Code with ABAP FS installed and configured with at least one SAP system connection.

> **Note:** ABAP FS has 40+ AI tools. When using GitHub Copilot in VS Code, all tools are available natively once a SAP system is connected — no MCP server needed. The MCP server is only for external AI clients.

## What Is This and Why Would You Need It?

**MCP (Model Context Protocol)** is an open standard that lets AI tools call external services. ABAP FS exposes its 39 SAP tools (search, read code, run tests, query data, etc.) via a local MCP server so that AI assistants outside of VS Code can use them.

> **Note:** MCP now supports both reading and writing ABAP code. See [Write Support](#write-support) for details.

**Use this if** you work with AI tools like Cursor, Claude Desktop, Claude Code, or Windsurf and want them to have the same SAP access that GitHub Copilot has inside VS Code.
Also applies to AI agents plugins for vscode like Cline/Continue/Roo code/... unless they support the [virtual filesystem API](https://code.visualstudio.com/api/extension-guides/virtual-workspaces) AFAIK only copilot does at the moment

**Don't need this if** you only use GitHub Copilot in VS Code — tools are already available there natively.

```text
┌─────────────────┐     MCP Protocol      ┌──────────────────┐     VS Code API     ┌─────────────┐
│  Cursor/Claude  │ ◄───────────────────► │  MCP Server      │ ◄─────────────────► │  ABAP FS    │
│  Desktop/etc.   │    localhost:4847     │  (in VS Code)    │                     │  Tools      │
└─────────────────┘                       └──────────────────┘                     └─────────────┘
```

**VS Code must remain open.** The MCP server runs inside VS Code — closing VS Code stops the server.

## Setup

### 1. Start the MCP Server

Press `Ctrl+Shift+P` and run: **ABAP FS: Start MCP Server**

That's it — the server starts immediately on the default port (4847). A notification confirms it's running.

> If you have GitHub Copilot installed, ABAP FS will ask whether you actually need the MCP server (Copilot already has native access to all tools). You can choose to start anyway or cancel.

### 2. (Optional) Change Port or Add API Key

Running the command automatically enables `autoStart` — VS Code will start the MCP server on every launch going forward. You don't need to touch settings for that.

If you need to change the port or secure the server with an API key:

Open VS Code Settings (`Ctrl+,`) and search for `abapfs.mcpServer`:

| Setting                      | Description                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `abapfs.mcpServer.port`      | Default `4847` — change if there's a port conflict                          |
| `abapfs.mcpServer.apiKey`    | Optional. Recommended on shared machines to prevent unauthorized SAP access |

Or add directly to your `settings.json`:

```json
{
  "abapfs.mcpServer.port": 4847,
  "abapfs.mcpServer.apiKey": "your-secret-key"
}
```

### 2. Connect to Your SAP System

Use the command `ABAP FS: Connect to an SAP system` (`Ctrl+Shift+P` to open the Command Palette). The MCP server needs an active SAP connection to serve tool requests.

### 3. Configure Your AI Tool

Add the following to your AI tool's MCP configuration. The URL is the same for all clients:

**Cursor** — `~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp"
    }
  }
}
```

**Claude Desktop** — see Claude's documentation for the config file location, then add the same block.

**Other MCP clients** — use the Streamable HTTP endpoint: `http://localhost:4847/mcp`

#### With API Key Authentication

If you set `abapfs.mcpServer.apiKey`, clients must send it as a Bearer token:

```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-key"
      }
    }
  }
}
```

Without a matching key, requests return `401 Unauthorized`. The `/health` endpoint is always accessible without authentication.

### 4. Verify

In your AI tool, ask something SAP-related, for example:

- _"Search for classes containing 'USER'"_
- _"Show me the code for CL_ABAP_TYPEDESCR"_
- _"Run unit tests for ZCL_MY_CLASS"_

## Available Tools

All 40 ABAP FS tools are exposed, including:

| Tool                        | What It Does                       |
| --------------------------- | ---------------------------------- |
| `search_abap_objects`       | Search for objects by name pattern |
| `get_abap_object_lines`     | Read source code                   |
| `find_where_used`           | Where-used analysis                |
| `run_unit_tests`            | Execute ABAP unit tests            |
| `run_atc_analysis`          | Run ATC code checks                |
| `execute_data_query`        | Run SQL queries against SAP tables |
| `manage_transport_requests` | Read transport data                |
| `abap_activate`             | Activate ABAP objects              |
| `replace_string_in_abap_object` | Edit ABAP source code (find & replace) |
| `get_abap_diagnostics`      | Get syntax errors/warnings for a file  |

## Write Support

MCP clients can now edit ABAP source code directly. The workflow:

1. **Get the file URI** — call `get_abap_object_workspace_uri` with object name/type/connection
2. **Read current code** — call `get_abap_object_lines` or `search_abap_object_lines`
3. **Edit** — call `replace_string_in_abap_object` with the URI, old text, and new text
4. **Verify** — call `get_abap_diagnostics` with the same URI to check for syntax errors

Edits are immediately synced to SAP (ABAP FS handles locking, saving, and unlocking automatically). There is no keep/undo UI — changes are applied directly.


## Limitations

- **VS Code must stay open** — the server runs inside VS Code
- **Active SAP connection required** — tools need a connected system
- **Webview outputs appear in VS Code** — results from tools like data queries or Mermaid diagrams open as VS Code panels, not in the external tool
- **No navigation features** — Go to Definition, Find References, and hover documentation require the VS Code ABAP FS integration
- **Debugging requires VS Code** — the ABAP debugger is VS Code-specific

## Troubleshooting

### Server not starting

- Run `ABAP FS: Start MCP Server` from the Command Palette to start it manually
- If you previously chose "Disable MCP", re-run the command — it will start and re-enable auto-start
- Open the VS Code Output panel (`Ctrl+Shift+U`) and select "ABAP FS" for error messages
- Try a different port if 4847 is already in use (`abapfs.mcpServer.port` in settings)

### Tools not working

- Confirm VS Code is connected to an SAP system
- Check that the startup notification appeared when VS Code launched
- Verify the URL in your AI tool's config matches the configured port

### 401 Unauthorized

- Check that `Authorization: Bearer <key>` is configured in your MCP client
- Confirm the key in the client exactly matches `abapfs.mcpServer.apiKey` in VS Code settings

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

# AI Subagents for Optimized ABAP Development

AI Subagents are specialized AI assistants, each focused on one type of ABAP task (finding objects, reading code, running analysis, etc.). Instead of one general AI doing everything, subagents split work across focused specialists.

**Why this matters:**

- **Better results** — a dedicated code reviewer catches more issues than a general assistant juggling multiple goals
- **Longer conversations** — heavy operations run in separate context windows, so your main chat stays responsive
- **Lower cost** — simple tasks (search, read) use cheaper/faster models; complex tasks use smarter ones

## Available Subagents

| Agent | What it does | Tier |
|-------|-------------|------|
| `abap-orchestrator` | Routes tasks, writes all code, coordinates other agents | 3 (Premium) |
| `abap-code-reviewer` | Deep code review — security, performance, best practices | 3 (Premium) |
| `abap-usage-analyzer` | Where-used analysis, dependencies, change impact | 2 (Mid-tier) |
| `abap-quality-checker` | ATC analysis, unit tests, code health | 2 (Mid-tier) |
| `abap-historian` | Version history, transport requests | 2 (Mid-tier) |
| `abap-debugger` | Runtime debugging — breakpoints, stepping | 2 (Mid-tier) |
| `abap-troubleshooter` | Analyze dumps, traces, performance issues | 2 (Mid-tier) |
| `abap-data-analyst` | Query SAP tables, analyze data patterns | 2 (Mid-tier) |
| `abap-discoverer` | Find ABAP objects by name/pattern | 1 (Cheap/Fast) |
| `abap-reader` | Read and extract info from source code | 1 (Cheap/Fast) |
| `abap-creator` | Create new ABAP objects (shells) | 1 (Cheap/Fast) |
| `abap-visualizer` | Create diagrams from code | 1 (Cheap/Fast) |
| `abap-documenter` | Generate technical documentation | 1 (Cheap/Fast) |

## How to Use Subagents

In GitHub Copilot Chat, type `@abap-orchestrator` to start. The orchestrator is the only agent exposed directly in the chat dropdown — it calls other agents automatically as needed.

```
@abap-orchestrator analyze ZCL_ARTICLE_HANDLER and suggest improvements
```

For example, the orchestrator might:

1. Delegate "find related classes" → `abap-discoverer` (cheap, fast)
2. Delegate "read the code" → `abap-reader` (cheap, fast)
3. Delegate "usage analysis" → `abap-usage-analyzer` (mid-tier)
4. Synthesize findings and write recommendations itself (premium)

You can also invoke other subagents directly with `@agent-name` if needed. Ask Copilot to make an agent available in the dropdown — it can update the agent's `.agent.md` file to enable this.

## Setup

> Subagent configuration is stored at the **workspace level** in `.vscode/settings.json` and `.github/agents/`. Each project can have its own configuration.

In normal usage, you do not need to edit these files manually. Copilot can configure models, generate/update agent files, validate them, and enable/disable subagents through chat commands.

### Step 1 — Configure models

Ask Copilot:

```
Configure subagents for ABAP development
```

Copilot will suggest models for each tier and ask for confirmation before applying. Recommended assignments:

| Tier | Agents | Example models |
|------|--------|---------------|
| 1 — Cheap/Fast | discoverer, reader, creator, visualizer, documenter | Claude Haiku 4.5, Gemini 3 Flash |
| 2 — Mid-tier | usage-analyzer, quality-checker, historian, debugger, troubleshooter, data-analyst | GPT-4o, Claude Sonnet 4 |
| 3 — Premium | orchestrator, code-reviewer | Claude Sonnet/Opus 4.6, GPT-5.4 |

**Avoid assigning premium models to Tier 1 agents** — it eliminates the cost benefit without improving results for simple tasks.

### Step 2 — Enable subagents

Ask Copilot:

```
Enable subagents
```

This creates agent files in `.github/agents/` and validates them.

### Step 3 — Allow agent delegation (if prompted)

You may see a notification asking to enable `chat.customAgentInSubagent.enabled`. Click **Enable Setting** — this allows the orchestrator to call other agents.

## Managing Subagents

All management is done through Copilot chat:

| What you want | What to ask |
|---------------|-------------|
| Check current status | `Show subagent status` |
| Disable all agents | `Disable subagents` |
| Re-enable agents | `Enable subagents` |
| Change a model | `Change abap-discoverer to use GPT-4o` |
| See available models | `What models can I use for subagents?` |
| See available tools | `List available tools for subagents` |

When you disable subagents, agent files move to `agents_disabled/` (not deleted). Re-enabling restores them with your customizations intact.

## Customizing Agent Tools

Each agent's `.agent.md` file in `.github/agents/` defines which tools it can use. You can edit these files directly or ask Copilot to do it:

```
Add the abap-trace tool to abap-troubleshooter
```

Changes survive disable/re-enable cycles — only the `model:` line is updated when you change models.

✅ **User Control**: You decide which models to use for each agent tier

## What to Be Aware Of

⚠️ **Model Availability**: Some models shown in the list may not work (e.g., "GPT-4o mini"). The system validates and auto-disables if errors are detected.

⚠️ **VS Code Setting Required**: `chat.customAgentInSubagent.enabled` must be true for delegation to work, otherwise main agent's model may be used for all subagents which can result in a lot of premium request usage.

⚠️ **Workspace-Specific**: Settings and agent files are per-workspace, not global

⚠️ **Agent Files in Git**: The `.github/agents/` folder will appear in your version control - add to `.gitignore` if you don't want to share

⚠️ **Frequently-Used Agents**: Agents like `abap-discoverer` and `abap-reader` get called often - using expensive models for these defeats the cost benefit

## Troubleshooting

### "Cannot enable subagents - missing models"
All 13 agents must have models configured. Ask Copilot to configure missing agents.

### Agent files show validation errors
Some model names aren't valid for agent files. Try a different model (e.g., use `Claude Haiku 4.5` instead of `GPT-4o mini`).

### Subagents auto-disabled
This happens when configured models become unavailable. Reconfigure with available models.

### Ghost files in explorer after disable
This is a VS Code refresh issue. The extension refreshes the explorer automatically, but occasionally you may need to collapse/expand the folder.

### Delegation not using custom agents
Make sure `chat.customAgentInSubagent.enabled` is set to `true` in your VS Code settings.

# AI Skills

Skills are built-in "cheat sheets" that Copilot reads automatically when your question or task matches their domain. They contain ABAP-specific knowledge — coding standards, performance rules, SAP navigation techniques — so you don't have to explain that context yourself.

Copilot only loads a skill's full content when relevant, so having many skills does not slow down unrelated conversations.

## Using Skills

**Automatic:** Skills load on their own when Copilot detects a match. Nothing to do.

**Manual:** Type `/` in the Copilot Chat input to see all skills as slash commands. Select one to invoke it explicitly, for example:

- `/clean-abap review this method`
- `/abap-research find the transaction for this screen`

## Available Skills

| Skill | Slash command | When it loads |
|---|---|---|
| [Clean ABAP](#clean-abap) | `/clean-abap` | Writing or reviewing ABAP code |
| [Code Writing Process](#code-writing-process) | `/abap-code-writing` | Building any ABAP solution |
| [Performance (ECC)](#performance-ecc) | `/abap-performance-ecc` | Non-HANA systems (Oracle, DB2, MSSQL) |
| [Performance (HANA)](#performance-hana) | `/abap-performance-hana` | S/4HANA / HANA DB systems |
| [SAP Research](#sap-research) | `/abap-research` | Searching for objects, transactions, messages |
| [System Personality Report](#system-personality-report) | `/sap-system-personality-report` | Analyzing a system's custom code landscape |
| [SAP Customizing](#sap-customizing) | `/sap-customizing` | SPRO/IMG settings and configuration tables |
| [SAP Data Workbook](#sap-data-workbook) | `/sap-data-workbook` | Multi-step SAP data analysis |

---

### Clean ABAP

SAP's official [Clean ABAP Style Guide](https://github.com/SAP/styleguides) condensed into AI-optimized rules. Covers naming conventions, modern syntax, class/method design, error handling, formatting, and unit testing patterns.

### Code Writing Process

A structured process for building ABAP solutions: validate requirements → explore the system → plan architecture → research existing objects → design → write code. Prevents the AI from guessing at parameters or reimplementing standard SAP functionality that already exists.

### Performance (ECC)

Performance patterns for traditional databases (Oracle, DB2, MSSQL, MaxDB). Covers simple SQL, buffering, index usage, and internal table optimization. Copilot checks the system type automatically and loads this skill only on non-HANA systems.

### Performance (HANA)

Performance patterns for S/4HANA. Covers code pushdown, CDS views, AMDP, and complex SQL aggregations. Copilot checks the system type automatically and loads this skill only on HANA-based systems.

### SAP Research

Teaches Copilot to find anything in an unfamiliar SAP system — the way a senior developer would. Covers which metadata tables to query for what (TSTCT for transactions, T100 for messages, TADIR for all objects, DD03L for table fields), wildcard strategies, package clustering, and tracing error messages back to code.

### System Personality Report

Generates a structured overview of any connected SAP system: number of custom objects, most-developed business areas, recent dump activity, and more. Useful for quickly understanding an unfamiliar system.

### SAP Customizing

Teaches Copilot to navigate SPRO/IMG configuration. Uses systematic lookup procedures to trace from an SPRO activity to its storage tables (via `CUS_IMGACH`, `CUS_ACTH`, `CUS_ACTOBJ`), reverse-look up tables to their SPRO path, and resolve domain fixed values (`DD07T`).

### SAP Data Workbook

Teaches Copilot to create `.sapwb` files — VS Code notebooks combining ABAP SQL and JavaScript cells for multi-step SAP data analysis. See [SAP Data Workbooks](#sap-data-workbooks-sapwb) for details on the workbook feature itself.

# Heartbeat - Background Monitoring & Reminders

> ⚠️ **BETA FEATURE** - Please report any issues.

Heartbeat is a background service that runs an AI agent at a set interval to monitor your SAP systems and send you reminders. You configure what to watch; the agent checks it quietly in the background and only notifies you when something happens.

**Common uses:**

- "Alert me when new ST22 dumps appear in DEV"
- "Watch transport DEVK900001 until it's released"
- "Remind me tomorrow at 10am to review the batch job"

---

## Setup

Heartbeat settings are stored at the **workspace level** (`.vscode/settings.json`), not globally. Each project can have its own configuration.

### Step 1: Configure with Copilot (recommended)

You do not need to edit settings manually in most cases. Ask Copilot:

```
Set up heartbeat with model GPT-4o mini, every 5 minutes, and start it
```

Copilot uses the heartbeat tools to configure and start the service for you.

### Step 2: Manual settings (optional)

Open VS Code Settings (`Ctrl+,`) and add:

```json
{
  "abapfs.heartbeat.model": "GPT-4o mini",
  "abapfs.heartbeat.every": "5m",
  "abapfs.heartbeat.enabled": true
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `abapfs.heartbeat.enabled` | Enable/disable the service | `false` |
| `abapfs.heartbeat.model` | AI model for background checks — use a cheap model | Required |
| `abapfs.heartbeat.every` | Check interval (`"5m"`, `"1h"`, `"30s"`) | `"5m"` |
| `abapfs.heartbeat.activeHours` | Only run during these hours | `"08:00-18:00"` |
| `abapfs.heartbeat.maxConsecutiveErrors` | Auto-pause after N errors | `20` |

**Recommended models (cost-effective):**

- `GPT-4o mini` ⭐ most reliable for background tasks
- `Claude Haiku 4`
- `GPT-4o`

### Step 3: Start the service

Ask Copilot: `"Start the heartbeat service"`

Or set `abapfs.heartbeat.enabled` to `true` in settings — the service starts automatically.

### Step 3: Add tasks

Ask Copilot in plain language:

```
"Remind me tomorrow at 10am to review transport K900123"
"Monitor DEV100 for new ST22 dumps and alert me"
"Watch transport DEVK900001 until it's released"
```

Copilot creates the task definitions and saves them to `heartbeat.json` in your workspace root.

---

## Status Bar

When heartbeat is running, a heart ❤️ appears in the VS Code status bar.

| Status | Meaning |
|--------|---------|
| ❤️ (pulsing) | Active, waiting for next check |
| ❤️ beat... | Running a check now |
| ❤️ zzz | Paused (errors or outside active hours) |
| (hidden) | Stopped |

**Click the heart** to open `heartbeat.json` directly.

---

## Task Types

### Reminders (one-time)

Notifies you once at the scheduled time, then removes itself.

```
"Remind me in 2 hours to check the batch job"
"Remind me tomorrow at 9am about the deployment"
```

Uses `reminderOnly: true` and a `startAt` timestamp. The heartbeat agent ignores the task until `startAt` passes.

### Monitoring Tasks (recurring)

Checks a condition every interval and alerts only when something **new** is found.

```
"Monitor for new ST22 dumps in QA100"
"Alert me when transport K900123 is released"
```

The agent stores what it already reported in `lastNotifiedFindings` and only triggers a new alert for changes.

---

## Task Properties Reference

| Property | Description |
|----------|-------------|
| `id` | Unique identifier |
| `description` | What this task monitors or reminds |
| `connectionId` | SAP system ID (e.g. `"dev100"`) |
| `enabled` | Whether the task is active |
| `category` | `transport`, `dump`, `job`, `reminder`, `custom` |
| `priority` | `high`, `medium`, `low` |
| `sampleQuery` | SQL query for the agent to run |
| `checkInstructions` | Step-by-step instructions for the agent |
| `startAt` | ISO timestamp — don't check before this time |
| `reminderOnly` | Notify once and auto-remove |
| `removeWhenDone` | Auto-remove when the condition is met |
| `cooldownMinutes` | Don't re-notify within this period |
| `alertThreshold` | Only alert if count exceeds this value |

---

## Example Task Definitions

These are the JSON entries stored in `heartbeat.json`. You can let Copilot generate them, or write them manually.

### Monitor ST22 dumps

```json
{
  "id": "task-st22-dumps",
  "description": "Monitor for new ST22 runtime dumps",
  "connectionId": "your-system-id",
  "category": "dump",
  "priority": "high",
  "checkInstructions": [
    "Use analyze_abap_dumps tool with action 'list_dumps'",
    "Compare dump IDs against lastNotifiedFindings",
    "Only alert for genuinely new dumps",
    "Update lastNotifiedFindings with current dump IDs"
  ],
  "cooldownMinutes": 30
}
```

### Watch a transport until released

```json
{
  "id": "task-watch-transport",
  "description": "Watch transport DEVK900001 for release",
  "connectionId": "your-system-id",
  "category": "transport",
  "sampleQuery": "SELECT trkorr, trstatus FROM e070 WHERE trkorr = 'DEVK900001'",
  "checkInstructions": [
    "Execute the SQL query",
    "If trstatus = 'R', notify user and remove task",
    "If still 'D', update lastResult silently"
  ],
  "removeWhenDone": true
}
```

### Scheduled reminder

```json
{
  "id": "task-reminder-123",
  "description": "Review transport release process",
  "category": "reminder",
  "startAt": "2026-02-05T10:00:00.000Z",
  "reminderOnly": true
}
```

---

## Managing Heartbeat via Copilot

| What you want | Ask Copilot |
|---------------|-------------|
| Check status | `"What's the heartbeat status?"` |
| List tasks | `"Show me the heartbeat watchlist"` |
| Add a task | `"Monitor DEV for stuck jobs"` |
| Remove a task | `"Remove the transport monitoring task"` |
| Run check now | `"Trigger a heartbeat check now"` |
| Stop service | `"Stop the heartbeat service"` |

---

## Timezone Handling

When you say something like "remind me tomorrow at 10am", Copilot:

1. Queries the SAP system's timezone using `get_sap_system_info`
2. Converts your local time to the correct UTC timestamp
3. Stores the result in `startAt` (e.g. `"2026-02-05T08:00:00.000Z"` for UTC+2)

This ensures reminders fire at the right time relative to your SAP system.

---

## Deduplication

The agent tracks what it has already alerted on to avoid repeated notifications:

- `cooldownMinutes` — minimum gap between re-alerts for the same task
- `lastNotifiedFindings` — IDs or summaries of what was already reported

**Example flow for dump monitoring:**

- Check 1: 5 dumps → Alert: "5 new dumps found"
- Check 2: Same 5 dumps → No alert (already reported)
- Check 3: 7 dumps → Alert: "2 new dumps found"

---

## Troubleshooting

**Service won't start**

- Confirm `abapfs.heartbeat.model` is set in workspace settings
- Confirm `abapfs.heartbeat.enabled` is `true`
- Check VS Code Output panel → "ABAP FS" for errors

**Tasks not being checked**

- Confirm `heartbeat.json` exists in the workspace root (created automatically when you add your first task)
- Confirm the task has `"enabled": true`
- Check whether `startAt` is in the future
- Check whether current time is within `activeHours`

**Too many alerts**

- Increase `cooldownMinutes` on the task
- Set `alertThreshold` to filter low-count issues
- Add more specific conditions in `checkInstructions`

**Model errors**

- Try `GPT-4o mini` — most reliable for background tasks
- Some models handle tool calls inconsistently in background mode

# Enhanced Hover Information

When you move your mouse cursor over ABAP code in the editor and pause, a popup appears with information about the symbol under the cursor. This is called a **hover**.

## How to trigger a hover

Move your mouse over any ABAP keyword, variable, system field, or object name and wait about 700ms (just under a second). The popup appears automatically — no click needed.

## What the hover shows

Depending on what you hover over, you may see:

| Symbol type | Information shown |
|---|---|
| System fields (`sy-subrc`, `sy-tabix`, etc.) | Plain-language explanation of the field's purpose |
| Built-in types | Type description and length |
| Variables and data objects | Type, length, and declaration context |
| Function modules | Parameter list (importing, exporting, exceptions) |
| Classes and methods | Signature and visibility |
| Other objects | Metadata from the SAP system |

## Configuration

The hover delay is configurable. If the popup appears too quickly or too slowly, search for `abapfs hover` in VS Code settings (`File → Preferences → Settings`) to adjust the delay.

# Enhanced Views & Panels

ABAP FS adds several views and panels to the VS Code interface. Here's a quick orientation to VS Code's layout:

- **Activity Bar** — the vertical strip of icons on the far left. Click an icon to open the corresponding view in the sidebar.
- **Explorer** — the file/folder tree, opened via the top Activity Bar icon. ABAP FS adds extra sections here.
- **Panel** — the area at the bottom of the editor (same area as the Terminal). ABAP FS adds a documentation panel here.

---

## Activity Bar Views

These appear as icons in the Activity Bar. Click them to open the view in the sidebar.

| View | Purpose |
|------|---------|
| **Object Search** | Search ABAP objects by name, type, or package with filters |
| **Transports** | Browse and manage transport requests |
| **Dumps** | View and analyze runtime errors (ST22) |
| **ATC Finds** | Review results from ABAP Test Cockpit code quality checks |
| **Traces** | Analyze performance traces |
| **S/4HANA Readiness** | Dashboard showing S/4HANA compatibility findings for your code |
| **abapGit** | Manage abapGit repositories linked to the system |
| **Feed Inbox** | Subscribe to and view ADT feed notifications |
| **RAP Generator** | Generate RAP (RESTful ABAP Programming) services from a database table, similar to Eclipse |
| **Object Property** | Shows properties, assigned transport, and revision history for the currently open ABAP object |

## Explorer Views

These appear as collapsible sections inside the Explorer sidebar (the file tree).

| View | Purpose |
|------|---------|
| **Favorites** | Pin frequently accessed objects for quick access |

## Panel Views

These appear in the bottom panel area, alongside the Terminal.

| View | Purpose |
|------|---------|
| **ATC Documentation** | Displays the detailed SAP documentation for the ATC finding selected in the ATC Finds view |

# Object Property View

The Object Property View shows metadata and history for whichever ABAP object is currently open in the editor — similar to the Properties view in ABAP Development Tools (Eclipse).

## Opening the View

Click the ABAP FS icon in the **Activity Bar** (left sidebar), then select the **Object Property** panel. The view updates automatically as you switch between ABAP files.

## What It Shows

| Section | Details |
|---|---|
| **Object metadata** | Type, package, responsible user, creation date, object URI |
| **Lock status** | Whether the object is locked and by whom |
| **Transport history** | All transport requests that contain this object |
| **Revision history** | Each saved version — author, date, and transport number |

## Comparing Revisions

1. In the **Revision history** section, tick the checkboxes next to any two versions.
2. A side-by-side diff opens in the editor, showing exactly what changed between them.

## Performance Note

Property data is cached after the first load. If you switch back to an object you already viewed, the extension reuses the cached data instead of querying SAP again.

# Custom Editors

ABAP FS provides custom visual editors for certain SAP object types. Instead of editing raw XML, you get a purpose-built UI tailored to that object.

Custom editors open automatically when you navigate to a supported object type. You can also open them manually via **Open With** (right-click the file in the Explorer).

## Supported Editors

### Message Class Editor (`*.msagn.xml`)

A table-based editor for SAP message classes (MSAG). Lets you add, edit, and delete messages without touching XML.

See [Message Class Editor](#message-class-editor) for full details.

### HTTP Service Editor (`*.http.xml`)

A form-based editor for configuring SAP HTTP services (SICF nodes).

## Common Actions

| Action | How |
|--------|-----|
| Save changes | `Ctrl+S` |
| Switch to raw XML | Right-click file → **Open With** → **Text Editor** |
| Revert unsaved changes | `File` → **Revert File** |

# Message Class Editor

Message classes (transaction SE91) open in a custom table editor instead of raw XML, making it easy to view and maintain messages directly in VS Code.

## Opening a Message Class

Search for your message class (e.g. `ZMY_MESSAGES`) using the ABAP FS file explorer — it opens automatically in the table editor. You can also open any `.msagn.xml` file directly.

## Working with Messages

| Action | How |
|--------|-----|
| **Add** | Click the ➕ button — the next available number is suggested automatically |
| **Edit** | Double-click the message text, or click ✏️ |
| **Delete** | Click 🗑️ next to the message |
| **Save** | **Ctrl+S** — all pending adds, edits, and deletes are sent to SAP together |

Validation runs as you type: message text is limited to **72 characters** and the number field is required.

## Notes

- Message numbers are zero-padded (`001`, `002`, …).
- Deleted messages are flagged and removed on save; skipped numbers are not reused when suggesting the next number.
- **Long text editing is not supported** — use SE91 for long texts.
- Only applies to message class objects (`MSAG/N` type).

# Embedded SAP GUI (WebView)

Run SAP GUI transactions directly inside VS Code — no need to switch between windows. The SAP WebGUI renders inside a **WebView**: an embedded browser tab hosted within VS Code itself.

## Opening the Embedded SAP GUI

Three ways to open it:

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Ctrl+Shift+F7** (with an ABAP file open) |
| Editor toolbar | Click the **Embedded GUI** button in the editor toolbar |
| Command Palette | `ABAP FS: Open SAP GUI in embedded WebView` |

## Requirements

- WebGUI enabled on your SAP system
- The connection configured in your ABAP FS settings

## How It Works

By default, the extension opens SAP GUI in VS Code's **Integrated Browser** (Simple Browser) rather than a raw iframe WebView. The Integrated Browser does not wrap the page in an iframe, which avoids a common blank-page issue described below.

## Blank Page / Clickjacking Issues

If you see a **blank white page**, your SAP system has clickjacking frame protection enabled (`ClickjackingFramingProtection.js`). This is a SAP server-side security feature that blocks SAP WebGUI from loading inside an iframe — the extension cannot override it.

You may also see these browser console errors:

- `ClickjackingFramingProtection.js: Ignored call to 'alert()'. The document is sandboxed`
- `Potential permissions policy violation: fullscreen is not allowed in this document`

**Solution:** The setting `abapfs.sapGui.useIntegratedBrowser` is **enabled by default** and resolves this. If you previously disabled it, re-enable it:

```json
{
  "abapfs.sapGui.useIntegratedBrowser": true
}
```

To fall back to the raw embedded WebView (for example, if the Integrated Browser causes problems in your environment):

```json
{
  "abapfs.sapGui.useIntegratedBrowser": false
}
```

This setting applies to all entry points: the toolbar button, command palette, and Run Transaction command.

> **VS Code tip:** The VS Code setting `simpleBrowser.useIntegratedBrowser` (marked experimental) controls whether Simple Browser uses VS Code's built-in browser engine. Enabling it may improve compatibility on desktop. This is a VS Code setting, not an ABAP FS setting.

# Native Desktop SAP GUI

Open the currently active ABAP object directly in your locally installed SAP GUI application, giving you access to the full transaction UI without leaving your VS Code workflow.

## Requirements

- SAP GUI for Windows installed on your machine
- A configured ABAP FS connection to your SAP system

## How to Open

With an ABAP file open in the editor, use any of these methods:

| Method | Action |
|---|---|
| Keyboard shortcut | `Ctrl+Shift+F5` |
| Editor toolbar | Click the **Open in SAP GUI** icon |
| Command Palette | `Ctrl+Shift+P` → `ABAP FS: Open in native SAP GUI desktop application` |

## When to Use

Prefer native SAP GUI when you need:

- Transactions that are not available in the browser-based GUI
- Better performance for complex or data-heavy screens
- Full SAP GUI functionality (e.g., ALV grids, custom controls, scripting)

# Web Browser SAP GUI

Opens the currently active ABAP object in SAP GUI running inside your default web browser (SAP WebGUI). Useful when you need to interact with an object in its native SAP GUI interface without leaving your development workflow.

## Prerequisites

- SAP WebGUI must be enabled on the target SAP system (ask your Basis team if unsure).

## How to Open

With an ABAP file open in the editor, use any of the following:

| Method | Action |
|---|---|
| Keyboard shortcut | `Ctrl+Shift+F6` |
| Editor toolbar | Click the **Open in Browser GUI** icon |
| Command Palette | `Ctrl+Shift+P` → `ABAP FS: Open SAP GUI in external web browser` |

The object opens in your default browser. The URL can be copied and shared with other users who have access to the same system.

# Run SAP Transaction

Execute SAP transaction codes directly from VS Code without switching to the SAP GUI window.

## How to Use

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP Copilot: Run SAP Transaction**
3. If multiple systems are connected, select the target system
4. Type a transaction code (e.g., `MM43`, `SE38`)
5. Press `Enter` — the transaction opens in your configured GUI

## GUI Configuration

Set your preferred GUI type per connection in settings (`sapGui.guiType`).

## Limitations

- **Native SAP GUI** — Windows only
- **Embedded WebView** — no SSO; requires manual login
- Some transactions may not work correctly in embedded mode

# Object Search

Search for ABAP objects by name — like the SE80 object search, but directly inside VS Code without opening SAP GUI.

## How to Search

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: Search for object**
3. Enter a name pattern using wildcards (e.g. `ZCL_*`, `*USER*`)
4. Select one or more object types to filter results
5. Press `Enter` — results open in a quick-pick list for instant navigation

> **Tip:** Save your preferred object types as defaults so you don't have to re-select them every time.

## Wildcard Patterns

| Pattern | Matches |
|---------|---------|
| `ZCL_*` | All custom classes starting with ZCL_ |
| `*USER*` | Anything containing USER |
| `BAPI_MATERIAL_*` | All BAPIs starting with BAPI_MATERIAL_ |

## Supported Object Types

| Type | Description |
|------|-------------|
| `CLAS` | Classes |
| `INTF` | Interfaces |
| `PROG` | Programs / Reports |
| `FUNC` | Function Modules |
| `FUGR` | Function Groups |
| `TABL` | Database Tables |
| `VIEW` | Views |
| `DTEL` | Data Elements |
| `DOMA` | Domains |
| `TTYP` | Table Types |
| `DDLS` | CDS Views |
| `ENQU` | Lock Objects |
| `MSAG` | Message Classes |
| `DEVC` | Packages |
| `TRAN` | Transactions |
| `ENHC` / `ENHS` | Enhancement Implementations / Spots |
| `BADI` | BAdI Definitions |
| + 30 more | — |

> **Note:** Object types not natively supported by the extension open automatically in SAP GUI.

# Create Objects

Create new ABAP development objects directly from VS Code without opening SAP GUI.

## How to Create an Object

**Option 1 — Command Palette:**

1. Press `Ctrl+Shift+P` to open the Command Palette.
2. Type and select **ABAP FS: Create object**.
3. Follow the wizard prompts (object type, name, description, package).

**Option 2 — Explorer context menu:**

1. Right-click a package or folder in the ABAP Explorer.
2. Select **Create object**.
3. Follow the wizard prompts.

**Option 3 — Via Copilot:**

Ask Copilot in natural language, for example:

> *"Create a new class ZCL_MY_CLASS with description 'My class'"*

Copilot fills in the object details automatically. You will still be prompted to select a transport request.

## Supported Object Types

| Object type | Type code |
|---|---|
| Report / Program | `PROG/P` |
| Class | `CLAS/OC` |
| Interface | `INTF/OI` |
| Function Group | `FUGR/F` |
| Data Element | `DTEL/DE` |
| Domain | `DOMA` |
| Database Table | `TABL/DT` |
| CDS View | `DDLS` |
| Message Class | `MSAG/N` |
| Package | `DEVC/K` |

Many additional types are supported. If the object type you need is not listed, try the wizard — it shows all types available in your connected system.

## Notes

- A **transport request** dialog always appears for objects that require transport. This step cannot be skipped.
- The new object opens in the editor automatically after creation.
- Objects must be **activated** before they can be used at runtime.

# Open Objects

Open any ABAP object from your connected SAP system directly in the VS Code editor for viewing and editing.

## How to Open an Object

**Option 1 — Search command (recommended)**

1. Press `Ctrl+Shift+P` to open the Command Palette.
2. Run **ABAP FS: Search for object**.
3. Type part of the object name and select it from the list.

**Option 2 — File Explorer**

- Expand your SAP system in the Explorer panel (`Ctrl+Shift+E`) and double-click any object.

**Option 3 — Ask Copilot**

- In the Copilot chat, type: *"Open ZCL_MY_CLASS"* — the object opens automatically.

## What You Get

Once open, the object behaves like any other file in VS Code:

- Syntax highlighting for ABAP
- Full editing with save and activation support
- Navigation via breadcrumbs and Go to Definition (`F12`)
- Visible in the Explorer and in **Open Editors**

# Object Activation

Activation compiles your ABAP code and makes it executable — the equivalent of pressing the **Activate** button (or `Ctrl+F3`) in SE80/SE24.

> Unlike SE80, the extension auto-saves the file before activating, so you don't need a separate save step.

## How to Activate

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Alt+Shift+F3** |
| Editor toolbar | Click the activation button (lightning icon) |
| On save | Automatic, if **Auto-activate on save** is enabled in settings |

## Mass Activation

When you edit an object that has related inactive objects (e.g. a program with includes, or a class with methods), the extension detects them automatically and shows a selection dialog:

1. A list of all inactive related objects appears, all pre-selected.
2. Deselect any objects you do **not** want to activate.
3. Confirm — all selected objects are activated together.

This mirrors the mass activation dialog in SE80 that appears when dependent objects are out of sync.

# Favorites Management

Favorites let you bookmark frequently used ABAP objects for quick access across sessions.

## Adding a Favorite

1. In the Explorer sidebar, locate the ABAP object.
2. Right-click it and select **Add to Favorites**.

## Viewing and Opening Favorites

- Open the **Favorites** view in the Explorer sidebar.
- Click any entry to open the object in the editor.

## Removing a Favorite

- Right-click the entry in the **Favorites** view and select **Remove from Favorites**.

## Notes

- Favorites persist across VS Code sessions.
- The **Favorites** view is in the Explorer sidebar (same panel as the file tree).

# Show Table Contents

View the contents of any database table directly in VS Code — similar to **SE16 / SE16N** in SAP GUI.

## Opening Table Contents

1. Open a database table (e.g. from the object explorer or via `Ctrl+Shift+A` to search by name)
2. Click the **Show table contents** button in the editor toolbar, **or** right-click the table → **Show table contents**

## Working with the Data Grid

The results open in an interactive grid with the following capabilities:

| Feature | How to use |
|---|---|
| **Sort** | Click a column header |
| **Filter** | Use the filter row below the header |
| **Paginate** | Navigate pages using the controls at the bottom |
| **Export** | Use the export button to download results |

## Notes

- Only the first **1 000 rows** are fetched by default — add filters to narrow results for large tables.
- For more complex queries (JOINs, aggregations, custom WHERE clauses), use the [Data Query](#sql-query-execution) feature instead.

# Compare Objects Across Systems

Compare the same ABAP object side-by-side between two connected SAP systems — useful for verifying transports, investigating system-specific behaviour, or checking what's in production before a deployment.

## Prerequisites

- At least 2 SAP systems connected in VS Code
- The object must exist in both systems

## How to Compare

1. Open or locate the ABAP object in the Explorer or editor.
2. Trigger the command using one of:
   - **Explorer:** right-click the file → **Compare With another SAP System**
   - **Editor:** right-click inside the file → **Compare With another SAP System**
   - **Command Palette** (`Ctrl+Shift+P`): `ABAP FS: Compare With another SAP System`
3. Select the target system from the quick pick list (shows only connected systems).
4. VS Code opens a diff view titled `OBJECT_NAME: DEV100 ↔ QA100`.

## Notes

- The diff opens as a standard VS Code side-by-side comparison — all editor shortcuts (e.g. `F7`/`Shift+F7` to jump between changes) work as normal.
- Path differences between SAP versions are handled automatically (`Source Code Library` for newer systems, `Source Library` for older ones).
- If the object does not exist in the target system, an error is shown.

# ABAP Test Cockpit (ATC) Analysis

ATC is SAP's built-in code quality framework — the same checks you run in SE80 or Eclipse ADT, but integrated directly into VS Code. It scans your ABAP objects for coding violations, security issues, performance problems, and (optionally) S/4HANA compatibility.

## Running ATC

With an ABAP file open, use any of these methods:

- **Keyboard:** `Ctrl+Shift+F2`
- **Command Palette:** `ABAP FS: Run ABAP Test Cockpit`
- **Copilot chat:** *"Run ATC on this file"*

Findings appear immediately as colored underlines in the editor, and in the **ATC Findings** panel (Activity Bar → ABAP FS → ATC Finds).

## Working with Results

Click any finding in the ATC panel to jump to the affected line. From there you can:

| Action | How |
|---|---|
| Read check documentation | Click **Show documentation** on the finding |
| Apply a quick fix | Click the lightbulb / use `Ctrl+.` on the underlined code |
| Get an AI-suggested fix | Ask Copilot: *"Fix this ATC finding"* |
| Request an exemption | Right-click a finding → **Request exemption** (single or bulk) |
| Hide exempted findings | Toggle **Filter exempted** in the panel toolbar |
| Re-run after saving | Toggle **Auto-refresh** in the panel toolbar |

## Enhancement Decorations

When viewing standard SAP code, 🎯 markers show where customer enhancements (BADIs, implicit enhancements, etc.) are active. Hover for details, or click the link to open the enhancement source directly.

## Configuring the Check Variant

The check variant controls which rules ATC applies — just like choosing a variant in transaction `ATC` or SE80. To set a default variant per connection:

1. Open **ABAP FS: Connection Manager**
2. Edit the connection
3. Set the **ATC Variant** field (e.g., `DEFAULT`, `S4HANA_READINESS`, or your custom variant)

Or add it directly to `settings.json`:

```json
"atcVariant": "S4HANA_READINESS"
```

## S/4HANA Migration Workflow

To check custom code for S/4HANA compatibility, set the variant to `S4HANA_READINESS`. ATC will then flag removed APIs, changed interfaces, and deprecated features on every run.

Recommended workflow:

1. Use the [S/4HANA Readiness Dashboard](#s4hana-readiness-dashboard) to identify all affected objects
2. Open each object and run ATC (`Ctrl+Shift+F2`) for detailed findings
3. Ask Copilot to fix the flagged issues based on the ATC documentation

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

# Syntax Validation

ABAP FS validates your code in real time — no need to run a separate syntax check. Errors appear as you type, directly in the editor and in the Problems panel.

## When it runs

Syntax checking triggers automatically on:

- **Open** — when you open an ABAP file
- **Edit** — as you type
- **Save** — when you save changes
- **Activate** — when activating the object

## Viewing errors

| Where | How to open |
|---|---|
| Inline underlines | Hover over the underlined code for details |
| Problems panel | `Ctrl+Shift+M` |
| Error lens (inline) | Shown automatically next to the offending line |

## Fixing errors

- **Quick Fix** — press `Ctrl+.` on an error to see available fixes
- **AI Chat fix** — click the sparkle icon next to an error to open an inline AI chat for a suggested fix
- **Jump to next error** — `F8` / `Shift+F8` to cycle through problems

# Where-Used Analysis

The VS Code equivalent of **Ctrl+Shift+F3** (Where-Used List) in SAP GUI. Finds every place an object, method, variable, or symbol is referenced across the entire system.

## How to Use

**Option 1 — Editor shortcut:**
1. Place the cursor on any symbol (class name, method, variable, etc.)
2. Press `Shift+F12` (Find All References) or right-click → **Find All References**
3. Results appear in the References panel with file locations and code snippets

**Option 2 — Ask Copilot:**
> "Where is `BAPI_USER_GET_DETAIL` used?"
> "Find all usages of method `FACTORY` in `ZCL_MY_CLASS`"

## Filtering Results

For large result sets (1,000+ references), filters prevent having to page through SAP standard objects to find your custom code:

| Filter | What it does |
|--------|-------------|
| Exclude standard objects | Shows only Z\* / Y\* custom code |
| Object type | Restrict to programs, classes, interfaces, etc. |
| Object name pattern | e.g. `Z*INVOICE*` to narrow by naming convention |

> **Tip:** Custom Z/Y objects often appear at the end of large result sets. Apply the "exclude standard objects" filter to jump straight to them.

## Compared to SAP GUI

| SAP GUI (Ctrl+Shift+F3) | VS Code |
|-------------------------|---------|
| Modal dialog, one object at a time | Inline results panel, stays open |
| No snippet preview | Shows code context around each reference |
| No pattern filtering | Filter by type, name pattern, custom-only |
| Paginated per transaction | Pagination + filters in one view |

# ABAP Debugging

Debug ABAP programs directly inside VS Code — no SAP GUI required. You get the same core capabilities as the SAP GUI debugger (breakpoints, stepping, variable inspection, call stack) with a modern editor experience and Copilot integration.

> 💡 **See also:** [Debug Recording & Replay](#recording-a-session) — record a session and replay it offline with step-back support.

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

﻿# Debug Recording & Replay

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
2. Open the Command Palette (`Ctrl+Shift+P`) → **ABAP FS: Start Debug Recording**
3. Step through your code normally — every step is captured
4. `Ctrl+Shift+P` → **ABAP FS: Stop Debug Recording**
5. At the prompt, choose **Save** (plain `.abaprecord`) or **Compress & Save** (`.abaprecord.gz`, ~80–95% smaller)

**What is captured per step:**

- Full call stack with source references
- All variables across all scopes (Local, Global, SY) — structures expanded, tables up to 2,000 rows
- Source file contents for offline viewing

---

## Replaying a Recording

1. `Ctrl+Shift+P` → **ABAP FS: Replay Debug Recording**
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
| **ABAP FS: Compress Debug Recording** | Compress an existing `.abaprecord` → `.abaprecord.gz` |
| **ABAP FS: Decompress Debug Recording** | Convert `.abaprecord.gz` back to plain JSON |

After compression the extension shows the size reduction (e.g. *42 MB → 3.2 MB, 92% smaller*). Both formats are fully interchangeable.

---

## All Commands

| Command | Description |
|---------|-------------|
| `ABAP FS: Start Debug Recording` | Begin recording the active debug session |
| `ABAP FS: Stop Debug Recording` | Stop and save (plain or compressed) |
| `ABAP FS: Replay Debug Recording` | Open and replay a recording file |
| `ABAP FS: Compress Debug Recording` | Compress an existing `.abaprecord` file |
| `ABAP FS: Decompress Debug Recording` | Decompress a `.abaprecord.gz` file |

---

## Limitations

| Limitation | Detail |
|------------|--------|
| Table rows | First 2,000 rows captured; remainder skipped (marked in replay) |
| Variable depth | Structures/tables beyond 4 levels deep are not expanded |
| Source unavailable | Shows `[source unavailable]` if caching failed during recording |
| No conditional breakpoints | Replay only steps through what was recorded |
| Step speed | ~1–3 seconds per step during recording (variable capture overhead) |

# SQL Query Execution

Query SAP tables directly from VS Code — the equivalent of SE16N or DBACOCKPIT, but driven by natural language and integrated with Copilot.

## How to Use

Open the Copilot chat (`Ctrl+Alt+I`) and describe what you want:

- *"Show me the first 10 records from MARA"*
- *"Query USR02 where the username starts with Z"*
- *"Compare open purchase orders in EKKO for vendor 1000"*

Copilot builds and executes the ABAP SQL query, then displays results in an interactive table in the editor.

## Working with Results

The result table supports:

| Action | How |
|---|---|
| Sort by column | Click a column header (click again to reverse) |
| Multi-column sort | Hold `Shift` and click additional headers |
| Filter rows | Type in the filter box — supports wildcards `*` and `?` |
| Export | Use the export button in the result toolbar |

You can also ask Copilot to refine results after the initial query: *"Now filter by plant 1000"* or *"Sort by creation date descending"*.

## Display Modes

**UI mode** (default) — results appear in a webview for you to explore interactively. Data stays in VS Code.

**Internal mode** — results are sent back to Copilot for further analysis (e.g., *"find duplicates"*, *"summarize by material type"*). Copilot automatically selects this mode when analysis is needed.

## Production System Protection

When Copilot would send data back to itself from a **production system**, a confirmation dialog appears:

- **Run & send to Copilot** — proceed with analysis
- **Run & show in UI only** — display results without sharing data with Copilot
- **Cancel**

This prevents sensitive production data from being inadvertently included in the AI context.

## Notes

- **Row limit:** Default 1000 rows, maximum 50,000. Copilot manages this automatically — the ABAP SQL `UP TO x ROWS` clause is not supported via ADT, so use natural language like *"limit to 500 rows"* instead.
- **Not just SAP data:** The same result viewer can display any structured data — JIRA issues, task lists, comparison tables — that Copilot assembles during a conversation.

# SAP Data Workbooks (.sapwb)

SAP Data Workbooks are VS Code notebooks that combine ABAP SQL queries, JavaScript processing, and Markdown in a single reusable `.sapwb` file. Use them for multi-step data analysis, data quality checks, and cross-system comparisons.

## Creating a Workbook

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: New SAP Data Workbook**

Alternatively, create any file with the `.sapwb` extension, or ask Copilot: *"Create a workbook to analyze material master data quality."*

## Cell Types

| Type | Purpose |
|------|---------|
| **Markdown** | Section headers, notes, documentation |
| **ABAP SQL** | Query SAP tables (`SELECT` and `WITH` only — no DML) |
| **JavaScript** | Process, filter, or compare results from earlier cells |

## Key Concepts

**Running cells**

- Run a single cell with the run button or `Shift+Enter`. You are prompted to select a SAP system.
- **Run All** (`Ctrl+Shift+Enter`) prompts once and uses that system for all SQL cells.

**Referencing results between cells**

- In **JavaScript**: access a previous cell's rows via `cells[N].result` (0-indexed, so cell 2 is `cells[1]`).
- In **ABAP SQL**: interpolate earlier results using `${...}`. Strings are auto-quoted; arrays are auto-joined for `IN` clauses.

```sql
-- Use results from cell 2 (index 1) as a filter
SELECT matnr, werks FROM marc
  WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

**Row limits**

Each SQL cell has a configurable row limit (default: 1000). Adjust with **ABAP FS: Set Cell Max Rows**.

## Example: Data Quality Check

```
Cell 1 (Markdown):   # Material Data Quality Check
Cell 2 (ABAP SQL):   SELECT matnr, mtart, meins FROM mara WHERE mtart = 'FERT'
Cell 3 (JavaScript): const rows = cells[1].result;
                     return rows.filter(r => !r.MEINS).length + " materials missing UoM";
Cell 4 (ABAP SQL):   SELECT matnr, werks FROM marc
                       WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

## Example: Cross-System Comparison

Run the same query against two systems by executing cells individually and selecting a different system each time. A JavaScript cell then diffs the results.

```
Cell 1 (Markdown):   # Pricing Condition Comparison: DEV vs QAS
Cell 2 (ABAP SQL):   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                     → Run, select DEV
Cell 3 (ABAP SQL):   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                     → Run, select QAS
Cell 4 (JavaScript): const devMap = new Map(
                       cells[1].result.map(r => [r.KSCHL + r.VKORG + r.MATNR, r])
                     );
                     return cells[2].result
                       .filter(r => {
                         const d = devMap.get(r.KSCHL + r.VKORG + r.MATNR);
                         return d && d.KBETR !== r.KBETR;
                       })
                       .map(r => ({
                         ...r,
                         DEV_KBETR: devMap.get(r.KSCHL + r.VKORG + r.MATNR).KBETR
                       }));
```

Workbook files store no system IDs, so they can be shared with colleagues who use different system names.

## Limitations

- SQL supports `SELECT` and `WITH` only — no `INSERT`, `UPDATE`, or `DELETE`
- String literals are limited to 255 characters (SAP ADT constraint)
- Avoid interpolating more than ~10 values into an `IN` clause — filter in a JavaScript cell instead
- Cancelling a cell shows "Interrupted" immediately, but the query continues running on the SAP side

## Commands

| Command | Shortcut / Notes |
|---------|-----------------|
| `ABAP FS: New SAP Data Workbook` | Creates a new `.sapwb` file |
| `ABAP FS: Set Cell Max Rows` | Sets row limit for the current SQL cell |

# Transport Request View

The Transport Request View is the VS Code equivalent of **SE09/SE10**. It lets you manage workbench and customising transports without leaving the editor.

**Open it:** Activity Bar → ABAP FS icon → **Transports** panel.

---

## What you can do

| Action | How |
|---|---|
| List your open transports | Panel opens automatically filtered to your user |
| List another user's transports | Click the filter icon and enter a username |
| Browse objects in a transport | Expand a transport node |
| Compare two transports | Right-click a transport → **Compare** |
| Copy transport number | Right-click → **Copy transport number** |
| Run ATC quality check | Right-click → **Run ATC** |
| Open in SAP GUI (SE09) | Right-click → **Open in GUI** |
| Release a transport | Right-click → **Release** |
| Delete a transport | Right-click → **Delete** |
| Change owner / add user | Right-click → **Change owner** / **Add user** |
| Link to source control | Right-click → **Add to source control** |
| Refresh the list | Click the refresh icon or press `F5` |

---

## Using Copilot to query transports

You can also ask Copilot in natural language:

- *"Show me my transports"*
- *"Get details for transport DEVK900123"*
- *"What objects are in DEVK900123?"*
- *"Compare transports DEVK900123 and DEVK900124"*

---

## Older SAP systems

If the ADT transport API is unavailable, the extension falls back to direct SQL queries against tables `E070`, `E071`, and `E071K` automatically — no configuration needed.

# Transport Object Operations

Work with individual objects inside a transport request directly from the **Transports** view in the sidebar.

## Accessing Object Actions

Right-click any object listed under a transport request to see available actions.

## Available Actions

| Action | What it does |
|---|---|
| **Open** | Opens the object in the editor |
| **Diff with current version** | Shows a side-by-side diff between the transported version and the current active version |
| **Reveal in Explorer** | Navigates to the object in the ABAP file explorer |

## Adding Objects to a Transport

Objects are added to a transport automatically when you save changes to an ABAP object that is assigned to a transport request. You can also manually assign an object:

1. Right-click the object in the explorer
2. Select **Add to Transport**
3. Choose the target transport request from the list

## Removing Objects from a Transport

1. Open the **Transports** view
2. Expand the transport request
3. Right-click the object you want to remove
4. Select **Remove from Transport**

> **Note:** Removing an object from a transport does not revert its source code — it only unlinks the object from that transport request.

# abapGit Integration

abapGit integration lets you manage Git version control for ABAP objects directly in VS Code, without leaving the editor.

## Opening the abapGit Panel

1. Click the **ABAP FS** icon in the Activity Bar (left sidebar).
2. Expand the **abapGit** section.

## Common Tasks

### Link an existing repository
1. In the abapGit panel, click **Link Repository**.
2. Enter the Git URL and select the SAP package to link.

### Create a new repository
1. Click **Create Repository**.
2. Provide the Git URL and target package.

### View staged/unstaged changes
The abapGit panel lists all changed ABAP objects. Each entry shows whether it is staged or unstaged.

### Stage and commit (Push)
1. Select objects to stage, or stage all changes.
2. Click **Push** — this commits and pushes to the remote Git repository.
3. Enter a commit message when prompted.

### Pull (update from Git)
1. Click **Pull** on the linked repository.
2. **Note:** Pull overwrites local ABAP objects with the version from Git. Unsaved local changes will be lost.

### Register with VS Code Source Control
Click **Register in VS Code SCM** to surface the repository in VS Code's built-in Source Control view (`Ctrl+Shift+G`), enabling diffs and history browsing alongside the ABAP FS panel.

### Unlink a repository
Click the **Unlink** icon next to the repository to remove the connection without deleting any code.

## Tips

- Use **Pull** to sync a fresh system with an existing codebase stored in Git.
- The abapGit panel respects the active SAP connection — switch connections in the ABAP FS panel first if you work with multiple systems.

# ABAP Revision History

Every time an ABAP object is activated, SAP stores a version snapshot — the same history you see in SE80 via **Utilities → Versions**. This extension surfaces that history in **VS Code's built-in Source Control view**, with a side-by-side diff editor.

## Opening Revision History

Revisions appear in the standard **Source Control view** (`Ctrl+Shift+G`), under a provider named `ABAP <connId>` (one per connected system).

There are four ways objects show up there:

1. **Automatic — Recent group.** Open any ABAP object in the editor. It's added to the **Recent** group of its connection's SCM provider, along with a diff decoration against the previous activated version.
2. **Whole transport.** In the **Transports** panel (ABAP FS activity bar), right-click a transport → **Add transport to source control**. Every object in that transport is added as its own SCM group.
3. **Object Property View.** ABAP FS activity bar → **Object Property** panel → **Revision history** section lists every stored version for the currently open object.
4. **Ask Copilot.** > "Show version history for ZCL_MY_CLASS" or ask to compare any two versions — uses the `get_version_history` tool (see below).

## Comparing Versions

### From the Source Control view

Click a resource in an `ABAP <connId>` group to open the default diff (current active version vs. previous revision), or use the inline icons on the row:

| Command | What it does |
|---|---|
| `Open diff with revision` | Side-by-side diff, active vs. previous revision |
| `Open diff normalized` | Same diff with formatting/comment differences stripped (SE80-style normalized compare) |
| `Open current version` | Just opens the current source, no diff |

Inline group actions:

- **Filter unchanged** — hides objects with no differences.
- **Clear** — empties the group.

### Stepping through revisions in the diff editor

While a revision diff is open, the editor toolbar exposes:

| Command | Scope |
|---|---|
| `Previous revision (left pane)` / `Next revision (left pane)` | Move the left (older) side back or forward in history |
| `Previous revision (right pane)` / `Next revision (right pane)` | Move the right (newer) side back or forward in history |
| `Toggle code normalization` | Strip formatting/comment differences on the fly |

### From the Object Property View

In the **Revision history** section, tick the checkbox next to any two versions to open a diff between exactly those two.

## Restoring an Old Version

There's no one-click restore. Open the diff to the version you want, copy the content from the pane holding the old version into the editor of the current active source, then save and activate as normal.

## vs. SE80 Version Management

| SE80 (Utilities → Versions) | This Extension |
|---|---|
| Opens in SAP GUI | Standard VS Code Source Control + diff editor |
| Text-based diff | Syntax-highlighted side-by-side diff |
| Normalized compare available | `Toggle code normalization` in diff toolbar |
| Manual copy to restore | Copy from diff pane |

## Using Copilot for Version History

The `get_version_history` tool supports three actions. Version numbers are **1-based**, where **1 = most recent**.

| Action | What it does |
|---|---|
| `list_versions` | Lists all versions with date, author, and transport |
| `get_version_source` | Returns full source code at a specific version number |
| `compare_versions` | Shows added/removed lines between two version numbers |

**Example questions:**

- "Show version history for ZCL_MY_CLASS"
- "Who last changed ZCL_MY_CLASS and when?"
- "Get the code from version 2 of ZCL_MY_CLASS"
- "Compare version 1 and version 3 of ZTEST_PROGRAM"
- "What changed between the last two versions of ZTEST_PROGRAM?"

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

# Run Unit Tests

Run ABAP unit tests directly from VS Code — no need to open SE80 or ADT.

## How to Run Tests

**Option 1 — VS Code Testing panel (recommended)**

1. Click the **beaker icon** in the Activity Bar (left sidebar) to open the Testing view.
2. Browse to your class or program in the test tree.
3. Click the **Run** (▶) button next to any test class or individual method.

**Option 2 — Command Palette**

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Type `ABAP FS: Run ABAP Unit Tests` and press `Enter`.

**Option 3 — Ask Copilot**

> "Run unit tests for ZCL_MY_CLASS"  
> "Run tests and fix any failures"  
> "Check if ZCL_PRICING tests pass"

## Results

Results appear in the **VS Code Testing panel** with:

| Info | Detail |
|---|---|
| Pass/Fail | Green ✓ / Red ✗ per test method |
| Test counts | Total, passed, failed |
| Execution time | Per method and total |
| Coverage | Test coverage percentage (when available) |

Failed tests show the error message inline — click a failure to jump to the relevant line.

## Compared to SE80 / ADT

| | SE80 / ADT | VS Code (ABAP FS) |
|---|---|---|
| Run tests | Menu → Unit Test | Beaker icon or `Ctrl+Shift+P` |
| See results | Dialog / tab | Native Testing panel |
| Copilot analysis | No | Yes — Copilot can explain failures and suggest fixes |
| Jump to failure | Manual | Click failure to navigate |

## Requirements

- The target object must contain ABAP unit test classes (`FOR TESTING`).
- You must be connected to the SAP system in VS Code.

# Create Test Classes

Add an ABAP unit test include to an existing class — the extension creates the skeleton and opens it in the editor.

## Requirements

- The target object must be a class (`*.clas.abap`)
- The class must already exist on the SAP system

## How to Create a Test Include

**Option 1 — Context menu**

Right-click the class file in the Explorer → **Create test class include**

**Option 2 — Command Palette**

1. Press `Ctrl+Shift+P`
2. Type `ABAP FS: Create test class include`
3. Press `Enter`

**Option 3 — Ask Copilot**

Open the Copilot chat and ask:

- *"Create test class for ZCL_MY_CLASS"*
- *"Add unit tests to ZCL_PRICING"*
- *"Set up testing for this class"*

## What Gets Created

- A test include linked to the main class
- A skeleton test class with `FOR TESTING` and `RISK LEVEL HARMLESS`
- The new include opens automatically in the editor

## Next Steps

After the include is created, add your test methods and run them with the [Run Unit Tests](#run-unit-tests) command.

# Test Documentation Generator

Generate a professional Word document from test screenshots — organized by scenario, with descriptions and a custom title. Useful for Playwright test reports, manual QA evidence, and sign-off documentation.

## How to Use

Open the Copilot Chat panel (`Ctrl+Alt+I`) and describe your scenarios with the full paths to your screenshots:

```
Create test documentation with these screenshots:

Scenario 1: Login Happy Path

- C:\tests\login1.png - Login page displayed
- C:\tests\login2.png - Successful login confirmed

Scenario 2: Error Handling

- C:\tests\error1.png - Invalid credentials message shown
```

Copilot calls the generator and saves a `.docx` file to your workspace.

## What the Document Contains

| Element | Details |
|---|---|
| Title | Custom report title (defaults to "Test Documentation Report") |
| Date | Test date in DD-MM-YYYY format (defaults to today) |
| Scenarios | Each scenario gets its own section with a name and description |
| Screenshots | Embedded images with per-screenshot captions |

## Tips

- Use **absolute paths** for screenshots (e.g. `C:\tests\...`), not relative paths
- You can include as many scenarios and screenshots per scenario as needed
- Specify a custom title or date in your prompt if the defaults don't fit: *"Use title 'Regression Test April' and date 30-04-2026"*

# SAP Testing

SAP Testing turns Copilot into an SAP test engineer. Point it at an ABAP report or transaction and it reads the code, explores the screens in a real browser, designs a test plan, works out what data each test needs, writes automated tests that drive SAP WebGUI, runs them, and hands you a Word evidence report.

You don't write Playwright code, you don't install Node or npm, and you don't open a terminal. You talk to Copilot in chat and review what it produces.

!!! info "GitHub Copilot in VS Code only"
    SAP Testing is built on VS Code chat skills and agents. It is **not** available through the [MCP Server](#mcp-server-for-external-ai-tools) — so Cursor, Claude Code, Claude Desktop, and other MCP clients cannot use it yet. The rest of ABAP FS still works with those clients.

## What you get

| | |
|---|---|
| **A reviewed test plan** | One Markdown file per test case, plus a printable `_index.docx` case list you can hand to a business owner |
| **Automated tests** | Playwright specs that drive SAP WebGUI — no login code, no hardcoded material numbers |
| **Per-landscape test data** | The same test runs on DEV, QAS, and PRD; the data is resolved separately for each |
| **Evidence** | A Word report per program and system: pass/fail summary, every step with a screenshot, and the database checks that prove SAP really did what it said |

## Why it's built this way

A test that passes for the wrong reason is worse than no test. So the framework deliberately slows Copilot down: work is split into seven phases, each producing artifacts on disk, and three of them are checked by an independent reviewer agent before the work is allowed to continue. Copilot cannot skip ahead — the tools that build the test index and run the tests refuse to run until the earlier steps have genuinely been done.

The other consequence is that **every phase can run in its own chat**. The artifacts on disk are the handoff, not the conversation, so you can analyse a program today and design cases next week without losing anything.

## What to expect

Set your expectations before you start, because this is not a push-button that turns a program into a finished test suite.

ABAP is rarely simple. Even a modest report carries years of validations, defaults, enhancements, and special cases, and a lot of that logic is only obvious to someone who knows the business. Copilot reads the code carefully and the reviewer agents catch a great deal, but they will still miss things, misread intent occasionally, and get stuck on screens that need your knowledge.

What the framework genuinely gives you is a **fast, thorough first pass with a rigorous process around it** — the enumeration work nobody enjoys, done exhaustively, with the evidence to check it. What it needs from you is review at the checkpoints, especially the test plan in phase 3, and honest answers when it asks a question.

Treat the output as a draft by a capable new team member who has read all the code but has never run the business. Reviewed properly it saves an enormous amount of time. Accepted blindly it produces tests that look convincing and prove very little.

SAP Testing is also a new feature and still maturing. If something doesn't work or the automation can't drive a control, that's worth reporting rather than working around.

## Prerequisites

Before you start you need:

- **ABAP FS installed and connected** to your SAP system — see [Installation](#installation-steps). The connection must have both a `url` and a `client`.
- **GitHub Copilot** in Agent mode, on VS Code 1.105 or newer.
- **SAP WebGUI enabled** on the target system. Everything runs through the browser-based GUI; paths that only work in SAP GUI for Windows (Excel/OLE uploads, native file dialogs) can't be automated here and Copilot will mark them as such.
- **Microsoft Edge** installed. It is detected automatically; set `abapfs.testing.edgePath` if you keep it somewhere unusual or want to use another Chromium browser.
- **A system that is safe to test on.** Tests click real buttons in a real SAP system.

You do **not** need Node.js, npm, Playwright, or a browser download — the extension bundles the test runner and uses your installed Edge.

## Where to start

1. [Getting Started](#getting-started-with-sap-testing) — enable the feature and run your first analysis in about five minutes.
2. [The Testing Workflow](#the-testing-workflow) — the seven phases, what you review at each one.
3. [Skills](#sap-testing-skills), [Subagents](#sap-testing-subagents), [Tools](#sap-testing-tools) — what's inside the framework.
4. [Troubleshooting](#sap-testing-troubleshooting) — when something goes wrong.

For internals — folder layout, the runtime API, quality gates, the data-resolution model — see the [Technical Reference](#sap-testing-technical-reference).

# Getting Started with SAP Testing

Five steps. You only do steps 1–4 once.

## Step 1 — Create an empty folder

Create a folder anywhere on your machine to hold your test artifacts, for example:

```
C:\sap-tests
```

This is a normal folder you own. Everything Copilot produces — test cases, scripts, results, evidence reports — goes here, and you can put it under Git if you want to share the suite with your team.

## Step 2 — Enable the feature

`Ctrl+Shift+P` → **ABAP FS: Enable SAP UI Testing Features** → pick the folder you just created.

SAP Testing stays completely hidden until you do this. Choosing the folder is what switches on the testing skills, subagents, and tools — before that, none of them appear in Copilot chat.

ABAP FS also drops a few of its own files into the folder at this point. Leave them alone — see [About the files ABAP FS creates](#about-the-files-abap-fs-creates) below for what they are and why they matter.

## Step 3 — Add the folder to your workspace

After you pick the folder, VS Code shows a notification with an **Add to Workspace** button. Click it.

**This step matters** for two reasons:

- **Fewer interruptions.** Copilot can edit files outside the workspace, but VS Code asks you to approve every one of those edits. A single phase writes a lot of files, so you'd spend the session clicking Approve.
- **Working error detection.** The `tsconfig.json` ABAP FS puts in the test folder only takes effect when the folder is open in the workspace. That's what gives real IntelliSense and red squiggles while Copilot writes test scripts — which means Copilot catches its own mistakes as it writes instead of at run time.

You can also do it later with **File → Add Folder to Workspace**.

## Step 4 — Choose models for the subagents

`Ctrl+Shift+P` → **ABAP FS: Set Models for SAP Testing Subagents**.

A panel opens listing the nine subagents that SAP Testing delegates work to, each with a hint about the kind of model it needs. Pick a model for each and save. VS Code will ask you to reload the window.

**Do this even though the framework ships with defaults.** The defaults name specific models that may not exist in your Copilot subscription, and an agent whose model isn't available falls back to whatever your main chat is using — usually a premium model doing work that a cheap one handles fine, which gets expensive quickly across a long analysis.

The rough shape of a good configuration: small fast models for the mechanical workers (Code Grep, Source Download, Data Scout), and stronger models — ideally from a *different* family than your main chat model — for the three reviewers, since their whole job is to catch mistakes the main agent made. See [Subagents](#sap-testing-subagents) for the full list.

If a model you picked later disappears from Copilot, ABAP FS tells you at startup and offers a **Configure Models** button.

## Step 5 — Start testing

Open Copilot Chat in **Agent mode** and type:

```
/sap-testing analyze report Z_MY_REPORT on DEV-100
```

`/sap-testing` is the only skill you need to remember. It's the entry point — it tells Copilot how the whole framework fits together and which of the other skills to load for whatever you asked for. Give it the ABAP object you want to test and the connection ID of the SAP system to use.

From there Copilot takes over: it downloads the source, reads it, and produces the first set of artifacts in your test folder. When it finishes a phase it tells you exactly what to say next, usually something like *"start a new chat and say: Explore the UI for Z_MY_REPORT on DEV-100"*.

You can follow that suggestion or just carry on in the same chat — both work. See [The Testing Workflow](#the-testing-workflow) for what happens in each phase and the trade-off between the two.

## About the files ABAP FS creates

Alongside your test artifacts you'll see a few files that ABAP FS manages itself — `tsconfig.json`, a `node_modules` folder, and (if you have the Playwright extension) `playwright.config.js` and `.sap-active-system`.

**Don't edit or delete them.** They're what gives Copilot real error-checking while it writes test scripts, and what lets the tests run without you installing anything. They point at the extension's own install path, so ABAP FS rewrites them on every startup and after every update — any change you make is overwritten. They're added to `.gitignore` automatically because they're specific to your machine.

If they do get deleted, nothing is lost: reload VS Code and ABAP FS recreates them.

## Optional: the Playwright sidebar

If you install Microsoft's **Playwright Test for VSCode** extension, you get the Test Explorer sidebar for browsing and running specs by hand, plus the trace viewer for debugging failures. ABAP FS adds the extra scaffolding that makes the sidebar work, and removes it again if you uninstall the extension.

It's genuinely optional — Copilot runs tests through ABAP FS's own tool either way, and that tool is given the target system as part of every run.

The sidebar has no way to pass that, so it has to be told in advance. That's what the **`SAP: <system>`** item in the status bar is for: it shows which SAP system the sidebar will run against, and clicking it (or running **ABAP FS: Select System for Playwright Sidebar**) lets you change it. Set it before running anything from the sidebar, or your tests will go to the wrong system.

The status bar item appears only while the Playwright extension is installed. If you never use the sidebar, you'll never see it and you can ignore this entirely.

# The Testing Workflow

Building a test suite runs in seven phases. Each one produces a specific set of files in your test folder and hands off to the next.

You don't have to memorise any of this. Start with `/sap-testing`, and at the end of every phase Copilot tells you exactly what to say to start the next one. This page is here so you know what you're looking at and what's worth reviewing.

| Phase | What Copilot does | What you get |
|---|---|---|
| 1. Analyze | Downloads and reads the ABAP source | `_flow.md`, `_units.md`, `_findings.md` |
| 2. Explore | Opens the transaction in a browser and maps the screens | `_screens.md` |
| 3. Design | Writes the test plan | `TC-001.md`… plus `_index.md` and `_index.docx` |
| 4. Define data | Specifies what data each case needs | `TC-001.data.md`… |
| 5. Prepare data | Finds real values in your SAP system | `data.json` per case, per system |
| 6. Build scripts | Converts each case into an automated test | `TC-001.spec.ts`… |
| 7. Run | Executes the tests and verifies the results | Screenshots, checks, and an evidence report |

## One chat or many — your call

Every phase reads what it needs from the files on disk, so a fresh chat loses nothing. Copilot ends each phase by suggesting a new chat and giving you the exact sentence to start it with, but that's a suggestion, not a requirement — carrying straight on in the same conversation works too.

The trade-off:

- **A new chat per phase** keeps the model's context small and focused, which usually means sharper work on long analyses. You review each phase's output as a natural checkpoint.
- **One continuous chat** is simpler and keeps the thread of your own decisions and asides, which can be handy on a small program. The risk is that a conversation carrying several phases of history gets sloppier as it fills up.

Rule of thumb: a short report is fine in one chat; a large program with dozens of cases is better split.

## Phase 1 — Analyze the code

Copilot resolves your transaction or report to its real executable object, downloads the complete source including every include, reads all of it, and writes down what it found: how the program flows, what every routine reads and writes, and a full list of every validation, message, branch, and authorization check.

The key output is `_findings.md`, which ends with a **target minimum** — the number of test cases this program honestly needs. That number drives the rest of the workflow.

**Worth your attention:** if you're testing a standard SAP transaction (ME21N, VA01, MIGO…), Copilot will suggest capturing an [ANST trace](#finding-enhancements-with-anst) first. Static analysis under-reports enhancements on standard code, so it's worth doing.

## Phase 2 — Explore the screens

Copilot opens the transaction in a real browser and walks through it, recording every field, button, checkbox, and dialog by the exact label the automation will need — plus each control's starting state.

This has to be done by looking, not by reading the ABAP source, because the labels a browser exposes are not the same as the field names in the code. A reviewer agent checks specifically for that mistake.

**Worth your attention:**

- Copilot will not click anything destructive without asking. If the program has a *Test Run* vs *Update* switch, it selects the test side first. If there's no test mode and the program writes data, it stops and asks you.
- If it hits a control it can't drive, it will ask you either for sample data or for a [recording](#recording-a-webgui-flow). Answering is much better than letting it guess.

## Phase 3 — Design the test cases

Copilot turns the findings and the screen map into one file per test case, each with the full selection-screen state, the steps, the expected result, and — importantly — how the case will be **proven** afterwards in the database, not just on screen.

An independent reviewer agent then reads the actual source again and challenges the plan: cases that were merged when they should be separate, categories that were quietly skipped, state-changing cases with no verification. Copilot fixes what it finds and re-reviews until it passes.

**Worth your attention:** you get `_index.docx`, a printable, bordered case list. This is the document to review yourself, or send to the business owner, before anyone writes a line of automation. Copilot will also ask which cases to prioritise.

## Phase 4 — Define the test data

For every case that needs data, Copilot writes a small spec describing the *shape* of what's needed — "a material of type FERT with a plant assignment" — rather than a specific number. That's what lets the same test run on a different landscape later.

Upload files are described here too, and Copilot matches the file format to what the program actually parses.

## Phase 5 — Prepare the data

Now Copilot finds real values in the SAP system you named, by querying it. It shows you everything it found in one table and **waits for your approval** before saving anything.

Approved values are cached per system, so DEV, QAS, and PRD each get their own set and changing one never affects another.

**Worth your attention:** if a query returns nothing, Copilot stops and tells you rather than inventing a value. If a test needs a record that only the program itself can create, it asks permission before running that setup — it's a real write to your system.

## Phase 6 — Build the scripts

Each approved case becomes one automated test. The scripts are written against a bundled SAP runtime, so they read like SAP steps rather than browser code:

```typescript
await sap.openTx("Z_MY_TCODE");
await sap.setField("Material", data.sample_material);
await sap.execute();
await sap.expectAlert(/completed/i);
```

No login code (the runner signs in for you), no hardcoded business data, no manual waits.

## Phase 7 — Run and verify

Copilot checks your data is ready, runs the tests, and then does the part that matters most: it runs the database checks each case declared, because a green screen doesn't prove SAP actually stored the right thing. A case whose UI passed but whose database check failed is reported as a **failure**.

Checks a machine can't do — an application-server file, an XML payload, an email actually arriving — are recorded as *pending* with instructions for you, and stay visible in the report until you confirm them.

Finally you get `<PROGRAM>-<SYSTEM>-report.docx`: a title page with the pass/fail summary, a colour-coded results table, and one section per case with every step, timestamp, and screenshot.

**Worth your attention:** Copilot reports three outcomes, not two. **Blocked** means the test never reached SAP because its data wasn't ready — that's a data problem, not a bug. Don't read it as a failure.

## The one loop

Occasionally a test needs a record that only *another* test can create. That setup script doesn't exist until phase 6, so phase 5 flags the requirement as deferred and you run it a second time after the scripts are built:

**4 → 5 → 6 → 5 → 7**

This is expected, not rework. Copilot names the deferred items in its handoff so the next chat knows a second data pass is owed.

## Running again later

Once a suite exists you don't repeat all seven phases. To run against another system, do phase 5 for that connection and then phase 7. To re-run the same tests after a code change, just phase 7.

# SAP Testing Skills

Skills are instruction sets that Copilot loads when it needs them. SAP Testing adds twelve, and they appear in chat only after you [enable the feature](#getting-started-with-sap-testing).

## The only one you need to know

```
/sap-testing
```

This is the entry point. It explains the whole framework to Copilot — the phases, the tools, the subagents, the rules — so Copilot works out which of the other skills to load for whatever you asked. You never have to choose.

Type `/` in the chat box to see every skill as a slash command if you want to invoke one directly, but for normal work `/sap-testing` plus a plain-English request is all it takes.

## Phase skills

One per phase of the [workflow](#the-testing-workflow). Copilot loads these automatically, and each is written to work standalone so a fresh chat can pick up from the files on disk.

| Skill | Phase | What it covers |
|---|---|---|
| `analyze-and-plan` | 1 | Downloading and reading the ABAP source, then writing down the program's flow, its routines' inputs and outputs, and every validation, message, branch, and authorization check it contains |
| `explore-ui` | 2 | Driving the live WebGUI in a browser and mapping every control by the label the automation will use, including the safety rules for anything destructive |
| `design-cases` | 3 | Turning the analysis into individual test cases with a full screen state, expected results, and the database checks that prove the case |
| `define-data` | 4 | Specifying what data each case needs as a reusable shape rather than fixed values, including upload file formats |
| `prepare-data` | 5 | Resolving those specs into real values from a specific SAP system, with your approval, and caching them per landscape |
| `build-scripts` | 6 | Converting each test case into an automated script, one to one, using only the bundled runtime |
| `run-scripts` | 7 | Running the tests, performing the post-run verification, building the evidence report, and diagnosing failures |

## Supporting skills

Loaded as needed alongside the phase skills.

| Skill | What it's for |
|---|---|
| `sap-webgui` | How SAP WebGUI actually renders — iframes, accessible names, selection screens, tab strips, editable grids, popups, and which locators are stable. This is what keeps the automation from breaking on the next screen refresh |
| `sap-webgui-recording` | When and how to ask you to [record a flow](#recording-a-webgui-flow) that Copilot can't explore on its own, and how to safely turn that recording into evidence |
| `helpers-reference` | The bundled test runtime's API — what each method does and what to do when a capability genuinely isn't there |
| `anst-guide` | Walking you through capturing an [ANST enhancement trace](#finding-enhancements-with-anst) for a standard SAP transaction |

# SAP Testing Subagents

Copilot hands specific jobs to specialised subagents instead of doing everything itself. Each one starts with a clean context, does one job, and reports back once.

Two reasons this matters to you: **large enumerations stay complete** (a subagent counting 200 branches doesn't get lazy near the end the way a main chat running low on context does), and **cost** — mechanical work runs on cheap models while only the reviewers use expensive ones.

!!! note "Not the same as ABAP FS subagents"
    These are separate from the [general ABAP subagents](#ai-subagents-for-optimized-abap-development) (`@abap-orchestrator` and friends), which are configured through chat and stored in your workspace. SAP Testing's subagents ship with the extension, are configured through a settings panel, and only exist when SAP Testing is enabled. You never call them by name — Copilot delegates to them.

## The nine subagents

### Workers

| Subagent | What it does |
|---|---|
| **Source Download** | Finds every include a program pulls in, recursively, and downloads one complete source snapshot |
| **Code Grep** | Counts and lists every message, branch, and authorization check in that snapshot — mechanically, with real line numbers |
| **Enhancement Research** | Finds customer enhancements (BAdIs, enhancement points, user exits) running inside the standard code a custom program calls, and explains each well enough to test it |
| **ANST Enhancement Analyser** | Reads an [ANST export](#finding-enhancements-with-anst), classifies every entry, and researches the customer objects it found |
| **Data Scout** | Finds real values in a live SAP system that match a requirement — a valid material, an open purchase order, a plant with stock |
| **Task Helper** | A general-purpose helper for bounded, high-volume work the main agent doesn't want to spend its own context on |

### Reviewers

These are adversarial on purpose: their job is to catch what the main agent got wrong, and the work cannot proceed until they pass it.

| Subagent | What it checks |
|---|---|
| **Findings Reviewer** | Re-reads the ABAP source and challenges the phase 1 analysis — invented line numbers, missed messages or branches, wrong date formats, an understated case count |
| **Screens Reviewer** | Checks the screen map really describes the live browser UI and wasn't quietly derived from the ABAP source instead |
| **Test Plan Reviewer** | Reads the source again and challenges the test plan — missed cases, merged cases that should be separate, skipped categories, cases that change data but have no verification |

## Configuring models

`Ctrl+Shift+P` → **ABAP FS: Set Models for SAP Testing Subagents**

The panel lists all nine with a hint about the kind of model each needs, and a dropdown of the Copilot models available to you. Pick one for each, save, and reload the window when prompted.

Guidance that actually affects results:

- **Reviewers should be strong models from a different family than your main chat model.** A model reviewing its own family's work tends to agree with it. Independence is the point.
- **Workers should be small and fast.** Code Grep, Source Download, and Data Scout follow strict formats and use tools; they don't need reasoning power, and they run often.
- **Enhancement Research is the exception among workers** — it needs genuine reasoning, so give it something mid-tier rather than the cheapest option.

## Why you should configure this even though defaults exist

The bundled agent files name specific models. If those aren't in your Copilot subscription, the agent falls back to your main chat model — so a premium model ends up doing mechanical grep work, repeatedly, for the whole analysis.

Two things to know:

- **After an extension update**, ABAP FS re-applies your saved choices automatically (updates reset the bundled agent files) and asks you to reload the window.
- **If a model you chose disappears** from Copilot, you get an error notification at startup with a **Configure Models** button.

# SAP Testing Tools

These are the tools Copilot calls while working through the [workflow](#the-testing-workflow). You never invoke them yourself — they're listed here so you recognise the names when Copilot mentions one, and know what it just did.

They appear only when SAP Testing is [enabled](#getting-started-with-sap-testing), and they sit alongside the [regular ABAP FS tools](#abap-language-model-tools-ai-assistant-features) that Copilot uses for reading source and querying tables.

| Tool | What it does |
|---|---|
| `get_test_folder` | Returns your configured test folder. Copilot calls this before touching anything, and warns you if the folder isn't open in your workspace |
| `get_sap_webgui_url` | Builds a ready-to-open SAP WebGUI URL for a connection, already signed in, optionally landing on a specific transaction |
| `build_test_index` | Validates every test case file and rebuilds the case list — `_index.md` and the printable `_index.docx`. Refuses to run until the test plan reviewer has passed the plan |
| `build_test_index_docx` | Regenerates just the printable `_index.docx`, for when only the notes changed |
| `split_test_cases` | Splits one bulk-authored file into individual test case files, validating each before writing |
| `verify_test_data_usage` | Cross-checks a script against its data spec, so a script can't reference a value nobody defined |
| `check_test_data` | Pre-flight check: resolves every case's data for a program on a given system and reports what's missing — before you waste a test run finding out |
| `playwright_test` | Runs one test or a whole program's tests against a system. Signs the browser in, executes, and returns pass/fail plus paths to the screenshots and traces. Refuses to run until the earlier phases are genuinely complete |
| `build_evidence_report` | Builds the aggregated Word evidence report for a program and system from all the run results |
| `analyze_anst_enhancements` | Classifies an [ANST export](#finding-enhancements-with-anst) and writes a work list beside it |

## Two tools that push back

`build_test_index` and `playwright_test` are deliberately gated: Copilot has to certify that the required review or readiness check actually happened before either will run. If Copilot tries to skip ahead, the tool rejects the call.

This is why you'll sometimes see Copilot go back and do something it seemed to have finished — the tool told it to. Details in the [Technical Reference](technical-reference.md#quality-gates).

## If Copilot says a tool is missing

VS Code doesn't always surface every tool to the model straight away, and `playwright_test` is the one that most often goes missing. Copilot is instructed to search for a tool by name before giving up, and to tell you rather than improvise — so if it reports a missing tool, that's a genuine report, not a mistake.

Starting a new chat usually clears it. What Copilot must never do is substitute a terminal command; there is no `npx playwright test` route here.

# Recording a WebGUI Flow

Sometimes Copilot hits a screen it can't work out on its own — a control with no readable label, a sequence that depends on how your system is personalised, or a step that needs business judgement. When that happens it asks you to record the flow instead of guessing.

This is an escape hatch, not part of the normal workflow. Copilot should explore on its own first, and it's told not to ask you to record ordinary screens just to save itself effort.

## How to record

`Ctrl+Shift+P` → **ABAP FS: Record SAP WebGUI Flow**

1. Pick the SAP system when prompted. The command signs the browser in for you, so you start on the transaction rather than a logon screen.
2. Give the recording a short descriptive name, like `me21n-edit-po-item`. Existing recordings are never overwritten.
3. Microsoft Edge opens with the Playwright recorder attached. Perform the flow.
4. Close the recorder when you're done. The file opens in your editor automatically.

The result is saved to `recordings/<name>.recording.ts` in your test folder.

## Recording well

- **Record the smallest useful path.** One grid edit or one dialog is usually enough. Copilot should have told you exactly which interaction it needs.
- **Start from a fresh transaction, in English.** Accessible names are language-specific.
- **Avoid exploratory clicking.** Every click becomes generated code and adds noise for Copilot to filter out.
- **Use safe test data.** Never type passwords, secrets, or production personal data — it ends up in the file.
- **Stop before the destructive action** — Save, Post, Release, Delete, Approve — unless Copilot specifically asked for it. If it did, it should have told you so explicitly, and you should be on a system where changing data is fine.

When you're done, tell Copilot the path and describe what you were doing and anything ambiguous you noticed.

## What happens to it

A recording is **reference evidence, not a test**. Copilot reads it to understand the interaction order and the real control names, then writes those verified observations into the screen map and continues the phase it was in. It never runs the recording, never copies it into your test scripts, and never trusts the raw generated selectors — recorder output is full of session-specific IDs and positions that break on the next screen refresh.

Once the resulting test passes its first run, the recording has done its job and Copilot will offer to delete it.

# Finding Enhancements with ANST

When you test a **standard SAP transaction** — ME21N, VA01, MIGO, MM43 — the code that actually breaks in your system is usually not SAP's. It's your enhancements: BAdI implementations, enhancement points, classic user exits. Reading the call chain statically under-reports them badly, because enhancements are called indirectly and nest several levels deep.

Transaction **ANST** (Automated Note Search and Customer Code Detection Tool) solves this by tracing what actually executes at runtime. Copilot will suggest it during analysis whenever your target is a standard transaction.

This only applies to standard SAP objects. For a custom Z or Y program, Copilot uses static enhancement research instead and no trace is needed.

## Capturing the trace

You do this part in SAP; Copilot walks you through it and consumes the result.

1. Open transaction **ANST**.
2. Select **Transaction** (or **Program** for a report) and enter your target. A description helps you find the trace later.
3. Click **Execute**. Your transaction opens inside the trace session.
4. **Run through the transaction properly.** Complete at least one full flow — for ME21N, fill everything in and actually save the purchase order. Each variation you exercise (different document types, account assignments) may fire different enhancements, so a few passes are better than one.
5. Press **Back** (F3) to return to ANST. You'll see a tree of the application components touched.
6. Click **Select All**, then **Customer Code**.
7. Export the results **as xlsx** — not CSV, not text.

Save it under your test folder, in `tests/<PROGRAM>/sources/anst/`, and give Copilot the full path.

The trace is only as good as the flows you exercised. A trace where you opened the transaction and pressed Back finds almost nothing.

## What Copilot does with it

It classifies every row in the export — genuine customer objects, user exits, potential includes, standard SAP code — writes the classified work list beside your spreadsheet, and then researches each customer object to understand what it actually does. Those findings feed straight into the test plan, so your enhancements get their own test cases rather than being invisible.

If you already have an ANST export from an earlier session, skip the collection steps and just give Copilot the path.

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

The connection Copilot was given doesn't exist or is incomplete. SAP Testing needs both a `url` and a `client` on the connection to build the WebGUI URL — see [Connection Manager](#sap-connection-manager).

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

By design. A control it can't drive, data it can't find, or an ambiguous screen is a stop-and-ask situation, because the alternative — a plausible guess — produces a test that looks finished and silently proves nothing. Give it the answer, a sample file, or a [recording](#recording-a-webgui-flow).

### Copilot won't click a button

Anything destructive — post, delete, release, approve, or Execute on a program in update mode — needs your explicit approval first. Confirm in chat, ideally after checking the system is safe to write in.

# SAP Testing Technical Reference

Internals for people who want them. None of this is needed for day-to-day use — see [Getting Started](#getting-started-with-sap-testing) and [The Testing Workflow](#the-testing-workflow) for that.

## Commands and settings

| Command | Purpose |
|---|---|
| **ABAP FS: Enable SAP UI Testing Features** | Pick the test folder. This is what switches the feature on |
| **ABAP FS: Open SAP UI Test Folder** | Reveal the test folder in your file manager |
| **ABAP FS: Set Models for SAP Testing Subagents** | Choose the model backing each subagent |
| **ABAP FS: Record SAP WebGUI Flow** | Record a reference flow in Edge |
| **ABAP FS: Select System for Playwright Sidebar** | Only for the optional Playwright extension — the sidebar can't ask which system to use |

| Setting | Scope | Purpose |
|---|---|---|
| `abapfs.testing.folder` | User | The test folder. Setting it enables the feature |
| `abapfs.testing.edgePath` | User | Browser executable override; empty means auto-detect Edge |
| `abapfs.testing.subagentModels` | User | Model chosen per subagent — written by the panel, not by hand |
| `webGuiAutoLogin` | Per connection | Defaults to true. Turn off for systems behind a gateway that already authenticates you |

Everything is gated behind the `abapfs:testingEnabled` context key, which is set only when `abapfs.testing.folder` resolves to a directory that exists. Skills, subagents, and tools are all contributed conditionally on it.

## Test folder layout

```
<TEST_FOLDER>/
├── tsconfig.json                    managed by ABAP FS
├── node_modules/@sap-testing/runtime  managed by ABAP FS
├── recordings/                      reference recordings, never runnable specs
├── .playwright-artifacts/           Playwright traces (kept on failure)
└── tests/
    └── <PROGRAM>/                   one folder per object under test
        ├── sources/<timestamp>/     downloaded ABAP source snapshot
        ├── sources/anst/            ANST exports, if any
        ├── test-cases/
        │     _flow.md  _units.md  _findings.md  _screens.md
        │     TC-001.md  TC-001.data.md  …
        │     _index.md  _index.docx
        ├── test-scripts/
        │     TC-001.spec.ts  …
        └── test-results/
              <CONNECTION-ID>/TC-001/   data.json, step-NN.png,
              │                          manifest.json, verification.json,
              │                          fixtures/, runs/<timestamp>/
              └── <PROGRAM>-<CONNECTION-ID>-report.docx
```

Two conventions that matter:

- **Everything for one program is siblings.** A case, its data spec, its script, and its results all live under `tests/<PROGRAM>/`.
- **The results folder is the connection ID in uppercase.** The framework uppercases it at run time, so a hand-written lowercase folder is silently not found on Linux and macOS, and only appears to work on Windows.

## Managed scaffolding

ABAP FS writes a small amount of infrastructure into the test folder and re-applies it on every activation, because the extension's install path changes with each version.

**Always:** a `tsconfig.json` that maps the module specifier `@sap-testing/runtime` to the extension's compiled runtime, a link to that runtime under `node_modules`, and a `.gitignore` entry for both. This is what gives the TypeScript language service real IntelliSense and type errors while Copilot writes a spec — checked against the actual runtime signatures rather than prose in a skill — and what lets the test runner resolve the runtime at execution time. The language-service half only applies while the test folder is open in your workspace; the runner half works either way.

**Only while Microsoft's Playwright extension is installed:** a `playwright.config.js`, links to the bundled Playwright, a `.bin` launcher, and `.sap-active-system`. These exist purely so the Test Explorer sidebar can discover and run specs. They're removed again if you uninstall that extension. The `playwright_test` tool needs none of them — it passes its own config and sets the target system directly in the runner's environment.

All of it is gitignored, because it hardcodes machine-specific absolute paths.

## Artifact fields

Each `TC-NNN.md` carries frontmatter that the index builder validates. The values that are checked against a fixed list:

**`category`** — `happy-path`, `boundary`, `invalid`, `mandatory`, `authorization`, `empty`, `large`, `idempotency`, `cross-tx`, `concurrency`, `background-artifact`, `discovered-control`. Phase 3 walks all twelve and any the program genuinely can't exhibit must be justified in writing, so nothing is silently dropped.

**`runnable`** — `runnable`, `manual`, `blocked-by-data`, `runnable-elsewhere`. The last one covers cases that need a different SAP user; a test run authenticates one session as the connection's own user and there's no way to switch mid-run, so negative-authorization cases must run against a separate connection.

**`verification`** — `sql`, `manual`, `mixed`, `none`. How the case is proven after the UI passes. `none` is only valid when the path can't have written anything.

**`dataRequired`** — `yes` or `no`, and it must agree with whether a `.data.md` exists. Both mismatches are errors.

`_index.md` is a mechanical projection of all that frontmatter and should never be hand-edited — the only section preserved across rebuilds is `## Notes` at the bottom.

One recurring trap: YAML frontmatter must be the literal first bytes of the file, not inside a code fence or under a heading. Misplaced frontmatter in a `.data.md` parses to zero requirements, so every data value silently resolves to undefined.

## The test data model

A `.data.md` declares requirements by shape, not value. Each has a `source`:

| Source | Resolved by |
|---|---|
| `sql` | Querying the target system during phase 5, with your approval |
| `static` | A fixed value written in the spec |
| `user` | Asking you |
| `generated` | Building an xlsx or CSV fixture from a declarative column/row spec |
| `seeded` | Running another test case's script once as an approved setup step, then reading the result back |

At run time each key resolves in this order:

1. Environment pin `TESTDATA_<TCID>_<SYSTEM>_<key>`, then `TESTDATA_<TCID>_<key>`
2. `generated` — rebuilt fresh on every run, never cached, so date fields can't go stale
3. The `data.json` cache for this connection
4. `static` values from the spec

Only `sql` and `seeded` values belong in `data.json`. Caching a `static` value shadows the spec so later edits to it do nothing; caching a `generated` one reintroduces the stale-fixture problem.

Fixtures support `{{other_key}}` substitution and relative date tokens (`today`, `+30d`, `-5d`) resolved against the current run time, so a fixture never carries an absolute date.

Keys that must differ from each other declare `distinctFrom` on both sides; `check_test_data` fails the program if they resolve to the same value. Ordering with `take: first` is not a uniqueness guarantee, because a `SELECT` without `ORDER BY` has no defined row order.

## Quality gates

Three reviewer agents and two tool-level gates keep the workflow honest.

**Reviewer agents** run at the end of phases 1, 2, and 3. Each reads the underlying evidence itself rather than trusting the main agent's summary, returns either a pass or an itemised gap list, and the phase does not hand off until every gap is fixed and it passes.

**Gated tools** require the calling agent to certify that a prerequisite genuinely happened, using an exact confirmation string:

| Tool | Requires |
|---|---|
| `build_test_index` | Certification that the test plan reviewer already returned a pass |
| `playwright_test` | Certification that all upstream phase gates and data readiness were verified |

Both reject the call if the confirmation is missing or wrong, which means an agent that skipped a phase cannot produce the case index or run a test. The gate is a behavioural contract rather than a cryptographic one — its purpose is to stop a model from quietly cutting a corner under pressure, not to defend against a determined attacker.

`build_test_index` also enforces structural rules: valid categories, matching case IDs, parseable frontmatter, and agreement between `dataRequired` and the presence of a `.data.md`. A missing `.data.md` for a case that needs one is a warning during phase 3 (specs come later) and must be zero by the end of phase 4.

## The runtime

Specs import from the fixed specifier `@sap-testing/runtime`, never a relative path. It exposes `SapSession` (the UI driver), `SapArtifacts` (application-server file and spool checks), `resolveTestData`, `buildFixture`, and some formatting helpers.

`SapSession` methods describe SAP mechanics rather than business concepts — `setField`, `setRange`, `check`, `selectRadio`, `clickButton`, `clickTab`, `setGridCell`, `pickFromValueHelp`, `execute`, `captureDownload`, plus assertions like `expectAlert`, `expectTitle`, `expectGridHasRow`. You can't add methods to it, which is what stops business logic leaking into the runtime.

Every action goes through the same guarded cycle:

```
dismiss known popups → perform the action → wait for the server round-trip
→ wait for the DOM to settle → dismiss popups again
→ check for a dump, ITS error, or logon screen → capture an evidence screenshot
```

That's why specs contain no manual waits and no explicit screenshots, and why a short dump surfaces as a clear failure instead of a confusing timeout on the next step.

The popup guard dismisses a curated allow-list only — license notices, system messages, multiple-logon, copyright, data privacy. Anything else, including "do you want to save?", is left alone for the test to handle deliberately.

For anything the runtime doesn't cover, `sap.raw()` returns the real Playwright page. All SAP content lives inside the ITS iframe, so raw locators must be scoped through it or they query an empty document and can pass vacuously.

## Authentication

No spec ever contains credentials or a login step.

Before running, the tool mints a SAP reentrance ticket from your ABAP FS connection and posts it through a single-use local form (tickets can't travel in a URL query string). The resulting session cookies are saved and handed to every spec, so tests start already signed in. The same mechanism produces the pre-authenticated URLs used for browser exploration and recording — those URLs are single-use, which is why they must be opened exactly as issued.

Setting `webGuiAutoLogin: false` on a connection skips all of it, for landscapes where a gateway handles authentication.

## Execution

`playwright_test` runs the real `@playwright/test` CLI as a subprocess, using VS Code's own Node runtime and a copy of Playwright vendored into the extension. Nothing is installed into your test folder and no browser is downloaded — it drives your installed Edge.

Defaults: one worker, no retries, 60 seconds per test, 10 minutes overall, traces retained on failure under `.playwright-artifacts/`. Tests run headless unless asked for a headed run, which is worth doing the first time a new spec runs.

Serial execution with no retries is deliberate. Parallel SAP sessions interfere with each other, and automatic retries hide flakiness that usually turns out to be a real timing or data problem.

## Evidence output

Each case run writes `manifest.json` (every step, timestamp, and note) plus numbered screenshots into its results folder. Previous runs are archived into `runs/<timestamp>/` rather than deleted, and the data cache survives.

Post-run checks land in `verification.json`, recording each check, who performed it, the SQL or tool used, actual versus expected, and its status. Checks a machine can't perform stay `pending-manual` until you confirm them.

`build_evidence_report` aggregates all of it into one Word document per program and connection: a title page with the pass/fail summary, a colour-coded results table, and one section per case with every step and screenshot. Where a `verification.json` exists, its checks appear too — so a case that passed on screen but failed its database check shows as failed, and a case with unconfirmed manual checks is visibly not fully proven. Rebuilding is cheap and safe to repeat.

# Mermaid Diagram Creation

[Mermaid](https://mermaid.js.org/) is a text-based diagramming language that lets you describe diagrams as simple text — no drawing tools needed. ABAP FS can generate and display Mermaid diagrams directly in VS Code via Copilot chat.

## How to Create a Diagram

1. Open Copilot Chat (`Ctrl+Alt+I`).
2. Describe the diagram you want. Examples:
   - *"Create a flowchart showing the flow of method `PROCESS_DATA`"*
   - *"Generate a class diagram for `ZCL_MY_CLASS`"*
   - *"Show a sequence diagram for the BAPI call in `ZMY_PROGRAM`"*
3. The diagram renders in an interactive webview at 200% zoom.

## Working with the Diagram Viewer

| Action | How |
|--------|-----|
| Zoom in / out | Use the zoom controls in the webview (20% increments) |
| Save diagram | Click the save button in the webview |

## Supported Diagram Types

Flowchart · Sequence · Class · State · ER · User Journey · Gantt · Pie · Git Graph · Mind Map · Timeline · Sankey · XY Chart · Block · Packet

## Themes

`default` · `dark` · `forest` · `neutral`

Specify a theme in your prompt: *"Create a flowchart … using the dark theme"*

# ABAP Documentation

Look up SAP help for any ABAP keyword directly in VS Code, without leaving the editor.

## How to Use

1. Open an ABAP file in the editor.
2. Place your cursor on the keyword you want to look up (e.g., `SELECT`, `LOOP`, `MODIFY`).
3. Press **F1** — the SAP documentation for that keyword opens immediately.

Alternatively, run **ABAP FS: Show ABAP documentation** from the Command Palette (`Ctrl+Shift+P`).

## What to Expect

- The help content is context-sensitive: it reflects the keyword under the cursor.
- Documentation is fetched from SAP's official help portal and displayed inside VS Code.

# ABAP Dumps Analysis

Analyze ST22 runtime dumps directly in VS Code — no SAP GUI required.

## What This Replaces

In SAP GUI, you'd use **transaction ST22** to find and read dumps. Here, the same data is available in VS Code with AI-powered root cause analysis and fix suggestions.

## Opening the Dumps Panel

**Activity Bar → ABAP FS icon → Dumps**

Or ask Copilot directly (see [Using Copilot](#using-copilot) below).

## Step-by-Step Workflow

1. **Open the Dumps panel** — the list shows each dump's ID, error type, timestamp, and size.
2. **Click a dump** to open the detailed view.
3. **Review the structured analysis** — the extension parses the raw HTML dump content and presents it in a readable format.
4. **Ask Copilot for help** — Copilot can identify the root cause and suggest a fix based on the dump data.

## Using Copilot

Type any of these in the Copilot chat:

| Prompt | What it does |
|---|---|
| `Analyze the latest dumps` | Lists recent dumps and analyzes the most recent one |
| `Show me dumps from today` | Filters to today's dumps |
| `What caused the RABAX error?` | AI root cause analysis on the current dump |
| `Analyze dump with ID xyz123` | Analyzes a specific dump by ID |

## Compared to ST22

| ST22 (SAP GUI) | VS Code Dumps panel |
|---|---|
| Manual navigation through raw HTML | Structured, parsed output |
| No AI assistance | Copilot explains cause and suggests fix |
| Separate tool from your editor | Inline with your code |

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

# Text Elements Management

Manage translatable text elements (symbols) in ABAP programs, classes, and function groups — the VS Code equivalent of the **Text Elements** tab in SE38/SE24.

**Supported object types:** Programs · Classes · Function Groups

---

## Opening the Text Elements Manager

Three ways to open it for the active file:

| Method | Steps |
|--------|-------|
| Command Palette | `Ctrl+Shift+P` → **ABAP FS: Text Elements Manager** |
| Context menu | Right-click an ABAP file in Explorer → **Text Elements Manager** |
| Copilot | Ask: *"Show me text elements for ZTEST_PROGRAM"* |

---

## What You Can Do

### Read text elements
Works on **all SAP systems**. Displays existing text element IDs and their translations in an interactive webview.

### Create / Update text elements
Available on **newer systems** with ADT text elements API support. Lets you add new symbols or change existing text directly in VS Code — no SAP GUI needed.

> **Older systems fallback:** If the ADT API is not available, the extension automatically opens the text element editor in SAP GUI instead.

---

## Step-by-Step: Editing Text Elements

1. Open an ABAP program, class, or function group in the editor.
2. Press `Ctrl+Shift+P` and run **ABAP FS: Text Elements Manager**.
3. The webview shows all existing text elements for the object.
4. To **add** a new element, enter the ID (e.g. `001`) and text value, then confirm.
5. To **change** an existing element, edit the text inline and save.
6. Changes are applied to the active object on the server.

---

## Compared to SE38 Text Elements

| SE38 / SE24 | VS Code (ABAP FS) |
|-------------|-------------------|
| Navigate to program → Goto → Text Elements | Command Palette or right-click |
| Edit in ABAP editor screen | Interactive webview |
| Save with `Ctrl+S` | Save within the webview |
| Requires SAP GUI | Works directly in VS Code (newer systems) |

---

## System Compatibility

| Operation | Older systems | Newer systems (ADT API) |
|-----------|--------------|------------------------|
| Read | Yes | Yes |
| Create / Update | Opens SAP GUI fallback | Yes, in VS Code |

# Regex Search in Code

Search ABAP source code using plain text or regular expressions (regex). Regex is a pattern language that lets you match variable text — for example, finding any method name that starts with "get", or any word boundary match.

> **Note:** This searches **committed code only**. Unsaved local edits are not visible — use the standard VS Code search (`Ctrl+Shift+F`) for those.

---

## How to Search

Just ask Copilot in plain language:

- *"Find all usages of COMMIT WORK in ZCL_MY_CLASS"*
- *"Search for methods matching 'get_\*' in ZREPORT_ORDERS"*
- *"List all methods in CL_SALV_TABLE"*

Copilot determines whether to use literal or regex matching automatically.

---

## Literal vs. Regex Mode

| Mode | When to use | Example |
|------|-------------|---------|
| **Literal** (default) | Exact text match, fast | `COMMIT WORK` |
| **Regex** | Patterns, wildcards, boundaries | `METHOD.*get` |

### Common Regex Patterns

| Pattern | What it matches | Example |
|---------|-----------------|---------|
| `\bICT\b` | Whole word `ICT` only (not `DICT`) | Word boundary |
| `METHOD.*restrict` | `METHOD` followed by anything then `restrict` | Pattern match |
| `[A-Z]+` | One or more uppercase letters | Character class |
| `^\s*(CLASS-)?METHODS?\s+\w+` | Any method declaration | Class structure |

---

## Searching Multiple Objects

Use wildcard patterns to search across several objects at once:

- *"Find SELECT \* in all Z\* reports"* — searches up to 10 matching objects
- Copilot limits the scope automatically (1–10 objects) to keep results manageable

---

## Viewing Class Structure

To list all methods in a class with their line numbers:

- *"List all methods in ZCL_MY_CLASS"*

Copilot returns each method name and the line where it's declared — useful for navigating large classes.

---

## Extracting a Single Method

To see the complete code of one method:

- *"Show me the FACTORY method in CL_SALV_TABLE"*

Returns everything from `METHOD FACTORY.` to `ENDMETHOD.`, including interface method syntax like `IF_SALV_TABLE~FACTORY`.

---

## Context Lines

By default, Copilot shows 3 lines before and after each match. Ask for more or fewer:

- *"Find RAISE EXCEPTION in ZCL_ORDERS, show 5 lines of context"*

# S/4HANA Readiness Dashboard

Visualize custom code compatibility with S/4HANA using data from SAP's Custom Code Migration tool (transaction SYCM).

## Prerequisites

- Run transaction **SYCM** on your SAP system first — the dashboard reads the analysis tables it populates (`sycm_sitem`, `sycm_cust_refs`, and related tables)
- Works on ECC systems being analyzed for S/4HANA migration

## Opening the Dashboard

Three ways to load it:

| Method | Steps |
|--------|-------|
| Activity Bar | **ABAP FS** panel → **S/4HANA Readiness** section → click **Load Dashboard** |
| Command Palette | `Ctrl+Shift+P` → `ABAP FS: S/4HANA Readiness - Load` |
| Copilot Chat | Ask: *"Load the S/4HANA readiness dashboard"* |

## Reading the Results

The dashboard shows a tree grouped by **simplification item** (SAP Note):

```
DRS310 — 156 references in 42 items
├── Summary
├── 2830416 — Remove usage of BSEG (12 refs)
│   ├── ZMY_REPORT
│   └── ZCL_FINANCE
├── 2780106 — ... (5 refs)
│   └── ZFG_CUSTOM
└── Unlinked References
```

- **Root node** — your connection ID with a total count
- **Simplification Item nodes** — each SAP Note that affects your code, with reference count
- **Custom object nodes** — your Z/Y objects that need to be changed
- **Unlinked References** — references that couldn't be matched to a simplification item

## Working with Results

**Open an object for editing**
Click any custom object node — it opens directly in the editor.

**Run ATC analysis on an object**
Right-click a reference → **Run ATC** — runs ATC checks scoped to that object.

**Get a Copilot fix suggestion**
Right-click a reference → **Ask Copilot to Fix** — opens a Copilot prompt pre-loaded with the compatibility issue details.

**Open the linked SAP Note**
Right-click a simplification item → **Open SAP Note** — opens the note in your browser.

**Filter by name pattern**
Use the filter icon and enter a wildcard pattern, e.g. `Z*PRICING*` or `Y*`, to narrow the list.

**Refresh / Clear**
Use the **Refresh** button to reload from SAP, or **Clear** to remove the dashboard data.

**Multiple systems**
Load dashboards from several connected systems simultaneously — each appears under its own root node.

## ATC Integration

For full readiness analysis, combine the dashboard with ATC:

1. Set your ATC check variant to an S/4HANA readiness variant (e.g. `S4HANA_READINESS`)
2. In your connection settings, set the `atcVariant` property to run this variant by default
3. Use the dashboard to spot affected objects, then right-click → **Run ATC** for detailed per-object findings

# RAP Generator

RAP (RESTful ABAP Programming model) is SAP's modern framework for building OData services on S/4HANA. Building a RAP service manually requires creating many interdependent objects — CDS views, behavior definitions, service definitions, and bindings. The RAP Generator creates the entire stack from a single database table in one step.

## Requirements

- S/4HANA or BTP system with ADT RAP Generator API support
- The source database table must already exist on the system

## Open the RAP Generator

Three ways to open it:

- **Activity Bar** → ABAP FS icon → **RAP Generator** panel
- **Right-click** a database table in the editor → **Generate RAP Service**
- **Command Palette** (`Ctrl+Shift+P`) → `ABAP FS: Generate RAP Service`

## Generate a Service

1. Select your SAP system from the dropdown
2. Enter the source **database table name** — default artifact names are fetched automatically from SAP
3. Review and adjust the generated names (CDS view, behavior definition, service binding, etc.)
4. Set the **package** (leave `$TMP` for local objects; a transport request will be prompted for other packages)
5. Click **Preview** to see the full list of objects that will be created
6. Click **Generate** — all artifacts are created on the server in a single operation

After generation, the service binding opens automatically in the editor.

## Generated Artifacts

| Artifact | Purpose |
|----------|---------|
| CDS Interface View | Data model layer |
| CDS Projection View | Service projection / field selection |
| Behavior Definition | CRUD operations and validations |
| Behavior Implementation Class | ABAP class implementing the behavior |
| Service Definition | Exposes the CDS view as a service |
| Service Binding | Binds to OData V2 or V4 protocol |
| Draft Table | Created for managed scenarios with draft enabled |

## Publish and Test

After generating, the service must be **published** before it can be consumed.

- **Publish**: Click **Publish Service** in the panel, or use `ABAP FS: Publish Service Binding`
- **Test**: Click **Test Service** to open the OData URL in the browser — the extension detects whether the service is published and offers to publish it if not, then builds the correct V2/V4 URL with authentication parameters. Or use `ABAP FS: Test Service Binding`

# ADT Feed Reader

Monitor SAP system events in real-time directly within VS Code — without opening SAP GUI or checking ST22 manually.

## Setup

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: Configure ADT Feeds**
3. Select the system and choose which feeds to subscribe to
4. Open the **Feed Inbox** view in the Activity Bar sidebar

## Supported Feeds

| Feed | Description |
|------|-------------|
| ABAP Runtime Errors | Dumps (equivalent to ST22) |
| ATC Findings | Code quality check results |
| System Messages | Broadcasts sent via SM02 |
| URI Creation Errors | ADT object resolution failures |

> **Note:** Available feeds depend on the SAP system version. Older systems may not support all types.

## Configuration

Each feed can be configured independently per connected system:

- **Polling interval** — how often VS Code checks for new entries (default: 120 seconds; ATC: 24 hours)
- **Notifications** — enable/disable VS Code pop-up alerts for new entries
- **Query filter** — use a built-in template or write a custom OData filter to narrow results

## Working with Entries

- Click an entry to open its details in a WebView panel
- Mark entries as **read** or **unread** to track what you've reviewed
- All feeds appear in a unified **Feed Inbox** — no need to switch between views

## Requirements

The target SAP system must support the ADT Feeds API. Check with your Basis team if feeds are unavailable.

# Dependency Graph Visualizer

Visualize where any ABAP object is used across the system as an interactive, expandable graph.

## Opening the Graph

1. Open an ABAP file in the editor
2. *(Optional)* Place your cursor on a specific method or variable for symbol-level analysis
3. Right-click → **Visualize Dependency Graph**

For graphs with fewer than 100 nodes, the graph renders immediately. For larger graphs, adjust the filters first, then click **Build Graph**.

## Reading the Graph

| Color | Meaning |
|---|---|
| Red | Root object (your starting point) |
| Purple | Nodes you have expanded |
| Other colors | Auto-assigned per object type |

A **double border** on a node means it has more dependencies available to explore.

## Exploring Dependencies

- **Double-click a node** — opens the object in the editor at the exact usage location
- **Right-click a node** — shows a context menu with Open / Expand / Focus options
- **Right-click → Expand Dependencies** — fetches where that object is used and merges results into the graph
- **Hover** — shows object details: type, package, responsible developer, parent class (for methods)

You can expand nodes as many levels deep as needed. Use **Reset to Root** to restore the original graph and clear all expansions.

## Filtering

Use the filter panel to reduce large graphs to what matters:

- **Custom/Standard toggle** — show only Z\*/Y\* objects or only SAP standard objects
- **Object type** — show only CLAS, PROG, FUNC, etc.
- **Name pattern** — wildcards supported (e.g., `Z*MD*`)
- **Usage type** — filter by edge relationship type

Real-time counts show how many objects match each filter. Click **Reset Filters** to clear all.

## Layout Options

| Layout | Best for |
|---|---|
| **Cose** *(default)* | General use — physics-based clustering |
| **Concentric** | Seeing distance from root object |
| **Breadthfirst** | Tree-shaped dependency chains |
| **Circle** | Compact overview |
| **Grid** | Ordered comparison |

## Exporting

Click **Export SVG** to save the current graph as a static image file.

## Requirements

- An ABAP file open in the editor
- An active SAP connection

# ADT Communication Log

Captures and displays every HTTP request and response between VS Code and SAP ADT in real time. Use it to diagnose slow operations, trace connection errors, or understand which ADT APIs the extension calls.

## Start Logging

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: Activate Communication Log**
3. Select the SAP connection to monitor

The **Communication Log** panel opens at the bottom of the screen and immediately begins capturing traffic.

## Stop Logging

Run **ABAP FS: Deactivate Communication Log** from the Command Palette.

> **Note:** The log is held in memory only (up to 2000 entries). Entries are lost when you deactivate logging or close VS Code.

## Reading the Log

Click any entry to expand it and see:

- Query parameters
- Request and response headers
- Request and response bodies (XML and JSON are syntax-highlighted)
- Duration in milliseconds

## Filtering Entries

| Filter | How |
|--------|-----|
| By SAP system | Dropdown — select from all logged connections |
| By HTTP status | Buttons: **Success** (2xx), **Errors** (4xx/5xx), **Pending** |
| By URL | Text search field (200ms debounce) |

## Other Controls

- **Auto-scroll** — Toggle to keep the view pinned to the latest entry
- **Export** — Save all visible entries or a single entry as JSON (useful for bug reports)
- **Clear** — Remove all entries from the current view

## Common Use Cases

- **Slow operations** — Check which API calls take the longest
- **Connection errors** — See the exact HTTP status code and error body returned by SAP
- **Bug reports** — Export the log as JSON and attach it to a GitHub issue
- **Learning the API** — See exactly which ADT endpoints are called for any extension action

# Virtual Tool Grouping Fix

VS Code has an experimental setting (`github.copilot.chat.virtualTools.threshold`) that collapses extension tools into virtual groups when their count exceeds a threshold. When active, Copilot often fails to discover these groups — making all 52 ABAP FS AI tools invisible and unusable.

ABAP FS detects this condition after your first SAP connection and prompts you to fix it.

## When the Prompt Appears

The check runs after you first connect to a SAP system (not at extension activation). It only fires when:

- The virtual tools threshold is greater than `0`
- AI models are available (GitHub Copilot is signed in and active)
- You haven't previously dismissed the prompt

A non-modal notification appears with three options:

| Option | Effect |
|---|---|
| **Disable & Reload** | Sets the threshold to `0` globally and in your workspace, then reloads VS Code |
| **Later** | Skips the prompt this session; asks again on next connection |
| **Don't Ask Again** | Permanently suppresses the prompt |

Choose **Disable & Reload** unless you have a specific reason to keep grouping enabled.

## Fixing It Manually

If you dismissed the prompt and AI tools are still not working:

1. Open Settings (`Ctrl+,`)
2. Search for `virtualTools.threshold`
3. Set `github.copilot.chat.virtualTools.threshold` to `0`
4. Reload VS Code (`Ctrl+Shift+P` → **Developer: Reload Window**)

## Why This Matters

ABAP FS registers 52 specialized tools covering object search, code reading, unit tests, SQL queries, transport management, SAP UI testing, and more. If Copilot cannot see these tools, all AI-powered features stop working. Setting the threshold to `0` disables grouping entirely and keeps all tools available.

> **Note:** This prompt only appears if the experimental grouping feature is active. Most users will never see it.

# Important Considerations

| Feature | Limitation |
|---|---|
| **Create Objects** | Transport request dialogs still appear — object creation is not fully automated. |
| **Text Elements** | Create/Update actions require ADT API support (newer SAP systems only). |
| **Transport Management** | On older systems, some actions fall back to direct table queries. |
| **Code Search** | Searches committed code only — unsaved local changes are not visible. |
| **Mass Activation** | You must select objects from a dialog; activation is not automatic. |

## AI Agent Code Changes

When Copilot edits ABAP code in Agent mode, changes are written to SAP **immediately** — before you accept them. The virtual filesystem locks the object, writes the content, and unlocks it in one step.

- **Keep** — triggers a second save with the accepted content.
- **Undo** — reverts the changes on the server, just like undoing any file edit.

> **Review AI-generated code carefully.** It is live on the SAP server the moment it is written, not only after you click Keep.

# Key Differences: Commands vs Tools

The extension exposes two types of functionality: **commands** you invoke yourself, and **tools** that GitHub Copilot invokes on your behalf.

## Commands — You invoke them

Commands are discrete actions you trigger directly in VS Code.

**How to run a command:**

- Open the Command Palette with `Ctrl+Shift+P` and type `ABAP FS`
- Click a button in the VS Code UI (e.g., editor toolbar, explorer context menu)
- Use a keyboard shortcut

**Examples:**

| Command | What it does |
|---|---|
| `ABAP FS: Create object` | Opens a dialog to create a new ABAP object |
| `ABAP FS: Run ABAP Unit Tests` | Runs unit tests for the current object |
| `ABAP FS: Text Elements Manager` | Opens the text elements editor |

## Language Model Tools — Copilot invokes them

Tools are capabilities the extension exposes to GitHub Copilot. You don't call them directly — instead, you describe what you want in the Copilot chat panel, and Copilot selects and calls the right tool automatically.

**How to use them:**

- Open the Copilot chat panel (`Ctrl+Alt+I`)
- Ask in plain language

**Examples:**

| What you type | Tool Copilot calls |
|---|---|
| "Where is `BAPI_USER_GET_DETAIL` used?" | `find_where_used` |
| "Show me the code for `ZCL_MY_CLASS`" | `get_abap_object_lines` |
| "Run ATC checks on this file" | `run_atc_analysis` |

> **New to VS Code?** Start with commands for direct actions. Use Copilot chat when you want to explore or analyze SAP objects without knowing the exact steps.

# Privacy & Telemetry

**This extension does not send any data to external servers.** Nothing leaves your machine.

## What is collected

A local CSV file records basic usage statistics — which tools and commands you use, and how many lines of code Copilot changed. This file is stored on your machine only and is never uploaded anywhere.

**File location:**
```
<VS Code Global Storage>/extension-path/telemetry-<date>.csv
```

You can delete these files at any time without affecting the extension.

## Central telemetry for organizations

If your organization wants to aggregate telemetry internally, you can fork the public repository, add your own Azure Application Insights connection string, build a custom VSIX, and distribute it. You retain full control over what is collected, where it is stored, and who can access it.

# Organization Administration

To deploy ABAP FS internally, configure the optional features below before building and distributing your own VSIX.

---

## SAP System Whitelist (Optional)

Restrict which SAP systems and users can connect — for example, to block production connections or limit access to approved developers.

### 1. Create the whitelist file

Base it on `client/src/services/whitelist.example.json`:

```json
{
  "version": {
    "minimumExtensionVersion": "1.0.0"
  },
  "allowedDomains": ["*dev*", "*test*", "*qa*"],
  "developers": [
    {
      "manager": "Team_Lead_Name",
      "userIds": ["developer1", "dev1_alt_id"]
    },
    {
      "manager": "Another_Manager",
      "userIds": ["developer2"]
    }
  ]
}
```

**`developers` structure:** Each object represents **one person**. List all of that person's SAP user IDs (across different systems) in the same `userIds` array — they will be treated as the same individual in telemetry. Do not mix different people into one object.

### 2. Host the file

Deploy it to an internal HTTP/HTTPS URL with no authentication required. Users need read access only.

### 3. Configure the URL

Edit `client/src/services/sapSystemValidator.ts`:

```typescript
private readonly WHITELIST_URL = 'https://your-internal-server.com/whitelist.json';
```

### 4. Enable validation

Both flags default to `true` (whitelist is skipped). Set to `false` to enforce restrictions:

```typescript
private readonly ALLOW_ALL_SYSTEMS = true;  // false = validate against allowedDomains
private readonly ALLOW_ALL_USERS = true;    // false = validate against developers.userIds
```

### How it works

- The extension fetches the whitelist on startup and every 2 hours.
- `allowedDomains` patterns use wildcards (e.g., `*dev*`) matched against the SAP system hostname.
- `userIds` are checked across all developer entries. Both system and user must pass for a connection to succeed.
- If the fetch fails, a hardcoded backup whitelist is used.
- On corporate VPN, the extension retries for up to 10 minutes after startup; a status bar notification is shown during retries.

---

## Telemetry with Application Insights (Optional)

**The VS Code Marketplace version sends no telemetry anywhere.** All usage data is written to local CSV files only (`telemetry-YYYY-MM-DD.csv` in extension storage). Nothing leaves the machine.

This section applies only if you want **central analytics** for your organization.

### What is collected

Each event is an action string (e.g., `command_activate_called`, `tool_search_abap_objects_called`) plus:

| Field | Description |
|---|---|
| Anonymous user ID | SHA hash of `hostname + username + platform` — cannot be reversed |
| Session ID | Random ID per VS Code session |
| Extension version | Version number |
| VS Code version | VS Code version number |
| Platform | Windows / Linux / Mac |
| SAP system | System accessed (if applicable) |
| Manager / Team | From whitelist `developers` mapping (if configured) |

**Not collected:** credentials, source code, object names, business data, error messages, performance metrics, HTTP requests, dependencies, or console logs. All Application Insights auto-collection features are disabled by default.

### Setup steps

1. **Fork the repository** on GitHub.

2. **Create an Azure Application Insights resource** in your Azure subscription.

3. **Copy the connection string** from Azure Portal → Application Insights → Overview → Connection String.

4. **Set the connection string** in `client/src/services/appInsightsService.ts`:

   ```typescript
   const connectionString = "InstrumentationKey=YOUR-KEY;IngestionEndpoint=https://..."
   ```

5. **Build and distribute** your VSIX (see [Building and Distributing](#building-and-distributing) below).

### Enabling additional auto-collection

All auto-collection is off by default. To enable any of the following, edit the `initialize()` method in `client/src/services/appInsightsService.ts`:

| Feature | Change |
|---|---|
| Exception tracking | `.setAutoCollectExceptions(false)` → `(true)` |
| Performance metrics (CPU/memory) | `.setAutoCollectPerformance(false, false)` → `(true, true)` |
| HTTP request tracking | `.setAutoCollectRequests(false)` → `(true)` |
| Dependency tracking | `.setAutoCollectDependencies(false)` → `(true)` |

You can also add custom tracking anywhere in your code:

```typescript
appInsights.defaultClient.trackEvent({ name: 'my_event' });
appInsights.defaultClient.trackException({ exception: error });
appInsights.defaultClient.trackMetric({ name: 'my_metric', value: 42 });
```

### Telemetry + whitelist integration

When the whitelist `developers` structure is configured, telemetry automatically groups multiple SAP user IDs belonging to the same person. The `manager` field enables team-level analytics (e.g., "which team uses debugging most?") while keeping individual users anonymous.

### How events are stored and sent

- Events are logged to local CSV files first.
- If an App Insights connection string is configured, events are also sent to Azure (batched every 30 seconds).
- If the network is unavailable, events are stored locally and retried.
- Local storage flushes every 5 minutes or when the buffer reaches 25 entries.

---

## Building and Distributing

After completing configuration above:

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Build and package:**

   ```bash
   # Windows (recommended)
   build-and-install.bat

   # Or manually:
   npm run compile
   npx vsce package
   ```

3. **Distribute** the generated `.vsix` file to your users. They can install it via Extensions → `...` → **Install from VSIX...**
