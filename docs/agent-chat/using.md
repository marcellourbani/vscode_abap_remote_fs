# Using Agent Chat

## The panel

| Element | What it does |
| ------- | ------------ |
| **Prompt box** | Type your request; `Enter` sends it. Typing `/` shows the slash commands the agent offers, if any. |
| **Add Context...** (paperclip) | Attach files to the next prompt |
| **Mode picker** | Switch the agent's mode (for example plan / code), when the agent has modes |
| **Model picker** | Switch the agent's model, when the agent lets the client choose |
| **Send / Stop** | Send the prompt, or stop the running turn |
| **Title bar: New Chat** (`+`) | Start a fresh conversation with the same agent |
| **Title bar: Show Chats...** (history) | Reopen a previous conversation (only while connected) |
| **Title bar: Attach File / Cancel Turn / Disconnect** | Same as the commands of the same name |
| **Title bar `...` menu** | Connect, Add / Remove / Manage Agents, Restart, Show Log, Show Protocol Traffic |

All commands are also in the Command Palette under **ABAP FS Agents**.

The agent's replies stream in as they arrive. Tool calls, plans and sub-agent activity are shown inline. Some agents also show extra session options, such as on/off switches.

## Giving the agent context

- **Current file:** the file in the active editor shows as a faded chip above the prompt. Click it to attach it.
- **Selection:** when you select lines in an editor, the selection is attached to your next prompt automatically, like in Copilot Chat. The chip shows the file and line range, for example `ZCL_DEMO.clas.abap:12-30`. Click `x` to drop it. After you send, it is detached, so the next prompt doesn't carry it again unless you select something new.
- **Files:** use **Add Context...** or **Attach File** to add up to 10 files. Small files are sent inline when the agent supports it, otherwise as a reference to read.

Attached SAP objects are passed as paths the agent can read through ABAP FS. You can also just name the object, for example "explain ZCL_DEMO's method GET_DATA", and the agent will find it with the ABAP FS tools.

## Conversation history

**Show Chats...** lists the agent's previous conversations, newest first, with a readable label (your first prompt) instead of an ID. Choose one to reopen it:

- If the agent can **load** sessions, the conversation is replayed into the panel.
- If it can only **resume**, the agent continues with its context, but earlier messages may not be shown again.
- If it supports neither, the history button shows nothing to reopen.

History is only offered while an agent is connected, and only for that agent. Conversations without any prompt are hidden.

**New Chat** starts a new conversation with the connected agent. The old one stays in history.

## Permissions

Agents ask before running tools that change things, for example a shell command. A picker appears with the agent's options, such as _Allow once_, _Always allow_ and _Reject_. Pressing `Esc` cancels the request.

To approve everything without asking, set `abapfs.acp.autoApprovePermissions` to `allowAll`. Only do this when you trust the agent with your SAP access and your machine.

## Terminal commands

ABAP FS lets agents run shell commands. They run in the agent's working directory (see [`abapfs.acp.defaultWorkingDirectory`](settings.md)), and their output is returned to the agent. SAP folders are virtual, so shell commands can't see them.

## Editing ABAP code

Ask for the change in plain words, for example:

> _In ZCL_DEMO, make GET_DATA return an empty table when the key is initial. Then check syntax and activate._

A typical agent flow with the ABAP FS tools is:

1. Locate the object (`abapfs_search_objects`, `abapfs_get_workspace_uri`).
2. Read the source (`abapfs_get_object_source`).
3. Edit with `replace_string_in_abap_object`. This saves an **inactive** version to SAP. ABAP FS handles the lock, and the transport request is the one you approve, either an existing one or a new one.
4. Check syntax (`get_abap_diagnostics`) and activate (`abapfs_activate_object`).

> Agents' own "edit file" tools often fail on SAP objects with "file does not exist", because they check the local disk first. If that happens, tell the agent to use `replace_string_in_abap_object`.

### Reviewing edits (Keep / Undo)

With `abapfs.editReview.enabled` on, these ABAP edits can be reviewed in VS Code: every edit made through `replace_string_in_abap_object` (by Agent Chat, Copilot or any MCP client), and every edit an Agent Chat agent makes with its own file edit tools.

- The edited object opens, with added and changed lines highlighted.
- A **Keep | Undo | Show Changes** line appears above the first change, and the same actions are in the editor title bar.
- **Keep** accepts the edits and removes the highlights.
- **Undo** writes the source from before the agent's first pending edit back to SAP, as an inactive version. If you changed the file yourself since then, you are asked first.
- **Show Changes** opens a diff between the original and the current source.

Review is per file. Several edits to the same object are combined into one review, and edits to different objects are tracked separately, even when the agent makes them in parallel.

Edits are in SAP as soon as they are made. Review only decides whether you keep them; it doesn't hold them back.

## Switching agents and restarting

- **Connect** while another agent is connected asks whether to switch. Switching disconnects the current agent and clears the panel.
- **Restart** stops and restarts the current agent, for example after changing its settings or logging in again.
- **Disconnect** stops the agent process. The conversation stays in that agent's history.
