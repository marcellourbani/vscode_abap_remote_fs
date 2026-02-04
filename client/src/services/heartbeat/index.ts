/**
 * 💓 Heartbeat Module
 *
 * Periodic LLM agent turns for background monitoring.
 * The LLM reads heartbeat.json watchlist and uses available tools to check tasks.
 */

// Types
export {
  HeartbeatConfig,
  HeartbeatRunResult,
  HeartbeatRunRecord,
  HeartbeatServiceState,
  HeartbeatEvent,
  HeartbeatEventListener,
  ActiveHoursConfig,
  HEARTBEAT_OK_TOKEN,
  DEFAULT_HEARTBEAT_CONFIG,
  parseDurationMs,
  formatDuration,
  isWithinActiveHours,
  parseHeartbeatResponse
} from "./heartbeatTypes"

// Watchlist
export { HeartbeatWatchlist, WatchlistTask, HeartbeatWatchlistFile } from "./heartbeatWatchlist"

// State Manager
export { HeartbeatStateManager } from "./heartbeatStateManager"

// LM Client
export { runHeartbeatLM, HeartbeatLMResult } from "./heartbeatLmClient"

// Service
export {
  HeartbeatService,
  initializeHeartbeatService,
  getHeartbeatService
} from "./heartbeatService"

// Tool
export { HeartbeatTool, registerHeartbeatTool, HeartbeatToolParams } from "./heartbeatTool"
