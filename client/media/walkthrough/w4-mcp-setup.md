### MCP Server Setup

**Ctrl+,** → Workspace tab → search `abapfs.mcpServer`

1. Enable `autoStart`, set port (default: 4847)
2. In your AI client config:
```json
{
  "mcpServers": {
    "abap-fs": { "url": "http://localhost:4847/mcp" }
  }
}
```

**Works with:** Cursor, Claude Desktop, Claude Code, Windsurf. Same tools as Copilot.

**Security:** Set `abapfs.mcpServer.apiKey` for authenticated access.
