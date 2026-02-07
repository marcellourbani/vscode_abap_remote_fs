/**
 * 💓 Heartbeat Watchlist
 *
 * Manages the heartbeat.json file - a structured list of monitoring tasks.
 * Both the user (via Copilot chat) and the heartbeat LLM can add/remove tasks.
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { log } from "../../lib"

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single monitoring task in the watchlist
 */
export interface WatchlistTask {
  /** Unique task ID (auto-generated) */
  id: string

  /** Human-readable description of what to monitor */
  description: string

  /** Optional: specific condition or query to check */
  condition?: string

  /** Optional: SAP connection ID for this task */
  connectionId?: string

  /** Is this task currently active? */
  enabled: boolean

  /** When was this task added */
  addedAt: string

  /** When was this task last checked by heartbeat */
  lastCheckedAt?: string

  /** Result of last check (for context in next run) */
  lastResult?: string

  /** Optional: auto-remove after condition is met */
  removeWhenDone?: boolean

  // ========== Smart context from main agent ==========

  /** Pre-built SQL query for HB model to execute directly */
  sampleQuery?: string

  /** Step-by-step instructions for HB model to follow */
  checkInstructions?: string[]

  /** Task priority: high alerts immediately, low can batch */
  priority?: "high" | "medium" | "low"

  /** Category for grouping/filtering */
  category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"

  // ========== Scheduling ==========

  /** Don't check this task until this ISO timestamp (for "remind me tomorrow at 10am") */
  startAt?: string

  /** Is this just a simple reminder? (notify once and auto-remove) */
  reminderOnly?: boolean

  /** Who added this task - for context */
  addedBy?: "user" | "agent" | "heartbeat"

  /** Why was this task added - gives HB model context */
  reason?: string

  // ========== Notification tracking ==========

  /** When user was last notified about this task */
  lastNotifiedAt?: string

  /** What was included in last notification (IDs, hashes, counts) */
  lastNotifiedFindings?: string

  /** Minimum count before alerting (e.g., only alert if > 5 errors) */
  alertThreshold?: number

  /** Don't re-notify within this many minutes */
  cooldownMinutes?: number

  // ========== Task lifecycle ==========

  /** Auto-remove task after this ISO timestamp */
  expiresAt?: string

  /** Maximum number of checks before auto-remove */
  maxChecks?: number

  /** How many times has this task been checked */
  checkCount?: number
}

/**
 * The heartbeat.json file structure
 */
export interface HeartbeatWatchlistFile {
  /** Schema version for future migrations */
  version: number

  /** Last modified timestamp */
  lastModified: string

  /** Who last modified (user or heartbeat) */
  lastModifiedBy: "user" | "heartbeat"

  /** The monitoring tasks */
  tasks: WatchlistTask[]
}

/**
 * Current schema version
 */
const WATCHLIST_VERSION = 1

/**
 * Filename for the watchlist
 */
const WATCHLIST_FILENAME = "heartbeat.json"

// ============================================================================
// WATCHLIST MANAGER
// ============================================================================

/**
 * Manages the heartbeat.json watchlist file
 */
export class HeartbeatWatchlist {
  /**
   * Get the path to heartbeat.json (in first file-based workspace folder)
   */
  static getFilePath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return null

    // Find first file-based workspace folder (not adt://)
    for (const folder of workspaceFolders) {
      if (folder.uri.scheme === "file") {
        return path.join(folder.uri.fsPath, WATCHLIST_FILENAME)
      }
    }

