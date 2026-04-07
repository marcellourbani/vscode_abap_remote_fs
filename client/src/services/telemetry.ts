/**
 * ABAP FS Telemetry Service
 * Centralized telemetry collection and storage
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"
import { AppInsightsService } from "./appInsightsService"
import { incrementReviewCounter } from "./reviewPrompt"

interface TelemetryEntry {
  timestamp: string // ISO format
  sessionId: string // Extension session
  userId: string // Anonymous hash
  action: string // "command_xxx_called" or "tool_xxx_called"
  version: string // Extension version
}

export class TelemetryService {
  private static instance: TelemetryService
  private sessionId: string
  private userId: string
  private version: string
  private buffer: TelemetryEntry[] = []
  private flushInterval: NodeJS.Timeout | null = null
  private telemetryDir: string
  private isFlushInProgress: boolean = false
  private maxBufferSize: number = 1000

  private constructor(context: vscode.ExtensionContext) {
    // Generate session ID using cryptographically secure random UUID
    this.sessionId = `session-${Date.now()}-${crypto.randomUUID()}`

    // Generate anonymous user ID (hash of machine info)
    const machineInfo = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`
    this.userId = `user-${crypto.createHash("sha256").update(machineInfo).digest("hex").substring(0, 16)}`

    // Get extension version
    this.version =
      vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")?.packageJSON?.version ||
      "unknown"

    // Setup telemetry directory
    this.telemetryDir = path.join(context.globalStorageUri.fsPath, "telemetry")
    this.ensureTelemetryDir()

    // Start periodic flush (every 5 minutes)
    this.startPeriodicFlush()

    // Flush on extension deactivation
    context.subscriptions.push(
      new vscode.Disposable(() => {
        this.flushToFile()
        if (this.flushInterval) {
          clearInterval(this.flushInterval)
        }
      })
    )
  }

  public static initialize(context: vscode.ExtensionContext): void {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService(context)
    }
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      throw new Error("TelemetryService not initialized. Call initialize() first.")
    }
    return TelemetryService.instance
  }

  /**
   * Log a telemetry event
   * @param action - Action description (e.g., "command_activate_called", "tool_create_test_include_called")
   */
  public log(action: string): void {
    const entry: TelemetryEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId: this.userId,
      action: action,
      version: this.version
    }

    this.buffer.push(entry)

    // Prevent memory leaks - drop old entries if buffer gets too large
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize)
    }

    // If buffer gets large, flush immediately (but don't block if already flushing)
    if (this.buffer.length >= 25 && !this.isFlushInProgress) {
      this.flushToFile()
    }
  }

  private ensureTelemetryDir(): void {
    try {
      if (!fs.existsSync(this.telemetryDir)) {
        fs.mkdirSync(this.telemetryDir, { recursive: true })
      }
    } catch (error) {
      console.error("Failed to create telemetry directory:", error)
    }
  }

  private startPeriodicFlush(): void {
    // Flush every 5 minutes
    this.flushInterval = setInterval(
      () => {
        this.flushToFile()
      },
      5 * 60 * 1000
    )
  }

  private flushToFile(): void {
    if (this.buffer.length === 0 || this.isFlushInProgress) return

    // Prevent concurrent flushes
    this.isFlushInProgress = true

    // Copy buffer and clear it immediately to prevent race conditions
    const entriesToFlush = [...this.buffer]
    this.buffer = []

    // Use async operation to prevent blocking
    setImmediate(async () => {
      try {
        const today = new Date().toISOString().split("T")[0] // YYYY-MM-DD
        const filename = `telemetry-${today}.csv`
        const filepath = path.join(this.telemetryDir, filename)

        // Create CSV header if file doesn't exist
        let csvContent = ""
        if (!fs.existsSync(filepath)) {
          csvContent = "timestamp,sessionId,userId,action,version\n"
        }

        // Add entries to flush
        for (const entry of entriesToFlush) {
          csvContent += `${entry.timestamp},${entry.sessionId},${entry.userId},${entry.action},${entry.version}\n`
        }

        // Use async write to prevent blocking
        await fs.promises.appendFile(filepath, csvContent, "utf8")
      } catch (error) {
        console.error("Failed to flush telemetry to file:", error)
        // Re-add failed entries to buffer (at the beginning to maintain order)
        this.buffer.unshift(...entriesToFlush)

        // Prevent infinite buffer growth on persistent failures
        if (this.buffer.length > this.maxBufferSize) {
          this.buffer = this.buffer.slice(0, this.maxBufferSize)
        }
      } finally {
        this.isFlushInProgress = false
      }
    })
  }

  /**
   * Get telemetry statistics (for debugging)
   */
  public getStats(): { bufferSize: number; sessionId: string; userId: string; version: string } {
    return {
      bufferSize: this.buffer.length,
      sessionId: this.sessionId,
      userId: this.userId,
      version: this.version
    }
  }
}


