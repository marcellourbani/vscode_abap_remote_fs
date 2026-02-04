/**
 * 💓 Heartbeat State Manager
 *
 * Handles persistence of heartbeat state and history.
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import {
  HeartbeatServiceState,
  HeartbeatStorageData,
  HeartbeatRunRecord,
  HeartbeatConfig,
  DEFAULT_HEARTBEAT_CONFIG
} from "./heartbeatTypes"
import { log } from "../../lib"

const HEARTBEAT_HISTORY_FILENAME = "heartbeatHistory.json"
const STORAGE_VERSION = 1

/**
 * Manages persistent state for heartbeat service
 */
export class HeartbeatStateManager {
  private context: vscode.ExtensionContext
  private state: HeartbeatServiceState
  private storageUri: vscode.Uri

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.storageUri = context.globalStorageUri
    this.state = {
      isRunning: false,
      isPaused: false,
      runHistory: [],
      consecutiveErrors: 0
    }
    this.ensureStorageExists()
    this.loadState()
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageExists(): void {
    const storagePath = this.storageUri.fsPath
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true })
    }
  }

  /**
   * Get file path for history storage
   */
  private getHistoryFilePath(): string {
    return path.join(this.storageUri.fsPath, HEARTBEAT_HISTORY_FILENAME)
  }

  /**
   * Load state from storage
   */
  private loadState(): void {
    try {
      const filePath = this.getHistoryFilePath()

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8")
        const stored = JSON.parse(data) as HeartbeatStorageData

        // Convert stored data to runtime state
        this.state = {
          isRunning: false, // Always start stopped
          isPaused: false,
          lastRunTime: stored.lastRunTime ? new Date(stored.lastRunTime) : undefined,
          runHistory: stored.runHistory.map(r => ({
            ...r,
            timestamp: new Date(r.timestamp)
          })),
          consecutiveErrors: stored.consecutiveErrors || 0
        }

        log(`💓 Heartbeat state loaded: ${this.state.runHistory.length} history entries`)
      }
    } catch (error) {
      log(`💓 Error loading heartbeat state: ${error}`)
      // Start with fresh state
    }
  }

  /**
   * Save state to storage
   */
  async saveState(): Promise<void> {
    try {
      const config = this.getConfig()

      // Trim history to max size
      while (this.state.runHistory.length > config.maxHistory) {
        this.state.runHistory.shift()
      }

      const stored: HeartbeatStorageData = {
        version: STORAGE_VERSION,
        lastRunTime: this.state.lastRunTime?.toISOString(),
        runHistory: this.state.runHistory.map(r => ({
          ...r,
          timestamp: r.timestamp.toISOString()
        })),
        consecutiveErrors: this.state.consecutiveErrors
      }

      const filePath = this.getHistoryFilePath()
      fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf8")
    } catch (error) {
      log(`💓 Error saving heartbeat state: ${error}`)
    }
  }

  /**
   * Get current heartbeat configuration from settings
   */
  getConfig(): HeartbeatConfig {
    const config = vscode.workspace.getConfiguration("abapfs.heartbeat")

    return {
      enabled: config.get("enabled", DEFAULT_HEARTBEAT_CONFIG.enabled),
      every: config.get("every", DEFAULT_HEARTBEAT_CONFIG.every),
      model: config.get("model", DEFAULT_HEARTBEAT_CONFIG.model),
      prompt: config.get("prompt", DEFAULT_HEARTBEAT_CONFIG.prompt),
      ackMaxChars: config.get("ackMaxChars", DEFAULT_HEARTBEAT_CONFIG.ackMaxChars),
      maxHistory: config.get("maxHistory", DEFAULT_HEARTBEAT_CONFIG.maxHistory),
      maxConsecutiveErrors: config.get(
        "maxConsecutiveErrors",
        DEFAULT_HEARTBEAT_CONFIG.maxConsecutiveErrors
      ),
      activeHours: config.get("activeHours", DEFAULT_HEARTBEAT_CONFIG.activeHours),
      notifyOnAlert: config.get("notifyOnAlert", DEFAULT_HEARTBEAT_CONFIG.notifyOnAlert),
      notifyOnError: config.get("notifyOnError", DEFAULT_HEARTBEAT_CONFIG.notifyOnError)
    }
  }

  /**
   * Get current state
   */
  getState(): HeartbeatServiceState {
    return { ...this.state }
  }

  /**
   * Update running state
   */
  setRunning(isRunning: boolean): void {
    this.state.isRunning = isRunning
  }

  /**
   * Update paused state
   */
  setPaused(isPaused: boolean): void {
    this.state.isPaused = isPaused
  }

  /**
   * Set next run time
   */
  setNextRunTime(time: Date | undefined): void {
    this.state.nextRunTime = time
  }

  /**
   * Record a heartbeat run
   */
  async recordRun(record: HeartbeatRunRecord): Promise<void> {
    this.state.lastRunTime = record.timestamp
    this.state.runHistory.push(record)

    // Track consecutive errors
    if (record.status === "error") {
      this.state.consecutiveErrors++
    } else {
      this.state.consecutiveErrors = 0
    }

    await this.saveState()
  }

  /**
   * Reset consecutive error count
   */
  resetErrors(): void {
    this.state.consecutiveErrors = 0
  }

  /**
   * Get recent history
   */
  getRecentHistory(count: number = 10): HeartbeatRunRecord[] {
    return this.state.runHistory.slice(-count)
  }

  /**
   * Clear all history
   */
  async clearHistory(): Promise<void> {
    this.state.runHistory = []
    this.state.consecutiveErrors = 0
    await this.saveState()
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRuns: number
    successfulRuns: number
    alerts: number
    errors: number
    skipped: number
    lastRunTime?: Date
    averageDurationMs: number
  } {
    const history = this.state.runHistory
    const successful = history.filter(r => r.status === "ok").length
    const alerts = history.filter(r => r.status === "alert").length
    const errors = history.filter(r => r.status === "error").length
    const skipped = history.filter(r => r.status === "skipped").length

    const durations = history.filter(r => r.durationMs > 0).map(r => r.durationMs)
    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

    return {
      totalRuns: history.length,
      successfulRuns: successful,
      alerts,
      errors,
      skipped,
      lastRunTime: this.state.lastRunTime,
      averageDurationMs: Math.round(avgDuration)
    }
  }
}
