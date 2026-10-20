# Agent Chat Settings Reference

All settings are in VS Code Settings (`Ctrl+,`). Search for `abapfs.acp`.

## Agent Chat settings

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `abapfs.acp.enabled` | `false` | Turns Agent Chat on. When off, the panel is hidden and no agent runs. Turning it off stops running agents. |
| `abapfs.acp.agents` | `{}` | The agents you can connect to, keyed by display name. Each entry has `command` (required), `args` and `env`. **Add Agent** fills this in for you. See [Setup](setup.md#editing-agents-in-settingsjson). |
| `abapfs.acp.provideMcpServer` | `false` | Hands the ABAP FS MCP server, and with it all ABAP FS tools, to every agent session, starting the server when needed. See [ABAP FS Tools for Agents](mcp.md). |
| `abapfs.acp.autoApprovePermissions` | `ask` | `ask`: every permission request from the agent shows a picker. `allowAll`: allows everything automatically. |
| `abapfs.acp.defaultWorkingDirectory` | `""` | Local folder the agent process starts in, also used for its terminal commands. When empty, it's the first local (non-SAP) workspace folder, or a private ABAP FS folder if the workspace only has SAP systems. Other local workspace folders are offered as additional directories when the agent supports ACP multi-root sessions. SAP folders remain virtual and are provided through the ABAP FS context and tools. |
| `abapfs.acp.logTraffic` | `false` | Logs every ACP message to the **ABAP FS Agents Traffic** output channel. Useful for troubleshooting; it includes prompts and file contents. |

## Related settings

| Setting | Default | What it does for Agent Chat |
| ------- | ------- | --------------------------- |
| `abapfs.editReview.enabled` | `false` | Keep / Undo review in VS Code for ABAP edits made through `replace_string_in_abap_object` or by the agent's own file edit tools. See [Reviewing edits](using.md#reviewing-edits-keep--undo). |
| `abapfs.mcpServer.port` | `4847` | Port of the ABAP FS MCP server that agents use. |
| `abapfs.mcpServer.apiKey` | `""` | Optional key for the MCP server. With `provideMcpServer` on, ABAP FS passes it to the agent automatically. |
| `abapfs.mcpServer.exposeEditTool` | `true` | Offers the `replace_string_in_abap_object` edit tool to agents and MCP clients. Turn off for read-only ABAP FS tools; agents can still edit with their own file tools. Applies to new sessions. |
| `abapfs.mcpServer.autoStart` | `false` | Starts the MCP server when VS Code starts. It's not needed for Agent Chat with `provideMcpServer` on, because the server is started when an agent connects. |

## Where settings are stored

- Agents added with **Add Agent** go to your **user** settings, unless `abapfs.acp.agents` is already set in the workspace; then they go to the workspace.
- `abapfs.acp.agents` replaces as a whole: an entry in workspace settings hides all agents from user settings. Keep your agents in one place.
- Conversation labels for history are stored per workspace.

## Example

```json
{
  "abapfs.acp.enabled": true,
  "abapfs.acp.provideMcpServer": true,
  "abapfs.editReview.enabled": true,
  "abapfs.acp.autoApprovePermissions": "ask",
  "abapfs.acp.agents": {
    "Claude Code": {
      "command": "npx",
      "args": ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      "env": {}
    }
  }
}
```
