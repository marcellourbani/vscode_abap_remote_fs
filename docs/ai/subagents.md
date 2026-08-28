# AI Subagents for Optimized ABAP Development

AI Subagents are specialized AI assistants, each focused on one type of ABAP task (finding objects, reading code, running analysis, etc.). Instead of one general AI doing everything, subagents split work across focused specialists.

**Why this matters:**

- **Better results** — a dedicated code reviewer catches more issues than a general assistant juggling multiple goals
- **Longer conversations** — heavy operations run in separate context windows, so your main chat stays responsive
- **Lower cost** — simple tasks (search, read) use cheaper/faster models; complex tasks use smarter ones

## Available Subagents

ABAP FS provides one unified subagent system with **22 packaged agents**:

- **13 general ABAP agents**, individually configurable and individually enabled.
- **9 SAP testing agents**, available together when the SAP testing folder is ready.

The prompts are packaged with the extension under `client/media/agents`. ABAP FS does not create, rename, disable, or delete `.github/agents` files in your workspace.

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

In GitHub Copilot Chat, type `@abap-orchestrator` to start, or invoke any enabled general agent directly. The orchestrator can call other enabled agents automatically as needed.

```
@abap-orchestrator analyze ZCL_ARTICLE_HANDLER and suggest improvements
```

For example, the orchestrator might:

1. Delegate "find related classes" → `abap-discoverer` (cheap, fast)
2. Delegate "read the code" → `abap-reader` (cheap, fast)
3. Delegate "usage analysis" → `abap-usage-analyzer` (mid-tier)
4. Synthesize findings and write recommendations itself (premium)

You can also invoke other enabled general agents directly with `@agent-name`. Disabled general agents are removed from agent discovery immediately. Testing agents appear only when the SAP testing folder is valid.

## Setup

Subagent settings are stored at **user level**. Model assignments use `abapfs.subagents.models`; general-agent visibility uses `abapfs.subagents.enabledAgents`. The deprecated `abapfs.subagents.enabled` setting is migrated for compatibility.

In normal usage, do not edit settings JSON manually. Use **ABAP FS: Set Models for Subagents** or the `abapfs_manage_subagents` tool.

### Step 1 — Configure models

Use **ABAP FS: Set Models for Subagents**, or ask Copilot to do it by calling `abapfs_manage_subagents` with `get_status`, `list_models`, and then `configure`.

```
Configure models for the general ABAP agents
```

Use the exact model names returned by `list_models`. The tier guidance is:

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

General agents are enabled individually. You can pass selected `agentIds`, or omit them to enable all 13. Every agent being enabled must have an available model.

### Step 3 — Use the enabled agents

No extra ABAP FS delegation setting or workspace agent files are required. Once a general agent is enabled and has an available model, Copilot can invoke it immediately.

## Managing Subagents

All management is done through Copilot chat:

| What you want | What to ask |
|---------------|-------------|
| Check current status and guidance | `abapfs_manage_subagents` → `get_status` |
| See available models | `abapfs_manage_subagents` → `list_models` |
| Enable or disable selected general agents | `abapfs_manage_subagents` → `enable` or `disable` with `agentIds` |
| Enable or disable all general agents | Omit `agentIds` |
| Change selected models | `abapfs_manage_subagents` → `configure` |
| Validate active assignments | `abapfs_manage_subagents` → `validate` |
| See available tools | `abapfs_manage_subagents` → `list_tools` |

Enable/disable changes take effect immediately. Model changes also take effect immediately; no VS Code reload is required. After an extension update, startup reconciliation reapplies user-level models to the new packaged agent files automatically.

## Agent Ownership

Agent prompts, tool assignments, tiers, and descriptions are packaged and owned by ABAP FS. User control is provided through model assignments and per-general-agent enablement, not by editing workspace agent files.

## What to Be Aware Of

⚠️ **Model Availability**: Some models shown in the list may not work (e.g., "GPT-4o mini"). The system validates and auto-disables if errors are detected.

⚠️ **User-Level Settings**: Model assignments and general-agent visibility apply across workspaces for the user.

⚠️ **Frequently-Used Agents**: Agents like `abap-discoverer` and `abap-reader` get called often - using expensive models for these defeats the cost benefit

## Troubleshooting

### "Cannot enable subagents - missing models"
Every general agent in the requested `agentIds` must have an available model. Enabling all 13 requires all 13 general models. Testing agents are a separate all-or-nothing group when the testing folder is ready.

### Agent models are not taking effect
Run `get_status` to confirm the user-level assignment and active state. Model changes take effect without reload. After an extension update, wait for startup reconciliation to reapply the saved assignments.

### Subagents auto-disabled
This happens when a configured model is missing or unavailable. Use `list_models`, configure a currently available model, then enable the affected general agent again.

### Delegation not using custom agents
Run `get_status` to confirm the target general agent is enabled and has an available model. If it is disabled, ask Copilot to call `abapfs_manage_subagents` with `enable` and the agent's `agentIds`.
