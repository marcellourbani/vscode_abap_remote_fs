# Agent Chat Setup

> **Prerequisites:** Complete the [Installation Steps](../getting-started/installation.md) first and connect to at least one SAP system (`ABAP FS: Connect to an ABAP system`).

## 1. Enable Agent Chat

Open Settings (`Ctrl+,`), search for `abapfs.acp.enabled` and tick it, or add to `settings.json`:

```json
{
  "abapfs.acp.enabled": true
}
```

The **ABAP FS - Agent Chat** view appears in the secondary side bar (the right-hand side, next to Copilot Chat) and opens automatically. Unticking the setting stops all agents and hides the panel again.

## 2. Turn on the ABAP FS tools for agents (recommended)

```json
{
  "abapfs.acp.provideMcpServer": true
}
```

With this on, every agent session gets the ABAP FS tools, and ABAP FS starts its MCP server when needed. Without it, the agent can only read files and can't search, edit, activate or test ABAP objects, unless you add the MCP server in the agent's own configuration.

> If GitHub Copilot is installed, the first start of the MCP server asks whether you still need it. Choose to start it: Agent Chat needs it.

Details and alternatives: [ABAP FS Tools for Agents (MCP)](mcp.md).

## 3. Add an agent

Click **Connect** in the panel, or run **ABAP FS Agents: Add Agent** from the panel's `...` menu or the Command Palette. A list of built-in agents opens:

| Agent | Command that is run |
| ----- | ------------------- |
| Claude Code | `npx -y @agentclientprotocol/claude-agent-acp@latest` |
| GitHub Copilot | `npx -y @github/copilot-language-server@latest --acp` |
| Codex CLI | `npx -y @zed-industries/codex-acp@latest` |
| Gemini CLI | `npx -y @google/gemini-cli@latest --experimental-acp` |
| Qwen Code | `npx -y @qwen-code/qwen-code@latest --acp --experimental-skills` |
| Auggie CLI | `npx -y @augmentcode/auggie@latest --acp` |
| Qoder CLI | `npx -y @qoder-ai/qodercli@latest --acp` |
| OpenCode | `npx -y opencode-ai@latest acp` |

Pick one and it is saved to your user settings. Agents you already added are not listed again.

**Built-in agents need:**

- **Node.js with `npx` on your `PATH`.** The first connect downloads the agent from npm, so it takes a while. Later connects use npm's cache, but `@latest` checks for a newer version each time.
- **Access to the npm registry.** Behind a corporate proxy, npm must be configured for it (`npm config get registry`, `npm config get proxy`).
- **The agent's own login.** For example, Claude Code needs a Claude login or `ANTHROPIC_API_KEY`, and Codex needs an OpenAI login or API key. Follow the agent's own documentation. ABAP FS does not handle these credentials.

### Custom agents

Choose **Custom agent...** in the list to enter:

1. A display name, for example `My Agent`.
2. The command line that starts it in ACP mode, for example `my-agent --acp`. Quotes are honoured for arguments with spaces.
3. Optional environment variables as `NAME=value`, separated by `;`.

Any agent that speaks ACP over stdio works. The [ACP website](https://agentclientprotocol.com) lists known agents and adapters.

### Editing agents in settings.json

Agents are stored in `abapfs.acp.agents`, keyed by display name:

```json
{
  "abapfs.acp.agents": {
    "Claude Code": {
      "command": "npx",
      "args": ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      "env": {}
    },
    "My Agent": {
      "command": "my-agent",
      "args": ["--acp"],
      "env": { "MY_AGENT_LOG_LEVEL": "debug" }
    }
  }
}
```

When the value is empty, autocomplete in `settings.json` offers each built-in agent as a snippet. **ABAP FS Agents: Manage Agents (Settings)** opens the setting, and **Remove Agent** deletes one.

> To pin a version instead of `@latest`, edit the entry, for example `@agentclientprotocol/claude-agent-acp@1.2.3`. If the agent is installed globally, you can use its command directly instead of `npx`.

## 4. Connect

Click **Connect** (plug icon) in the panel. With a single agent configured, it connects straight away; with several, you pick one. A notification shows progress while the agent starts.

Once connected, the panel shows the agent's name, and its modes and models if it has any. Type a prompt and press `Enter`.

## 5. Check that the tools arrived

Ask the agent:

> _List the ABAP FS tools you have._

or something SAP-specific:

> _Search for classes starting with ZCL_DEMO._

If the agent says it has no `abapfs_*` tools, see [Agent doesn't see ABAP FS tools](troubleshooting.md#agent-doesnt-see-abap-fs-tools).

## Optional: review edits

To see and undo the agent's ABAP edits in VS Code:

```json
{
  "abapfs.editReview.enabled": true
}
```

See [Reviewing edits](using.md#reviewing-edits-keep--undo).
