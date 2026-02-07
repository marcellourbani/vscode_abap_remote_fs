/**
 * 💓 Heartbeat Tool
 *
 * Language Model Tool for managing the heartbeat service and watchlist.
 *
 * Two usage contexts:
 * 1. User via Copilot chat (agent mode) - add/remove monitoring tasks
 * 2. Heartbeat LLM run - update task status, mark complete, add new discoveries
 *
 * The watchlist is stored in heartbeat.json with a structured format
 * that's easy for LLMs to read and maintain.
 */

import * as vscode from "vscode"
import { getHeartbeatService } from "./heartbeatService"
import { formatDuration } from "./heartbeatTypes"
import { HeartbeatWatchlist } from "./heartbeatWatchlist"

// ============================================================================
// TOOL PARAMETERS
// ============================================================================

export interface HeartbeatToolParams {
  /** Action to perform */
  action: // Service control
    | "status"
    | "start"
    | "stop"
    | "pause"
    | "resume"
    | "trigger"
    | "history"
    // Watchlist management (for both user and heartbeat LLM)
    | "add_task"
    | "remove_task"
    | "update_task"
    | "enable_task"
    | "disable_task"
    | "list_tasks"
    | "get_watchlist" // Returns JSON for LLM parsing

  /** For 'history' - number of entries to show */
  count?: number

  // Task management parameters
  /** For 'add_task' - task description */
  description?: string

  /** For 'add_task' - optional condition to check */
  condition?: string

  /** For 'add_task' - SAP connection ID */
  connectionId?: string

  /** For 'add_task' - auto-remove when condition is met */
  removeWhenDone?: boolean

  // Smart context from main agent
  /** For 'add_task' - pre-built SQL query for HB model */
  sampleQuery?: string

  /** For 'add_task' - step-by-step instructions for HB model */
  checkInstructions?: string[]

  /** For 'add_task' - task priority */
  priority?: "high" | "medium" | "low"

  /** For 'add_task' - task category */
  category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"

  /** For 'add_task' - only alert if count exceeds this */
  alertThreshold?: number

  /** For 'add_task' - don't re-notify within this many minutes */
  cooldownMinutes?: number

  /** For 'add_task' - auto-remove after this ISO timestamp */
  expiresAt?: string

  /** For 'add_task' - auto-remove after this many checks */
  maxChecks?: number

  // Scheduling
  /** For 'add_task' - don't check until this ISO timestamp */
  startAt?: string

  /** For 'add_task' - simple reminder, notify once and remove */
  reminderOnly?: boolean

  /** For 'trigger' or 'add_task' - why this action/task */
  reason?: string

  /** For 'remove_task', 'update_task', etc. - task ID or description */
  taskId?: string

  /** For 'update_task' - new result to record */
  result?: string

  /** For 'update_task' - when user was last notified */
  lastNotifiedAt?: string

  /** For 'update_task' - what was in last notification */
  lastNotifiedFindings?: string

  /** For 'update_task' - who is making the update */
  modifiedBy?: "user" | "heartbeat" | "agent"
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 💓 Heartbeat Management Tool
 */
export class HeartbeatTool implements vscode.LanguageModelTool<HeartbeatToolParams> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<HeartbeatToolParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { action } = options.input

    const actionMessages: Record<string, string> = {
      status: "Checking heartbeat status...",
      start: "Starting heartbeat service...",
      stop: "Stopping heartbeat service...",
      pause: "Pausing heartbeat...",
      resume: "Resuming heartbeat...",
      trigger: "Triggering heartbeat now...",
      history: "Getting heartbeat history...",
      add_task: "Adding monitoring task...",
      remove_task: "Removing monitoring task...",
      update_task: "Updating task status...",
      enable_task: "Enabling task...",
      disable_task: "Disabling task...",
      list_tasks: "Listing monitoring tasks...",
      get_watchlist: "Getting watchlist..."
    }

