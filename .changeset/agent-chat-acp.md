---
"vscode-abap-remote-fs": minor
---

Add Agent Chat (experimental): a chat panel that connects to external coding agents such as Claude Code, Codex, Gemini CLI or the GitHub Copilot CLI over the Agent Client Protocol (ACP). SAP objects show up to the agent as virtual folders served by ABAP FS, and the agent can also use the ABAP FS MCP server tools over HTTP or a stdio bridge. The panel supports agent presets, conversation history, modes, model selection, file attachments, permission and elicitation prompts, terminals, protocol traffic logging and Max the chat pet. Configure it with the `abapfs.acp.*` settings; new Agent Chat docs are included.

Make `replace_string_in_abap_object` a regular ABAP FS LM tool, so Copilot and every MCP client can use it. Writes to the same object now run one at a time. The new `abapfs.mcpServer.exposeEditTool` setting controls whether MCP clients get the edit tool. Add an optional Keep/Undo/Show Diff review for edits made with the tool (`abapfs.editReview.enabled`).

Add filtering by source and severity and paged results to `get_abap_diagnostics` (#630).

Add `abapfs.unitTests.noAutoActivate`. When it is on, the unit test tool skips auto-activation and refuses to run tests if the object or its owning class has inactive changes (#632).

Fix object creation and transport selection when SAP rejects the generic `application/*` content type or the transport info check fails: object creation now sends the specific content type, and if the transport check fails you are asked for a transport (or the save is treated as local for `$TMP`) instead of getting an error. If a transport is already known, it is reused (#293).
