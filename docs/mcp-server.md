# MCP Server for External AI Tools

> **Prerequisites:** Complete the [Installation Steps](getting-started/installation.md) first. You need VS Code with ABAP FS installed and configured with at least one SAP system connection.

> **Note:** ABAP FS has 40+ AI tools. When using GitHub Copilot in VS Code, all tools are available natively once a SAP system is connected — no MCP server needed. The MCP server is only for external AI clients.

## What Is This and Why Would You Need It?

**MCP (Model Context Protocol)** is an open standard that lets AI tools call external services. ABAP FS exposes its 39 SAP tools (search, read code, run tests, query data, etc.) via a local MCP server so that AI assistants outside of VS Code can use them.

> **Warning:** MCP access is read-only. See [Limitations](#limitations) for details.

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

## Limitations

- **VS Code must stay open** — the server runs inside VS Code
- **Active SAP connection required** — tools need a connected system
- **Read-oriented** — external AI tools cannot write to the `adt://` virtual filesystem; the AI can suggest edits but you must apply them manually in VS Code
- **Webview outputs appear in VS Code** — results from tools like data queries or Mermaid diagrams open as VS Code panels, not in the external tool
- **No ABAP syntax checking** — ABAP code is treated as plain text in external tools
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
