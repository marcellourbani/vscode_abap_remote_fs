/**
 * 💓 Heartbeat Service
 *
 * Periodic LLM agent turns for background monitoring.
 * Runs the LLM at configurable intervals, reads heartbeat.json watchlist, uses tools.
 */

import * as vscode from "vscode"
import { HeartbeatStateManager } from "./heartbeatStateManager"
import { runHeartbeatLM } from "./heartbeatLmClient"
import {
  HeartbeatConfig,
  HeartbeatEvent,
  HeartbeatEventListener,
  HeartbeatRunResult,
  HeartbeatRunRecord,
  parseDurationMs,
  isWithinActiveHours,
  formatDuration
} from "./heartbeatTypes"
import { log } from "../../lib"

/**
 * 💓 Heartbeat Service
 *
 * Manages periodic LLM runs for background monitoring
 */
export class HeartbeatService {
  private context: vscode.ExtensionContext
  private stateManager: HeartbeatStateManager
  private timer: NodeJS.Timeout | null = null
  private isRunning = false
  private isPaused = false
  private currentRun: Promise<void> | null = null
  private cancellationTokenSource: vscode.CancellationTokenSource | null = null
  private eventListeners: HeartbeatEventListener[] = []

  // Status bar animation
  private statusBarItem: vscode.StatusBarItem | null = null
  private heartbeatAnimationTimer: NodeJS.Timeout | null = null
  private heartbeatFrame = 0

  constructor(context: vscode.ExtensionContext, stateManager: HeartbeatStateManager) {
    this.context = context
    this.stateManager = stateManager
    this.initStatusBar()
    this.initGlobalConfigListener()
  }