    return {
      invocationMessage: actionMessages[action] || `Heartbeat ${action}...`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<HeartbeatToolParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input
    const service = getHeartbeatService()

    try {
      switch (params.action) {
        // === Service Control ===
        case "status":
          return this.handleStatus(service)

        case "start":
          return this.handleStart(service)

        case "stop":
          if (!service) return this.noServiceError()
          service.stop()
          return this.text("⏹️ Heartbeat service stopped.")

        case "trigger":
          if (!service) return this.noServiceError()
          return await this.handleTrigger(service, params.reason)

        case "history":
          return this.handleHistory(service, params.count || 10)

        // === Watchlist Management ===
        case "add_task":
          return this.handleAddTask(params)

        case "remove_task":
          return this.handleRemoveTask(params.taskId)

        case "update_task":
          return this.handleUpdateTask(params)

        case "enable_task":
          return this.handleToggleTask(params.taskId, true)

        case "disable_task":
          return this.handleToggleTask(params.taskId, false)

        case "list_tasks":
          return this.handleListTasks()

        case "get_watchlist":
          return this.handleGetWatchlist()

        default:
          return this.text(`Unknown action: ${params.action}`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return this.text(`❌ Error: ${msg}`)
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private text(message: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)])
  }

  private noServiceError(): vscode.LanguageModelToolResult {
    return this.text("Heartbeat service not initialized. Restart VS Code.")
  }

  // ============================================================================
  // SERVICE CONTROL HANDLERS
  // ============================================================================

  private handleStatus(
    service: ReturnType<typeof getHeartbeatService>
  ): vscode.LanguageModelToolResult {
    if (!service) {
      return this.text("❌ Heartbeat service not initialized. Extension may not be fully loaded.")
    }

    // Get settings info
    const config = vscode.workspace.getConfiguration("abapfs.heartbeat")
    const enabledInSettings = config.get<boolean>("enabled", false)
    const configuredModel = config.get<string>("model", "")
    const interval = config.get<string>("every", "5m")

    const status = service.getStatus()
    const tasks = HeartbeatWatchlist.getAllTasks()
    const enabledTasks = tasks.filter(t => t.enabled).length

    const lines = ["💓 **Heartbeat Status**", ""]

    // Configuration section
    lines.push("**Configuration:**")
    lines.push(`- Enabled in settings: ${enabledInSettings ? "✅ Yes" : "❌ No"}`)
    lines.push(`- Model: ${configuredModel || "⚠️ NOT CONFIGURED"}`)
    lines.push(`- Interval: ${interval}`)
    lines.push("")

    // Warnings if not properly configured
    if (!configuredModel) {
      lines.push(
        '⚠️ **No model configured!** Set abapfs.heartbeat.model to a cheap model like "GPT-4o mini (copilot)" or "Claude Haiku 4 (copilot)" before starting.'
      )
      lines.push("")
    }

    // Service status
    lines.push(
      `**Service:** ${status.isRunning ? "✅ Running" : "❌ Stopped"}${status.isPaused ? " (Paused)" : ""}`
    )
    lines.push(`**Tasks:** ${enabledTasks} enabled / ${tasks.length} total`)

    if (status.lastRunTime) {
      const ago = Date.now() - status.lastRunTime.getTime()
      lines.push(`**Last Run:** ${formatDuration(ago)} ago`)
    }

    if (status.nextRunTime && status.isRunning && !status.isPaused) {
      const inMs = status.nextRunTime.getTime() - Date.now()
      if (inMs > 0) {
        lines.push(`**Next Run:** in ${formatDuration(inMs)}`)
      }
    }

    lines.push("")
    lines.push("**Statistics:**")
    lines.push(`- Total Runs: ${status.stats.totalRuns}`)
    lines.push(`- Alerts: ${status.stats.alerts}`)
    lines.push(`- Errors: ${status.stats.errors}`)

    if (status.stats.averageDurationMs > 0) {
      lines.push(`- Avg Duration: ${formatDuration(status.stats.averageDurationMs)}`)
    }

    return this.text(lines.join("\n"))
  }

  private async handleStart(
    service: ReturnType<typeof getHeartbeatService>
  ): Promise<vscode.LanguageModelToolResult> {
    if (!service) {
      return this.text("❌ Heartbeat service not initialized. Extension may not be fully loaded.")
    }

    // Check if model is configured
    const config = vscode.workspace.getConfiguration("abapfs.heartbeat")
    const configuredModel = config.get<string>("model", "")

    if (!configuredModel) {
      return this.text(
        "❌ Cannot start heartbeat: No model configured.\n\n" +
          "Set abapfs.heartbeat.model in VS Code settings to a cost-effective model like:\n" +
          '- "GPT-4o mini (copilot)"\n' +
          '- "Claude Haiku 4 (copilot)"\n' +
          '- "GPT-4o (copilot)"\n\n' +
          "Then call start again."
      )
    }

    // Auto-enable in settings if disabled
    const enabledInSettings = config.get<boolean>("enabled", false)
    if (!enabledInSettings) {
      await config.update("enabled", true, vscode.ConfigurationTarget.Workspace)
    }

    // Start the service
    await service.start()

    const status = service.getStatus()
    if (status.isRunning) {
      return this.text(
        `✅ Heartbeat started!\n- Model: ${configuredModel}\n- Interval: ${config.get<string>("every", "5m")}`
      )
    } else {
      return this.text("❌ Failed to start heartbeat. Check the logs for details.")
    }
  }

  private async handleTrigger(
    service: NonNullable<ReturnType<typeof getHeartbeatService>>,
    reason?: string
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await service.triggerNow(reason)

    if (result.status === "ran") {
      return this.text(`✅ Heartbeat completed in ${formatDuration(result.durationMs)}`)
    } else if (result.status === "skipped") {
      return this.text(`⏭️ Skipped: ${result.reason}`)
    } else {
      return this.text(`❌ Failed: ${result.reason}`)
    }
  }

  private handleHistory(
    service: ReturnType<typeof getHeartbeatService>,
    _count: number
  ): vscode.LanguageModelToolResult {
    if (!service) {
      return this.text("Heartbeat service not available")
    }

    const status = service.getStatus()

    if (status.stats.totalRuns === 0) {
      return this.text("No heartbeat history yet.")
    }

    const lines = [
      `💓 **Heartbeat History**`,
      "",
      `Total: ${status.stats.totalRuns} | OK: ${status.stats.successfulRuns} | Alerts: ${status.stats.alerts} | Errors: ${status.stats.errors}`
    ]

    return this.text(lines.join("\n"))
  }

  // ============================================================================
  // WATCHLIST HANDLERS
  // ============================================================================

  private handleAddTask(params: HeartbeatToolParams): vscode.LanguageModelToolResult {
    if (!params.description || params.description.trim().length === 0) {
      return this.text("❌ No task description provided.")
    }

    const result = HeartbeatWatchlist.addTask(
      params.description,
      {
        condition: params.condition,
        connectionId: params.connectionId,
        removeWhenDone: params.removeWhenDone || params.reminderOnly, // Reminders auto-remove
        // Smart context from main agent
        sampleQuery: params.sampleQuery,
        checkInstructions: params.checkInstructions,
        priority: params.priority,
        category: params.reminderOnly ? "reminder" : params.category,
        alertThreshold: params.alertThreshold,
        cooldownMinutes: params.cooldownMinutes,
        expiresAt: params.expiresAt,
        maxChecks: params.maxChecks,
        // Scheduling
        startAt: params.startAt,
        reminderOnly: params.reminderOnly,
        reason: params.reason
      },
      params.modifiedBy || "user"
    )

    if (result.success && result.task) {
      const lines = [
        params.reminderOnly ? `🔔 Reminder scheduled:` : `✅ Added monitoring task:`,
        `- **ID:** ${result.task.id}`,
        `- **Description:** ${result.task.description}`
      ]

      // Show scheduled time for reminders
      if (result.task.startAt) {
        const startTime = new Date(result.task.startAt)
        lines.push(`- **Scheduled for:** ${startTime.toLocaleString()}`)
      }
      if (result.task.reminderOnly) {
        lines.push(`- **Type:** One-time reminder (will auto-remove after notification)`)
      }
      if (result.task.condition) {
        lines.push(`- **Condition:** ${result.task.condition}`)
      }
      if (result.task.sampleQuery) {
        lines.push(`- **SQL Query:** Provided ✓`)
      }
      if (result.task.checkInstructions?.length) {
        lines.push(`- **Instructions:** ${result.task.checkInstructions.length} steps`)
      }
      if (result.task.priority) {
        lines.push(`- **Priority:** ${result.task.priority}`)
      }
      if (result.task.cooldownMinutes) {
        lines.push(`- **Cooldown:** ${result.task.cooldownMinutes} min`)
      }
      if (result.task.removeWhenDone && !result.task.reminderOnly) {
        lines.push(`- **Auto-remove:** Yes (when condition is met)`)
      }

      // Hint to start heartbeat if not running
      const service = getHeartbeatService()
      if (service && !service.getStatus().isRunning) {
        lines.push("")
        lines.push('_Heartbeat is not running. Use action "start" to begin monitoring._')
      }

      return this.text(lines.join("\n"))
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleRemoveTask(taskId?: string): vscode.LanguageModelToolResult {
    if (!taskId) {
      return this.text("❌ No task ID or description provided.")
    }

    const result = HeartbeatWatchlist.removeTask(taskId)

    if (result.success && result.removedTask) {
      return this.text(`✅ Removed task: "${result.removedTask.description}"`)
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleUpdateTask(params: HeartbeatToolParams): vscode.LanguageModelToolResult {
    if (!params.taskId) {
      return this.text("❌ No task ID provided.")
    }

    const updates: Parameters<typeof HeartbeatWatchlist.updateTask>[1] = {}

    if (params.result !== undefined) {
      updates.lastResult = params.result
      updates.lastCheckedAt = new Date().toISOString()
    }

    // Notification tracking updates
    if (params.lastNotifiedAt !== undefined) {
      updates.lastNotifiedAt = params.lastNotifiedAt
    }
    if (params.lastNotifiedFindings !== undefined) {
      updates.lastNotifiedFindings = params.lastNotifiedFindings
    }

    const result = HeartbeatWatchlist.updateTask(
      params.taskId,
      updates,
      params.modifiedBy || "heartbeat"
    )

    if (result.success && result.task) {
      return this.text(`✅ Updated task "${result.task.description}"`)
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleToggleTask(
    taskId: string | undefined,
    enabled: boolean
  ): vscode.LanguageModelToolResult {
    if (!taskId) {
      return this.text("❌ No task ID provided.")
    }

    const result = HeartbeatWatchlist.updateTask(taskId, { enabled }, "user")

    if (result.success && result.task) {
      const status = enabled ? "enabled" : "disabled"
      return this.text(`✅ Task "${result.task.description}" ${status}`)
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleListTasks(): vscode.LanguageModelToolResult {
    const tasks = HeartbeatWatchlist.getAllTasks()
    const filePath = HeartbeatWatchlist.getFilePath()

    if (tasks.length === 0) {
      const lines = [
        "📋 **No monitoring tasks configured**",
        "",
        'Use action "add_task" with description to add a task.',
        "",
        `File: ${filePath || "No workspace folder"}`
      ]
      return this.text(lines.join("\n"))
    }

    const lines = [`📋 **Monitoring Tasks** (${tasks.length})`, ""]

    for (const task of tasks) {
      const status = task.enabled ? "✅" : "❌"
      lines.push(`${status} **${task.id}**`)
      lines.push(`   ${task.description}`)
      if (task.condition) {
        lines.push(`   _Condition: ${task.condition}_`)
      }
      if (task.lastResult) {
        lines.push(`   _Last: ${task.lastResult}_`)
      }
      lines.push("")
    }

    return this.text(lines.join("\n"))
  }

  /**
   * Returns raw JSON for LLM parsing during heartbeat runs
   */
  private handleGetWatchlist(): vscode.LanguageModelToolResult {
    const watchlist = HeartbeatWatchlist.read()

    if (!watchlist) {
      return this.text(
        JSON.stringify(
          {
            version: 1,
            tasks: [],
            message: "No watchlist file found"
          },
          null,
          2
        )
      )
    }

    return this.text(JSON.stringify(watchlist, null, 2))
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register the heartbeat tool
 */
export function registerHeartbeatTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool("manage_heartbeat", new HeartbeatTool()))
}
