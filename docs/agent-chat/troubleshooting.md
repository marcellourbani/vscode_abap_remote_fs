# Agent Chat Troubleshooting

Start with the logs. Both are in the panel's `...` menu:

- **Show Log** (**ABAP FS Agents** output channel): agent start, connection, file requests and MCP hand-over, plus the agent's own error output.
- **Show Protocol Traffic** (**ABAP FS Agents Traffic**): every ACP message, after you turn on `abapfs.acp.logTraffic`. It contains prompts and file contents, so be careful when sharing it.

## The panel doesn't appear

- Check that `abapfs.acp.enabled` is on. It's on by default, so look for a user or workspace setting that turned it off.
- Look in the secondary side bar (right side). If it's closed, use **View → Appearance → Secondary Side Bar**, or run **ABAP FS Agents: Open Chat**.

## Agent fails to connect

**"Failed to connect" right away, or the agent exits immediately**

- Run the agent's command in a terminal, for example `npx -y @agentclientprotocol/claude-agent-acp@latest`. A working ACP agent starts and then waits silently for input; stop it with `Ctrl+C`. Any error you see there is the real problem.
- `npx` not found: install Node.js, then restart VS Code so it picks up the new `PATH`.
- Network or registry errors from npm: configure npm for your proxy or internal registry, or install the agent globally and use its command instead of `npx`.

**Connecting takes very long the first time**

The first start of a built-in agent downloads it from npm. Later starts are faster.

**The agent connects but every prompt fails with an authentication error**

The agent isn't logged in to its AI provider. Log in the way that agent expects, for example by running the agent's CLI once in a terminal, or set its API key in the agent's `env` in `abapfs.acp.agents`. Then use **Restart**.

**It worked before, now it doesn't**

With `@latest`, a new agent version may have changed its command-line flags. Check the agent's release notes, or pin a known-good version in `abapfs.acp.agents`.

## Agent doesn't see ABAP FS tools

1. **Is `abapfs.acp.provideMcpServer` on?** It's off by default. Turn it on, then start a **New Chat**: the tools are passed when a session is created.
2. **Did the MCP server start?** Show Log should contain `Passing ABAP FS MCP server to agent over HTTP` or `... through the stdio bridge`. If it says `ABAP FS MCP server is not running; continuing without it`, run **ABAP FS: Start MCP Server** and look at the **ABAP FS** output channel. The usual cause is that port `4847` is already in use; change `abapfs.mcpServer.port`.
3. **Is a SAP system connected?** Connect with `ABAP FS: Connect to an ABAP system` before starting the agent.
4. **Does the agent ignore client-provided MCP servers?** Some agents accept the `mcpServers` list from the client and then don't use it. If the log shows the server was passed but the agent still has no `abapfs_*` tools, add ABAP FS to the agent's own MCP config instead, and turn `provideMcpServer` off. See [Manual setup](mcp.md#manual-add-abap-fs-to-the-agents-config).
5. **Stdio bridge errors:** the agent starts the bridge itself, so its messages, which start with `abap-fs mcp bridge:`, end up wherever that agent logs its MCP servers. `401` means the API key doesn't match `abapfs.mcpServer.apiKey`, and `ECONNREFUSED` means the MCP server isn't running.

## The agent sees every tool twice

ABAP FS is configured both through `provideMcpServer` and in the agent's own MCP config. Remove one of them.

## Edits fail with "file does not exist"

The agent used its built-in edit tool, which checks the local disk. SAP objects only exist virtually, so that check fails. Tell the agent to use `replace_string_in_abap_object`, or add that to your agent's instructions file (for example `CLAUDE.md` or `AGENTS.md` in the working directory).

## Shell commands, grep or glob find no SAP objects

Expected: SAP systems are not on disk. Ask the agent to use `abapfs_search_objects` and `abapfs_search_object_source` instead.

## Edits don't show Keep / Undo

- Check that `abapfs.editReview.enabled` is on.
- Only ABAP objects are tracked, not local files.
- Edits are tracked when they go through `replace_string_in_abap_object` or the agent's own file tools in Agent Chat. Edits an external MCP client makes with its own tools outside ABAP FS can't be seen.

## History is empty or a chat can't be reopened

- History is shown only while an agent is connected, and only that agent's conversations.
- The agent has to support listing sessions. Reopening needs load or resume support. Some agents keep history only for the same working directory, so keep `abapfs.acp.defaultWorkingDirectory` stable.

## Permission prompts keep appearing

Choose the agent's _Always allow_ option where it offers one, or set `abapfs.acp.autoApprovePermissions` to `allowAll`. That approves everything, including shell commands.

## Reporting a problem

Include the **ABAP FS Agents** log, the agent name and version, and your VS Code and ABAP FS versions. Remove system names, users and any other sensitive data first.
