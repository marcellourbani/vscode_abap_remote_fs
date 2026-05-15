# Heartbeat - Background Monitoring & Reminders

> ⚠️ **BETA FEATURE** - Please report any issues.

Heartbeat is a background service that runs an AI agent at a set interval to monitor your SAP systems and send you reminders. You configure what to watch; the agent checks it quietly in the background and only notifies you when something happens.

**Common uses:**

- "Alert me when new ST22 dumps appear in DEV"
- "Watch transport DEVK900001 until it's released"
- "Remind me tomorrow at 10am to review the batch job"

---

## Setup

Heartbeat settings are stored at the **workspace level** (`.vscode/settings.json`), not globally. Each project can have its own configuration.

### Step 1: Configure with Copilot (recommended)

You do not need to edit settings manually in most cases. Ask Copilot:

```
Set up heartbeat with model GPT-4o mini, every 5 minutes, and start it
```

Copilot uses the heartbeat tools to configure and start the service for you.

### Step 2: Manual settings (optional)

Open VS Code Settings (`Ctrl+,`) and add:

```json
{
  "abapfs.heartbeat.model": "GPT-4o mini",
  "abapfs.heartbeat.every": "5m",
  "abapfs.heartbeat.enabled": true
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `abapfs.heartbeat.enabled` | Enable/disable the service | `false` |
| `abapfs.heartbeat.model` | AI model for background checks — use a cheap model | Required |
| `abapfs.heartbeat.every` | Check interval (`"5m"`, `"1h"`, `"30s"`) | `"5m"` |
| `abapfs.heartbeat.activeHours` | Only run during these hours | `"08:00-18:00"` |
| `abapfs.heartbeat.maxConsecutiveErrors` | Auto-pause after N errors | `20` |

**Recommended models (cost-effective):**

- `GPT-4o mini` ⭐ most reliable for background tasks
- `Claude Haiku 4`
- `GPT-4o`

### Step 3: Start the service

Ask Copilot: `"Start the heartbeat service"`

Or set `abapfs.heartbeat.enabled` to `true` in settings — the service starts automatically.

### Step 3: Add tasks

Ask Copilot in plain language:

```
"Remind me tomorrow at 10am to review transport K900123"
"Monitor DEV100 for new ST22 dumps and alert me"
"Watch transport DEVK900001 until it's released"
```

Copilot creates the task definitions and saves them to `heartbeat.json` in your workspace root.

---

## Status Bar

When heartbeat is running, a heart ❤️ appears in the VS Code status bar.

| Status | Meaning |
|--------|---------|
| ❤️ (pulsing) | Active, waiting for next check |
| ❤️ beat... | Running a check now |
| ❤️ zzz | Paused (errors or outside active hours) |
| (hidden) | Stopped |

**Click the heart** to open `heartbeat.json` directly.

---

## Task Types

### Reminders (one-time)

Notifies you once at the scheduled time, then removes itself.

```
"Remind me in 2 hours to check the batch job"
"Remind me tomorrow at 9am about the deployment"
```

Uses `reminderOnly: true` and a `startAt` timestamp. The heartbeat agent ignores the task until `startAt` passes.

### Monitoring Tasks (recurring)

Checks a condition every interval and alerts only when something **new** is found.

```
"Monitor for new ST22 dumps in QA100"
"Alert me when transport K900123 is released"
```

The agent stores what it already reported in `lastNotifiedFindings` and only triggers a new alert for changes.

---

## Task Properties Reference

| Property | Description |
|----------|-------------|
| `id` | Unique identifier |
| `description` | What this task monitors or reminds |
| `connectionId` | SAP system ID (e.g. `"dev100"`) |
| `enabled` | Whether the task is active |
| `category` | `transport`, `dump`, `job`, `reminder`, `custom` |
| `priority` | `high`, `medium`, `low` |
| `sampleQuery` | SQL query for the agent to run |
| `checkInstructions` | Step-by-step instructions for the agent |
| `startAt` | ISO timestamp — don't check before this time |
| `reminderOnly` | Notify once and auto-remove |
| `removeWhenDone` | Auto-remove when the condition is met |
| `cooldownMinutes` | Don't re-notify within this period |
| `alertThreshold` | Only alert if count exceeds this value |

---

## Example Task Definitions

These are the JSON entries stored in `heartbeat.json`. You can let Copilot generate them, or write them manually.

### Monitor ST22 dumps

```json
{
  "id": "task-st22-dumps",
  "description": "Monitor for new ST22 runtime dumps",
  "connectionId": "your-system-id",
  "category": "dump",
  "priority": "high",
  "checkInstructions": [
    "Use analyze_abap_dumps tool with action 'list_dumps'",
    "Compare dump IDs against lastNotifiedFindings",
    "Only alert for genuinely new dumps",
    "Update lastNotifiedFindings with current dump IDs"
  ],
  "cooldownMinutes": 30
}
```

### Watch a transport until released

```json
{
  "id": "task-watch-transport",
  "description": "Watch transport DEVK900001 for release",
  "connectionId": "your-system-id",
  "category": "transport",
  "sampleQuery": "SELECT trkorr, trstatus FROM e070 WHERE trkorr = 'DEVK900001'",
  "checkInstructions": [
    "Execute the SQL query",
    "If trstatus = 'R', notify user and remove task",
    "If still 'D', update lastResult silently"
  ],
  "removeWhenDone": true
}
```

### Scheduled reminder

```json
{
  "id": "task-reminder-123",
  "description": "Review transport release process",
  "category": "reminder",
  "startAt": "2026-02-05T10:00:00.000Z",
  "reminderOnly": true
}
```

---

## Managing Heartbeat via Copilot

| What you want | Ask Copilot |
|---------------|-------------|
| Check status | `"What's the heartbeat status?"` |
| List tasks | `"Show me the heartbeat watchlist"` |
| Add a task | `"Monitor DEV for stuck jobs"` |
| Remove a task | `"Remove the transport monitoring task"` |
| Run check now | `"Trigger a heartbeat check now"` |
| Stop service | `"Stop the heartbeat service"` |

---

## Timezone Handling

When you say something like "remind me tomorrow at 10am", Copilot:

1. Queries the SAP system's timezone using `get_sap_system_info`
2. Converts your local time to the correct UTC timestamp
3. Stores the result in `startAt` (e.g. `"2026-02-05T08:00:00.000Z"` for UTC+2)

This ensures reminders fire at the right time relative to your SAP system.

---

## Deduplication

The agent tracks what it has already alerted on to avoid repeated notifications:

- `cooldownMinutes` — minimum gap between re-alerts for the same task
- `lastNotifiedFindings` — IDs or summaries of what was already reported

**Example flow for dump monitoring:**

- Check 1: 5 dumps → Alert: "5 new dumps found"
- Check 2: Same 5 dumps → No alert (already reported)
- Check 3: 7 dumps → Alert: "2 new dumps found"

---

## Troubleshooting

**Service won't start**

- Confirm `abapfs.heartbeat.model` is set in workspace settings
- Confirm `abapfs.heartbeat.enabled` is `true`
- Check VS Code Output panel → "ABAP FS" for errors

**Tasks not being checked**

- Confirm `heartbeat.json` exists in the workspace root (created automatically when you add your first task)
- Confirm the task has `"enabled": true`
- Check whether `startAt` is in the future
- Check whether current time is within `activeHours`

**Too many alerts**

- Increase `cooldownMinutes` on the task
- Set `alertThreshold` to filter low-count issues
- Add more specific conditions in `checkInstructions`

**Model errors**

- Try `GPT-4o mini` — most reliable for background tasks
- Some models handle tool calls inconsistently in background mode
