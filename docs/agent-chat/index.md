# Agent Chat (ACP)

> ⚠️ **EXPERIMENTAL FEATURE** - On by default; turn it off with `abapfs.acp.enabled`. Please report any issues.

**Agent Chat** lets you use external coding agents such as Claude Code, Codex, Gemini CLI or GitHub Copilot's CLI agent from a chat panel inside VS Code, working on your SAP systems through ABAP FS.

It uses the [Agent Client Protocol (ACP)](https://agentclientprotocol.com), an open standard for connecting editors to coding agents. ABAP FS is the ACP _client_: it starts the agent as a local process, shows its conversation, answers its file and terminal requests, and hands it the ABAP FS tools.

**Use this if** you prefer another agent over GitHub Copilot, but want to work inside VS Code with live SAP access, instead of switching to a separate terminal or app.

**Don't need this if** you only use GitHub Copilot Chat. All ABAP FS tools are already available there natively.

## Pages in this guide

| Page | What it covers |
| ---- | -------------- |
| [Setup](setup.md) | Enable the feature, add an agent, connect |
| [Using Agent Chat](using.md) | The panel, context, history, modes, permissions, edit review |
| [Settings Reference](settings.md) | Every `abapfs.acp.*` setting and related settings |
| [ABAP FS Tools for Agents (MCP)](mcp.md) | How agents get the ABAP FS tools, HTTP vs stdio, manual setup |
| [Troubleshooting](troubleshooting.md) | What to check when something doesn't work |

## How it works

```text
┌──────────────── VS Code ────────────────┐
│                                         │        stdin/stdout (ACP)       ┌──────────────┐
│  Agent Chat panel ◄──► ABAP FS ACP client ◄──────────────────────────────► │ Agent process│
│                          │      │       │                                 │ (Claude Code,│
│                          │      │       │      MCP (HTTP or stdio bridge) │  Codex, ...) │
│                          │   ABAP FS MCP server ◄─────────────────────────┤              │
│                          │      │       │                                 └──────┬───────┘
│                    ABAP FS file system  │                                        │
│                    + 40 SAP tools       │                                        ▼
│                          │              │                                  Agent's own AI
└──────────────────────────┼──────────────┘                                  provider
                           ▼
                       SAP system
```

1. **The agent runs locally.** When you connect, ABAP FS starts the agent's command (for example `npx -y @agentclientprotocol/claude-agent-acp@latest`) as a child process and talks ACP to it over stdin/stdout. Closing the panel's connection or VS Code stops the process.
2. **Your prompt goes to the agent.** The agent sends it to its own AI provider with its own login or API key. ABAP FS does not see or choose the model; it only shows what the agent reports.
3. **The agent reads files through ABAP FS.** ABAP FS announces that it can read and write files and run terminals. When the agent reads a file, the request comes back to VS Code, so it gets the live SAP source, including unsaved changes in open editors.
4. **The agent uses the ABAP FS tools.** With [`abapfs.acp.provideMcpServer`](mcp.md) on, ABAP FS gives the agent its MCP server for each session, with the same tools Copilot has: search objects, read source, edit, activate, run unit tests, query tables, and more.
5. **Edits go to SAP.** ABAP source edits are saved to SAP immediately as inactive versions, with locking and transport handling done by ABAP FS. Turn on [edit review](using.md#reviewing-edits-keep--undo) to see and undo them.

## How SAP objects appear to the agent

Agents only understand local file paths. ABAP FS maps every `adt://<system>/<path>` resource to a path under a private folder of the extension (`.../acp-workspace/adt/<system>/<path>`). Requests for those paths are routed to the ABAP FS file system; **nothing is stored on your disk**.

With its first prompt, the agent gets a short note explaining this, listing the connected systems and their folders, and telling it to use the ABAP FS tools to find and edit objects.

Because the folders are virtual:

- The agent's shell commands, `grep`, `glob` and "does this file exist" checks do not see SAP objects.
- Agents' built-in edit tools often check the local disk before editing, and then fail with "file does not exist". The `replace_string_in_abap_object` tool works for every agent, so ABAP edits should go through it. See [ABAP FS Tools for Agents](mcp.md).
- Local files in your workspace work normally.

## Limitations

- **VS Code must stay open.** The agent, the MCP server and the SAP connection all live in VS Code.
- **One active conversation at a time** in the panel. You can switch between past conversations from history.
- **Agent features vary.** History, modes, model selection, slash commands and images only appear when the agent supports them.
- **Edits are not in Copilot's "changed files" list.** Use [edit review](using.md#reviewing-edits-keep--undo) instead.