    return null
  }

  /**
   * Read the watchlist file
   */
  static read(): HeartbeatWatchlistFile | null {
    const filePath = this.getFilePath()
    if (!filePath) return null

    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const content = fs.readFileSync(filePath, "utf8")
      const data = JSON.parse(content) as HeartbeatWatchlistFile

      // Validate version
      if (data.version !== WATCHLIST_VERSION) {
        log(`💓 Watchlist version mismatch: ${data.version} vs ${WATCHLIST_VERSION}`)
        // Future: migrate schema if needed
      }

      return data
    } catch (error) {
      log(`💓 Error reading watchlist: ${error}`)
      return null
    }
  }

  /**
   * Write the watchlist file
   */
  static write(data: HeartbeatWatchlistFile, modifiedBy: "user" | "heartbeat" | "agent"): boolean {
    const filePath = this.getFilePath()
    if (!filePath) return false

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Update metadata (agent counts as user for file metadata)
      data.version = WATCHLIST_VERSION
      data.lastModified = new Date().toISOString()
      data.lastModifiedBy = modifiedBy === "agent" ? "user" : modifiedBy

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
      return true
    } catch (error) {
      log(`💓 Error writing watchlist: ${error}`)
      return false
    }
  }

  /**
   * Get or create the watchlist
   */
  static getOrCreate(): HeartbeatWatchlistFile {
    const existing = this.read()
    if (existing) return existing

    return {
      version: WATCHLIST_VERSION,
      lastModified: new Date().toISOString(),
      lastModifiedBy: "user",
      tasks: []
    }
  }

  /**
   * Generate a unique task ID
   */
  static generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  }

  /**
   * Add a new task to the watchlist
   */
  static addTask(
    description: string,
    options?: {
      condition?: string
      connectionId?: string
      removeWhenDone?: boolean
      // Smart context fields
      sampleQuery?: string
      checkInstructions?: string[]
      priority?: "high" | "medium" | "low"
      category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"
      alertThreshold?: number
      cooldownMinutes?: number
      expiresAt?: string
      maxChecks?: number
      // Scheduling
      startAt?: string
      reminderOnly?: boolean
      reason?: string
    },
    modifiedBy: "user" | "heartbeat" | "agent" = "user"
  ): { success: boolean; task?: WatchlistTask; error?: string } {
    const filePath = this.getFilePath()
    if (!filePath) {
      return { success: false, error: "No file-based workspace folder found" }
    }

    const watchlist = this.getOrCreate()

    // Check for duplicate description (but allow if it's a reminder - those are unique by time)
    const normalized = description.trim().toLowerCase()
    if (
      !options?.reminderOnly &&
      watchlist.tasks.some(t => t.description.toLowerCase() === normalized)
    ) {
      return { success: false, error: `Task already exists: "${description}"` }
    }

    const task: WatchlistTask = {
      id: this.generateTaskId(),
      description: description.trim(),
      condition: options?.condition,
      connectionId: options?.connectionId,
      enabled: true,
      addedAt: new Date().toISOString(),
      addedBy: modifiedBy === "heartbeat" ? "heartbeat" : modifiedBy === "agent" ? "agent" : "user",
      removeWhenDone: options?.removeWhenDone,
      // Smart context fields
      sampleQuery: options?.sampleQuery,
      checkInstructions: options?.checkInstructions,
      priority: options?.priority,
      category: options?.category,
      alertThreshold: options?.alertThreshold,
      cooldownMinutes: options?.cooldownMinutes,
      expiresAt: options?.expiresAt,
      maxChecks: options?.maxChecks,
      checkCount: 0,
      // Scheduling
      startAt: options?.startAt,
      reminderOnly: options?.reminderOnly,
      reason: options?.reason
    }

    watchlist.tasks.push(task)

    if (this.write(watchlist, modifiedBy === "agent" ? "user" : modifiedBy)) {
      return { success: true, task }
    } else {
      return { success: false, error: "Failed to write watchlist file" }
    }
  }

  /**
   * Remove a task by ID or description
   */
  static removeTask(
    idOrDescription: string,
    modifiedBy: "user" | "heartbeat" = "user"
  ): { success: boolean; removedTask?: WatchlistTask; error?: string } {
    const watchlist = this.read()
    if (!watchlist) {
      return { success: false, error: "No watchlist file found" }
    }

    const normalized = idOrDescription.trim().toLowerCase()
    const taskIndex = watchlist.tasks.findIndex(
      t => t.id === idOrDescription || t.description.toLowerCase() === normalized
    )

    if (taskIndex === -1) {
      return { success: false, error: `Task not found: "${idOrDescription}"` }
    }

    const [removedTask] = watchlist.tasks.splice(taskIndex, 1)

    if (this.write(watchlist, modifiedBy)) {
      return { success: true, removedTask }
    } else {
      return { success: false, error: "Failed to write watchlist file" }
    }
  }

  /**
   * Update a task (e.g., record last check result, notification tracking)
   */
  static updateTask(
    taskId: string,
    updates: Partial<
      Pick<
        WatchlistTask,
        | "enabled"
        | "lastCheckedAt"
        | "lastResult"
        | "description"
        | "condition"
        | "lastNotifiedAt"
        | "lastNotifiedFindings"
        | "checkCount"
      >
    >,
    modifiedBy: "user" | "heartbeat" | "agent" = "heartbeat"
  ): { success: boolean; task?: WatchlistTask; error?: string } {
    const watchlist = this.read()
    if (!watchlist) {
      return { success: false, error: "No watchlist file found" }
    }

    const task = watchlist.tasks.find(t => t.id === taskId)
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` }
    }

    // Apply updates
    if (updates.enabled !== undefined) task.enabled = updates.enabled
    if (updates.lastCheckedAt !== undefined) task.lastCheckedAt = updates.lastCheckedAt
    if (updates.lastResult !== undefined) task.lastResult = updates.lastResult
    if (updates.description !== undefined) task.description = updates.description
    if (updates.condition !== undefined) task.condition = updates.condition

    // Notification tracking
    if (updates.lastNotifiedAt !== undefined) task.lastNotifiedAt = updates.lastNotifiedAt
    if (updates.lastNotifiedFindings !== undefined)
      task.lastNotifiedFindings = updates.lastNotifiedFindings

    // Check count (auto-increment on check)
    if (updates.checkCount !== undefined) task.checkCount = updates.checkCount

    if (this.write(watchlist, modifiedBy)) {
      return { success: true, task }
    } else {
      return { success: false, error: "Failed to write watchlist file" }
    }
  }

  /**
   * Get all enabled tasks
   */
  static getEnabledTasks(): WatchlistTask[] {
    const watchlist = this.read()
    if (!watchlist) return []
    return watchlist.tasks.filter(t => t.enabled)
  }

  /**
   * Get all tasks (for listing)
   */
  static getAllTasks(): WatchlistTask[] {
    const watchlist = this.read()
    if (!watchlist) return []
    return watchlist.tasks
  }

  /**
   * Get tasks that are due for checking (filters out future-scheduled tasks)
   */
  static getDueTasks(): WatchlistTask[] {
    const tasks = this.getEnabledTasks()
    const now = new Date()

    return tasks.filter(task => {
      // Check if task has a startAt and it's in the future
      if (task.startAt) {
        const startTime = new Date(task.startAt)
        if (now < startTime) {
          return false // Not due yet
        }
      }

      // Check if task has expired
      if (task.expiresAt) {
        const expireTime = new Date(task.expiresAt)
        if (now > expireTime) {
          return false // Expired
        }
      }

      return true
    })
  }

  /**
   * Get tasks scheduled for the future (for display purposes)
   */
  static getScheduledTasks(): WatchlistTask[] {
    const tasks = this.getEnabledTasks()
    const now = new Date()

    return tasks.filter(task => {
      if (task.startAt) {
        const startTime = new Date(task.startAt)
        return now < startTime
      }
      return false
    })
  }

  /**
   * Format tasks as a prompt section for the LLM
   */
  static formatForPrompt(): string {
    const dueTasks = this.getDueTasks()
    const scheduledTasks = this.getScheduledTasks()

    if (dueTasks.length === 0 && scheduledTasks.length === 0) {
      return "No monitoring tasks configured."
    }

    if (dueTasks.length === 0) {
      return `No tasks due right now. ${scheduledTasks.length} task(s) scheduled for later.`
    }

    const lines = ["## Tasks to Check Now", ""]

    for (const task of dueTasks) {
      lines.push(`### ${task.id}`)

      // Show if it's a reminder vs monitoring task
      if (task.reminderOnly) {
        lines.push(`🔔 **REMINDER:** ${task.description}`)
        lines.push(`**Action:** Notify the user with this message, then REMOVE this task.`)
        if (task.reason) {
          lines.push(`**Context:** ${task.reason}`)
        }
      } else {
        lines.push(`**Task:** ${task.description}`)
      }

      if (task.addedBy === "agent") {
        lines.push(`_(Added proactively by assistant)_`)
      }

      if (task.priority) {
        lines.push(`**Priority:** ${task.priority}`)
      }
      if (task.category && task.category !== "reminder") {
        lines.push(`**Category:** ${task.category}`)
      }
      if (task.connectionId) {
        lines.push(`**System:** ${task.connectionId}`)
      }
      if (task.condition) {
        lines.push(`**Condition:** ${task.condition}`)
      }

      // Smart context from main agent
      if (task.sampleQuery) {
        lines.push(`**SQL Query to Execute:**`)
        lines.push("```sql")
        lines.push(task.sampleQuery)
        lines.push("```")
      }
      if (task.checkInstructions?.length) {
        lines.push(`**Step-by-step Instructions:**`)
        task.checkInstructions.forEach((step, i) => {
          lines.push(`${i + 1}. ${step}`)
        })
      }

      // Thresholds and cooldowns
      if (task.alertThreshold !== undefined) {
        lines.push(`**Alert Threshold:** Only alert if count > ${task.alertThreshold}`)
      }
      if (task.cooldownMinutes !== undefined && task.lastNotifiedAt) {
        const lastNotified = new Date(task.lastNotifiedAt)
        const cooldownEnd = new Date(lastNotified.getTime() + task.cooldownMinutes * 60 * 1000)
        const now = new Date()
        if (now < cooldownEnd) {
          const minsRemaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / 60000)
          lines.push(`**⏸️ Cooldown Active:** ${minsRemaining} min remaining (do NOT notify again)`)
        }
      }

      // Previous findings for comparison
      if (task.lastCheckedAt) {
        lines.push(`**Last Checked:** ${task.lastCheckedAt}`)
      }
      if (task.lastNotifiedAt) {
        lines.push(`**Last Notified:** ${task.lastNotifiedAt}`)
      }
      if (task.lastNotifiedFindings) {
        lines.push(`**Already Notified (do NOT re-notify for these):**`)
        lines.push(`> ${task.lastNotifiedFindings}`)
      }
      if (task.lastResult) {
        lines.push(`**Previous Check Result:**`)
        lines.push(`> ${task.lastResult}`)
      } else if (!task.reminderOnly) {
        lines.push(`**Previous Check:** None (first check)`)
      }

      if (task.removeWhenDone) {
        lines.push(`**Auto-remove:** Yes, when condition is met`)
      }
      if (task.maxChecks && task.checkCount !== undefined) {
        lines.push(`**Check Limit:** ${task.checkCount}/${task.maxChecks}`)
      }

      lines.push("")
    }

    return lines.join("\n")
  }
}