const toolContextKeys: Record<string, string> = {
  // Search & discovery
  tool_search_abap_objects_called: "abapfs:toolUsed:search",
  tool_search_abap_object_lines_called: "abapfs:toolUsed:searchLines",
  // Reading source code
  tool_get_abap_object_lines_called: "abapfs:toolUsed:read",
  tool_get_batch_lines_called: "abapfs:toolUsed:read",
  tool_get_object_by_uri_called: "abapfs:toolUsed:read",
  // Object metadata
  tool_get_abap_object_info_called: "abapfs:toolUsed:objectInfo",
  tool_get_abap_object_workspace_uri_called: "abapfs:toolUsed:objectInfo",
  tool_get_abap_object_url_called: "abapfs:toolUsed:objectInfo",
  tool_open_object_called: "abapfs:toolUsed:openObject",
  // Where-used analysis
  tool_find_where_used_called: "abapfs:toolUsed:whereUsed",
  // Version history
  tool_version_history_called: "abapfs:toolUsed:versionHistory",
  // Data query
  tool_execute_data_query_called: "abapfs:toolUsed:dataQuery",
  tool_get_abap_sql_syntax_called: "abapfs:toolUsed:dataQuery",
  // ATC / quality
  tool_run_atc_analysis_called: "abapfs:toolUsed:atc",
  tool_get_atc_decorations_called: "abapfs:toolUsed:atc",
  // Unit tests
  tool_run_unit_tests_called: "abapfs:toolUsed:unitTests",
  tool_create_test_include_called: "abapfs:toolUsed:unitTests",
  tool_create_test_documentation_called: "abapfs:toolUsed:unitTests",
  // Transports
  tool_manage_transport_requests_called: "abapfs:toolUsed:transports",
  // Object creation
  tool_create_abap_object_called: "abapfs:toolUsed:createObject",
  // Text elements
  tool_manage_text_elements_called: "abapfs:toolUsed:textElements",
  // Debugging (grouped — 6 debug tools + dump + trace analysis)
  tool_debug_session_called: "abapfs:toolUsed:debug",
  tool_debug_breakpoint_called: "abapfs:toolUsed:debug",
  tool_debug_step_called: "abapfs:toolUsed:debug",
  tool_debug_variable_called: "abapfs:toolUsed:debug",
  tool_debug_stack_called: "abapfs:toolUsed:debug",
  tool_debug_status_called: "abapfs:toolUsed:debug",
  tool_analyze_abap_dumps_called: "abapfs:toolUsed:dumpAnalysis",
  tool_analyze_abap_traces_called: "abapfs:toolUsed:traceAnalysis",
  // Mermaid diagrams
  tool_create_mermaid_diagram_called: "abapfs:toolUsed:mermaid",
  tool_validate_mermaid_syntax_called: "abapfs:toolUsed:mermaid",
  tool_get_mermaid_documentation_called: "abapfs:toolUsed:mermaid",
  tool_detect_mermaid_diagram_type_called: "abapfs:toolUsed:mermaid",
  // System info & connected systems
  tool_get_sap_system_info_called: "abapfs:toolUsed:systemInfo",
  tool_get_connected_systems_called: "abapfs:toolUsed:connectedSystems",
  // Heartbeat & subagents
  tool_manage_heartbeat_called: "abapfs:toolUsed:heartbeat",
  tool_manage_subagents_called: "abapfs:toolUsed:subagents",
  // Documentation
  tool_abapfs_documentation_called: "abapfs:toolUsed:documentation",
  // Activate
  tool_abap_activate_called: "abapfs:toolUsed:activate"
}

/**
 * Convenience function for logging telemetry
 * @param action - Action description (e.g., "command_activate_called", "tool_create_test_include_called")
 */
function shouldCountForReviewPrompt(action: string): boolean {
  return action.startsWith("command_") || action.startsWith("tool_")
}

export function logTelemetry(
  action: string,
  options?: {
    connectionId?: string
    activeEditor?: vscode.TextEditor
    username?: string
  }
): void {
  try {
    // Existing CSV logging
    TelemetryService.getInstance().log(action)

    // Send to App Insights with context
    AppInsightsService.getInstance().track(action, options)

    // Set walkthrough context keys for specific tool invocations
    const contextKey = toolContextKeys[action]
    if (contextKey) {
      vscode.commands.executeCommand("setContext", contextKey, true)
    }

    // Only explicit user actions should count toward the review prompt.
    if (shouldCountForReviewPrompt(action)) {
      incrementReviewCounter()
    }
  } catch (error) {
    // Silently fail - telemetry should never break functionality
    console.error("Telemetry logging failed:", error)
  }
}
