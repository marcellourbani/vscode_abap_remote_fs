# AI Subagents for Optimized ABAP Development

AI Subagents are specialized AI assistants, each focused on one type of ABAP task (finding objects, reading code, running analysis, etc.). Instead of one general AI doing everything, subagents split work across focused specialists.

**Why this matters:**

- **Better results** — a dedicated code reviewer catches more issues than a general assistant juggling multiple goals
- **Longer conversations** — heavy operations run in separate context windows, so your main chat stays responsive
- **Lower cost** — simple tasks (search, read) use cheaper/faster models; complex tasks use smarter ones

## Available Subagents

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

In GitHub Copilot Chat, type `@abap-orchestrator` to start. The orchestrator is the only agent exposed directly in the chat dropdown — it calls other agents automatically as needed.

```
@abap-orchestrator analyze ZCL_ARTICLE_HANDLER and suggest improvements
```

For example, the orchestrator might:

1. Delegate "find related classes" → `abap-discoverer` (cheap, fast)
2. Delegate "read the code" → `abap-reader` (cheap, fast)
3. Delegate "usage analysis" → `abap-usage-analyzer` (mid-tier)
4. Synthesize findings and write recommendations itself (premium)

You can also invoke other subagents directly with `@agent-name` if needed. Ask Copilot to make an agent available in the dropdown — it can update the agent's `.agent.md` file to enable this.

## Setup

> Subagent configuration is stored at the **workspace level** in `.vscode/settings.json` and `.github/agents/`. Each project can have its own configuration.

In normal usage, you do not need to edit these files manually. Copilot can configure models, generate/update agent files, validate them, and enable/disable subagents through chat commands.

### Step 1 — Configure models

Ask Copilot:

```
Configure subagents for ABAP development
```

Copilot will suggest models for each tier and ask for confirmation before applying. Recommended assignments:

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

This creates agent files in `.github/agents/` and validates them.

### Step 3 — Allow agent delegation (if prompted)

You may see a notification asking to enable `chat.customAgentInSubagent.enabled`. Click **Enable Setting** — this allows the orchestrator to call other agents.

## Managing Subagents

All management is done through Copilot chat:

| What you want | What to ask |
|---------------|-------------|
| Check current status | `Show subagent status` |
| Disable all agents | `Disable subagents` |
| Re-enable agents | `Enable subagents` |
| Change a model | `Change abap-discoverer to use GPT-4o` |
| See available models | `What models can I use for subagents?` |
| See available tools | `List available tools for subagents` |

When you disable subagents, agent files move to `agents_disabled/` (not deleted). Re-enabling restores them with your customizations intact.

## Customizing Agent Tools

Each agent's `.agent.md` file in `.github/agents/` defines which tools it can use. You can edit these files directly or ask Copilot to do it:

```
Add the abap-trace tool to abap-troubleshooter
```

Changes survive disable/re-enable cycles — only the `model:` line is updated when you change models.

✅ **User Control**: You decide which models to use for each agent tier

## What to Be Aware Of

⚠️ **Model Availability**: Some models shown in the list may not work (e.g., "GPT-4o mini"). The system validates and auto-disables if errors are detected.

⚠️ **VS Code Setting Required**: `chat.customAgentInSubagent.enabled` must be true for delegation to work, otherwise main agent's model may be used for all subagents which can result in a lot of premium request usage.

⚠️ **Workspace-Specific**: Settings and agent files are per-workspace, not global

⚠️ **Agent Files in Git**: The `.github/agents/` folder will appear in your version control - add to `.gitignore` if you don't want to share

⚠️ **Frequently-Used Agents**: Agents like `abap-discoverer` and `abap-reader` get called often - using expensive models for these defeats the cost benefit

## Troubleshooting

### "Cannot enable subagents - missing models"
All 13 agents must have models configured. Ask Copilot to configure missing agents.

### Agent files show validation errors
Some model names aren't valid for agent files. Try a different model (e.g., use `Claude Haiku 4.5` instead of `GPT-4o mini`).

### Subagents auto-disabled
This happens when configured models become unavailable. Reconfigure with available models.

### Ghost files in explorer after disable
This is a VS Code refresh issue. The extension refreshes the explorer automatically, but occasionally you may need to collapse/expand the folder.

### Delegation not using custom agents
Make sure `chat.customAgentInSubagent.enabled` is set to `true` in your VS Code settings.
