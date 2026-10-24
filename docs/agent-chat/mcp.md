# ABAP FS Tools for Agents (MCP)

Agents get the ABAP FS tools (search, read, edit, activate, unit tests, ATC, SQL, transports, debugging and more) through the ABAP FS [MCP server](../mcp-server.md). There are two ways to set this up:

| | Automatic: `abapfs.acp.provideMcpServer` | Manual: in the agent's own config |
| --- | --- | --- |
| Setup | One setting in VS Code | Edit the agent's MCP config file |
| Works for | Agents that accept MCP servers from the client (most do) | Every MCP-capable agent |
| Tools available | Only in Agent Chat sessions | Also when you use the agent outside VS Code (VS Code must still be open) |
| Server start | Started automatically when an agent connects | Start it yourself, or set `abapfs.mcpServer.autoStart` |

Use **one** of them per agent. With both, the agent sees every tool twice.

## Automatic: provideMcpServer

```json
{
  "abapfs.acp.provideMcpServer": true
}
```

When a session is created, loaded or resumed, ABAP FS:

1. Starts the MCP server on `abapfs.mcpServer.port` (default `4847`) if it isn't running.
2. Adds a server named `abap-fs` to the session's `mcpServers`, using one of two transports:

### Over HTTP

If the agent says during the ACP handshake that it accepts HTTP MCP servers (`mcpCapabilities.http`), it gets the URL directly:

```text
http://localhost:4847/mcp
```

With `abapfs.mcpServer.apiKey` set, the matching `Authorization: Bearer <key>` header is sent along.

### Over stdio (bridge)

ACP only guarantees stdio MCP servers, so agents that don't announce HTTP support get a small **stdio bridge** instead. It's bundled with ABAP FS and runs on VS Code's own Node.js runtime, so nothing extra needs to be installed. The agent starts it like any local MCP server; the bridge relays every message to the HTTP server and passes on the API key if one is set.

The **ABAP FS Agents** output channel shows which transport was used:

- `Passing ABAP FS MCP server to agent over HTTP: ...`
- `Agent did not advertise mcpCapabilities.http over ACP; passing ABAP FS MCP through the stdio bridge to ...`

## Manual: add ABAP FS to the agent's config

Use this when the agent ignores MCP servers sent by the client (some do), or when you also want the tools outside Agent Chat. Turn `abapfs.acp.provideMcpServer` **off** for that agent's sessions to avoid duplicate tools.

**1. Start the MCP server:** run **ABAP FS: Start MCP Server**. This also turns on `abapfs.mcpServer.autoStart` for this workspace. The notification shows the URL; the default is `http://localhost:4847/mcp`.

**2. Add it to the agent.** Check your agent's documentation for the exact format. Common examples:

**Claude Code:**

```bash
claude mcp add --transport http abap-fs http://localhost:4847/mcp
```

With an API key:

```bash
claude mcp add --transport http abap-fs http://localhost:4847/mcp --header "Authorization: Bearer your-secret-key"
```

**Gemini CLI**, in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "abap-fs": {
      "httpUrl": "http://localhost:4847/mcp"
    }
  }
}
```

**Agents that take a URL**, for example in an `mcpServers` / `mcp.json` file:

```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp",
      "headers": { "Authorization": "Bearer your-secret-key" }
    }
  }
}
```

Leave out `headers` when no API key is set.

**Agents that only support stdio MCP servers:** run the bundled bridge with Node.js. For example, in Codex's `~/.codex/config.toml`:

```toml
[mcp_servers.abap-fs]
command = "node"
args = ["<extension folder>/client/dist/mcpStdioBridge.js", "http://localhost:4847/mcp"]
env = { ABAPFS_MCP_TOKEN = "your-secret-key" }
```

- `<extension folder>` is the installed ABAP FS extension, for example `~/.vscode/extensions/murbani.vscode-abap-remote-fs-<version>`. The folder name changes with every extension update, so update the path after updating ABAP FS.
- `ABAPFS_MCP_TOKEN` is only needed when `abapfs.mcpServer.apiKey` is set.
- Any Node.js 18 or later works.

**3. Restart the agent** in Agent Chat (**Restart** in the panel's `...` menu) so it reads its new config.

## Which tools are there

The same tools GitHub Copilot gets in VS Code. See [MCP Server - Available Tools](../mcp-server.md#available-tools). The most important ones for agents:

| Tool | Use |
| ---- | --- |
| `abapfs_search_objects` | Find objects by name pattern |
| `abapfs_get_workspace_uri` | Get the `adt://` URI of an object for editing |
| `abapfs_get_object_source` | Read source code |
| `replace_string_in_abap_object` | Edit ABAP source (find and replace), saved as inactive |
| `get_abap_diagnostics` | Syntax check after an edit |
| `abapfs_activate_object` | Activate edited objects |
| `abapfs_run_unit_tests` | Run ABAP unit tests |

Tools need a connected SAP system, so connect before you start the agent.