  /**
   * Initialize global config listener (always active, even when service is stopped)
   * Handles all config changes by stopping/restarting the service as needed
   */
  private initGlobalConfigListener(): void {
    const disposable = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("abapfs.heartbeat")) {
        const config = vscode.workspace.getConfiguration("abapfs.heartbeat")
        const enabled = config.get<boolean>("enabled", false)
        const model = config.get<string>("model", "")

        if (enabled && !this.isRunning) {
          // Check if model is configured before starting
          if (!model || model.trim().length === 0) {
            // No model configured - disable and notify user
            config.update("enabled", false, vscode.ConfigurationTarget.Workspace)
            vscode.window
              .showWarningMessage(
                'Heartbeat requires a model to be configured. Please set "abapfs.heartbeat.model" first (workspace level), then enable heartbeat.',
                "Open Settings"
              )
              .then(selection => {
                if (selection === "Open Settings") {
                  vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", "abapfs.heartbeat.model")
                }
              })
            return
          }
          // Enabling - start the service
          this.start()
        } else if (!enabled && this.isRunning) {
          // Disabling - stop the service
          this.stop()
        } else if (enabled && this.isRunning) {
          // Config changed while running - restart to pick up changes
          this.stop()
          this.start()
        }
      }
    })
    this.context.subscriptions.push(disposable)
  }

  /**
   * Initialize the status bar item
   */
  private initStatusBar(): void {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.statusBarItem.command = "abapfs.openHeartbeatJson"
    this.statusBarItem.tooltip = "Heartbeat - Click to open watchlist"
    this.context.subscriptions.push(this.statusBarItem)
  }

  /**
   * Start the beating heart animation
   */
  private startHeartAnimation(): void {
    if (this.heartbeatAnimationTimer) return

    // Heart pulse animation: ♡ → ♥ (empty to filled)
    const frames = ["$(heart)", "$(heart-filled)"]

    this.heartbeatFrame = 0
    this.updateStatusBar()
    this.statusBarItem?.show()

    // Pulse every 1 second (like a heartbeat)
    this.heartbeatAnimationTimer = setInterval(() => {
      this.heartbeatFrame = (this.heartbeatFrame + 1) % frames.length
      this.updateStatusBar()
    }, 1000)
  }

  /**
   * Stop the heart animation
   */
  private stopHeartAnimation(): void {
    if (this.heartbeatAnimationTimer) {
      clearInterval(this.heartbeatAnimationTimer)
      this.heartbeatAnimationTimer = null
    }
    this.statusBarItem?.hide()
  }

  /**
   * Update status bar text
   */
  private updateStatusBar(): void {
    if (!this.statusBarItem) return

    const frames = ["$(heart)", "$(heart-filled)"]
    const heart = frames[this.heartbeatFrame]

    if (this.isPaused) {
      this.statusBarItem.text = "$(heart) zzz"
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
    } else if (this.currentRun) {
      // Currently running a check - show thinking
      this.statusBarItem.text = `${heart} beat...`
      this.statusBarItem.backgroundColor = undefined
    } else {
      this.statusBarItem.text = heart
      this.statusBarItem.backgroundColor = undefined
    }
  }

  /**
   * Start the heartbeat service
   */
  async start(): Promise<void> {
    if (this.isRunning && !this.isPaused) {
      return
    }

    const config = this.stateManager.getConfig()

    if (!config.enabled) {
      return
    }

    // Model must be configured
    if (!config.model || config.model.trim().length === 0) {
      return
    }

    const intervalMs = parseDurationMs(config.every)
    if (!intervalMs || intervalMs <= 0) {
      return
    }

    // Reset error count when starting fresh
    this.stateManager.resetErrors()

    this.isRunning = true
    this.isPaused = false
    this.stateManager.setRunning(true)

    // Start status bar animation
    this.startHeartAnimation()

    // Emit event
    this.emit({ type: "started" })

    // Schedule first beat
    this.scheduleNextBeat(intervalMs)
  }

  /**
   * Stop the heartbeat service
   */
  stop(): void {
    if (!this.isRunning) return

    this.isRunning = false
    this.isPaused = false
    this.stateManager.setRunning(false)
    this.stateManager.setNextRunTime(undefined)

    // Stop status bar animation
    this.stopHeartAnimation()

    // Cancel any running beat
    if (this.cancellationTokenSource) {
      this.cancellationTokenSource.cancel()
      this.cancellationTokenSource = null
    }

    // Clear timer
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.emit({ type: "stopped" })
  }

  /**
   * Pause heartbeat (keeps timer but skips runs)
   */
  pause(): void {
    if (!this.isRunning || this.isPaused) return

    this.isPaused = true
    this.stateManager.setPaused(true)

    this.emit({ type: "paused" })
  }

  /**
   * Resume heartbeat from pause
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) return

    this.isPaused = false
    this.stateManager.setPaused(false)

    this.emit({ type: "resumed" })
  }

  /**
   * Trigger an immediate heartbeat (manual wake)
   */
  async triggerNow(reason?: string): Promise<HeartbeatRunResult> {
    return await this.runBeat()
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean
    isPaused: boolean
    nextRunTime?: Date
    lastRunTime?: Date
    stats: ReturnType<HeartbeatStateManager["getStats"]>
  } {
    const state = this.stateManager.getState()
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      nextRunTime: state.nextRunTime,
      lastRunTime: state.lastRunTime,
      stats: this.stateManager.getStats()
    }
  }

  /**
   * Subscribe to heartbeat events
   */
  onEvent(listener: HeartbeatEventListener): vscode.Disposable {
    this.eventListeners.push(listener)
    return {
      dispose: () => {
        const index = this.eventListeners.indexOf(listener)
        if (index >= 0) {
          this.eventListeners.splice(index, 1)
        }
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: HeartbeatEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        log(`💓 Event listener error: ${error}`)
      }
    }
  }

  /**
   * Schedule the next heartbeat
   */
  private scheduleNextBeat(intervalMs: number): void {
    if (!this.isRunning) return

    // Clear any existing timer first to prevent duplicates
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const nextRunTime = new Date(Date.now() + intervalMs)
    this.stateManager.setNextRunTime(nextRunTime)

    this.timer = setTimeout(async () => {
      // Clear timer reference immediately
      this.timer = null

      const result = await this.runBeat()

      // Only schedule next beat if:
      // 1. Still running
      // 2. The beat actually ran (not skipped due to already-running)
      if (this.isRunning && result.status !== "skipped") {
        const config = this.stateManager.getConfig()
        const newIntervalMs = parseDurationMs(config.every)
        if (newIntervalMs && newIntervalMs > 0) {
          this.scheduleNextBeat(newIntervalMs)
        }
      } else if (
        this.isRunning &&
        result.status === "skipped" &&
        result.reason === "already-running"
      ) {
        // If skipped because already running, try again in 30 seconds
        this.scheduleNextBeat(30000)
      } else if (this.isRunning) {
        // For other skip reasons (paused, outside hours), schedule normal interval
        const config = this.stateManager.getConfig()
        const newIntervalMs = parseDurationMs(config.every)
        if (newIntervalMs && newIntervalMs > 0) {
          this.scheduleNextBeat(newIntervalMs)
        }
      }
    }, intervalMs)
  }

  /**
   * Run a single heartbeat
   */
  private async runBeat(): Promise<HeartbeatRunResult> {
    if (this.currentRun) {
      return { status: "skipped", reason: "already-running" }
    }

    if (this.isPaused) {
      return { status: "skipped", reason: "paused" }
    }

    const config = this.stateManager.getConfig()

    // Check active hours
    if (!isWithinActiveHours(config.activeHours)) {
      await this.recordRun({
        timestamp: new Date(),
        durationMs: 0,
        status: "skipped",
        response: "Outside active hours"
      })
      return { status: "skipped", reason: "outside-active-hours" }
    }

    // Check consecutive errors
    const state = this.stateManager.getState()
    if (state.consecutiveErrors >= config.maxConsecutiveErrors) {
      log(`💓 Too many consecutive errors (${state.consecutiveErrors}), pausing`)
      this.pause()
      return { status: "skipped", reason: "too-many-errors" }
    }

    // Create cancellation token
    this.cancellationTokenSource = new vscode.CancellationTokenSource()

    this.emit({ type: "beat_started" })
    this.updateStatusBar() // Show "checking..." status

    const startTime = Date.now()

    try {
      this.currentRun = (async () => {
        const result = await runHeartbeatLM(config, this.cancellationTokenSource?.token)

        // Record the run
        const record: HeartbeatRunRecord = {
          timestamp: new Date(),
          durationMs: result.durationMs,
          status: result.status,
          response: result.response,
          toolsUsed: result.toolsUsed,
          error: result.error
        }
        await this.recordRun(record)

        // Handle result
        if (result.status === "alert") {
          this.emit({ type: "alert", message: result.response })

          if (config.notifyOnAlert) {
            this.showNotification(result.response, "alert")
          }
        } else if (result.status === "error") {
          log(`💓 ERROR: ${result.error}`)
          this.emit({ type: "error", error: result.error || "Unknown error" })

          if (config.notifyOnError) {
            this.showNotification(result.error || "Heartbeat error", "error")
          }
        }
      })()

      await this.currentRun

      const durationMs = Date.now() - startTime
      const runResult: HeartbeatRunResult = { status: "ran", durationMs }
      this.emit({ type: "beat_completed", result: runResult })

      return runResult
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      log(`💓 Heartbeat failed: ${errorMessage}`)

      await this.recordRun({
        timestamp: new Date(),
        durationMs,
        status: "error",
        error: errorMessage
      })

      return { status: "failed", reason: errorMessage }
    } finally {
      this.currentRun = null
      this.updateStatusBar() // Back to normal heart
      this.cancellationTokenSource = null
    }
  }

  /**
   * Record a run to history
   */
  private async recordRun(record: HeartbeatRunRecord): Promise<void> {
    await this.stateManager.recordRun(record)
  }

  /**
   * Show VS Code notification
   */
  private showNotification(message: string, type: "alert" | "error"): void {
    const truncated = message.length > 200 ? message.substring(0, 200) + "..." : message

    if (type === "error") {
      vscode.window.showErrorMessage(`💓 Heartbeat: ${truncated}`)
    } else {
      vscode.window
        .showInformationMessage(`💓 Heartbeat Alert: ${truncated}`, "View Details")
        .then(selection => {
          if (selection === "View Details") {
            // Open output channel or show full message
            vscode.window.showInformationMessage(message, { modal: true })
          }
        })
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let heartbeatServiceInstance: HeartbeatService | undefined

/**
 * Initialize the heartbeat service
 */
export function initializeHeartbeatService(context: vscode.ExtensionContext): HeartbeatService {
  const stateManager = new HeartbeatStateManager(context)
  heartbeatServiceInstance = new HeartbeatService(context, stateManager)
  return heartbeatServiceInstance
}

/**
 * Get the heartbeat service instance
 */
export function getHeartbeatService(): HeartbeatService | undefined {
  return heartbeatServiceInstance
}
