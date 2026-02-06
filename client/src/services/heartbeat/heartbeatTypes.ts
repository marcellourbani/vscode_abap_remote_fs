/**
 * 💓 Heartbeat Types
 *
 * Periodic LLM agent turns for background monitoring.
 * The LLM reads heartbeat.json watchlist and uses available tools to check tasks.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Heartbeat run result
 */
export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number; response?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }

/**
 * A single heartbeat run record
 */
export interface HeartbeatRunRecord {
  timestamp: Date
  durationMs: number
  status: "ok" | "alert" | "error" | "skipped"
  response?: string
  toolsUsed?: string[]
  error?: string
}

/**
 * Heartbeat service state
 */
export interface HeartbeatServiceState {
  isRunning: boolean
  isPaused: boolean
  lastRunTime?: Date
  nextRunTime?: Date
  runHistory: HeartbeatRunRecord[]
  consecutiveErrors: number
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Active hours configuration
 */
export interface ActiveHoursConfig {
  /** Start time in 24h format (e.g., "08:00") */
  start: string
  /** End time in 24h format (e.g., "22:00"). Use "24:00" for end of day */
  end: string
  /** Timezone: "local", "utc", or IANA timezone (e.g., "America/New_York") */
  timezone?: string
}

/**
 * Heartbeat configuration from settings.json
 */
export interface HeartbeatConfig {
  /** Is heartbeat feature enabled? */
  enabled: boolean

  /** Interval between heartbeats (e.g., "5m", "30m", "1h") */
  every: string

  /** Language model to use (e.g., "Claude Sonnet 4", "GPT-4o") */
  model: string

  /** Custom prompt (overrides watchlist-based prompt) */
  prompt?: string

  /** Maximum characters allowed after HEARTBEAT_OK before delivery */
  ackMaxChars: number

  /** Maximum history entries to keep */
  maxHistory: number

  /** Max consecutive errors before auto-pause */
  maxConsecutiveErrors: number

  /** Active hours window (optional) */
  activeHours?: ActiveHoursConfig

  /** Show notifications for alerts */
  notifyOnAlert: boolean

  /** Show notifications for errors */
  notifyOnError: boolean
}

/**
 * Default configuration values
 */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: false, // Opt-in feature
  every: "30m",
  model: "", // Will be selected at runtime
  ackMaxChars: 300,
  maxHistory: 100,
  maxConsecutiveErrors: 5,
  notifyOnAlert: true,
  notifyOnError: true
}

/**
 * The magic token that signals "nothing needs attention"
 */
export const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK"

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Serializable state for storage
 */
export interface HeartbeatStorageData {
  version: number
  lastRunTime?: string
  runHistory: Array<{
    timestamp: string
    durationMs: number
    status: "ok" | "alert" | "error" | "skipped"
    response?: string
    toolsUsed?: string[]
    error?: string
  }>
  consecutiveErrors: number
}

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Events emitted by the heartbeat service
 */
export type HeartbeatEvent =
  | { type: "started" }
  | { type: "stopped" }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "beat_started" }
  | { type: "beat_completed"; result: HeartbeatRunResult }
  | { type: "alert"; message: string }
  | { type: "error"; error: string }

export type HeartbeatEventListener = (event: HeartbeatEvent) => void

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse duration string to milliseconds
 * Supports: 5m, 30m, 1h, 2h, etc.
 */
export function parseDurationMs(duration: string): number | null {
  const match = duration
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours|s|sec|secs|seconds)?$/i)
  if (!match) return null

  const value = parseFloat(match[1])
  const unit = (match[2] || "m").toLowerCase()

  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "seconds":
      return value * 1000
    case "m":
    case "min":
    case "mins":
    case "minutes":
      return value * 60 * 1000
    case "h":
    case "hr":
    case "hrs":
    case "hours":
      return value * 60 * 60 * 1000
    default:
      return value * 60 * 1000 // Default to minutes
  }
}

/**
 * Format milliseconds as human-readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

/**
 * Check if current time is within active hours
 */
export function isWithinActiveHours(config?: ActiveHoursConfig): boolean {
  if (!config) return true

  const now = new Date()
  let hours: number
  let minutes: number

  // For now, use local time. TODO: Add timezone support
  hours = now.getHours()
  minutes = now.getMinutes()

  const currentMinutes = hours * 60 + minutes

  const [startH, startM] = config.start.split(":").map(Number)
  const [endH, endM] = config.end.split(":").map(Number)

  const startMinutes = startH * 60 + startM
  let endMinutes = endH * 60 + endM

  // Handle "24:00" as end of day
  if (endH === 24) endMinutes = 24 * 60

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

/**
 * Extract HEARTBEAT_OK from response and determine if it's an ack
 */
export function parseHeartbeatResponse(
  response: string,
  _ackMaxChars: number
): {
  isAck: boolean
  cleanedResponse: string
  hasAlert: boolean
} {
  const trimmed = response.trim()

  // Simple check: if response contains HEARTBEAT_OK, it's an ack
  const containsToken = trimmed.toUpperCase().includes(HEARTBEAT_OK_TOKEN)

  if (containsToken) {
    return { isAck: true, cleanedResponse: "", hasAlert: false }
  }

  // No token = alert
  return { isAck: false, cleanedResponse: trimmed, hasAlert: true }
}
