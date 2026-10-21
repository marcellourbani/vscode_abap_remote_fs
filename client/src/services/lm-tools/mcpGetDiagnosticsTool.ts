/**
 * MCP Get Diagnostics Tool
 *
 * MCP-only tool that returns syntax errors/warnings/info for a given ABAP file URI.
 * VS Code Copilot uses its built-in get_errors tool; this provides the same for MCP clients.
 */

import * as vscode from "vscode"
import { randomUUID } from "crypto"
import { triggerSyntaxCheck } from "../../langClient"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IMcpGetDiagnosticsParams {
  /** The full workspace URI of the ABAP source file (e.g. 'adt://dev100/path/to/file.prog.abap'). */
  fileUri?: string
  source?: "abapfs" | "abaplint" | "all"
  severity?: "error" | "warning" | "info" | "hint" | "all"
  resultId?: string
  resultStart?: number
  resultEnd?: number
}

type DiagnosticSource = Exclude<IMcpGetDiagnosticsParams["source"], undefined | "all">
type DiagnosticSeverityFilter = Exclude<IMcpGetDiagnosticsParams["severity"], undefined | "all">

interface DiagnosticRecord {
  severity: string
  line: number
  character: number
  source?: string
  message: string
  code?: vscode.Diagnostic["code"]
}

interface CachedDiagnostics {
  expiresAt: number
  fileUri: string
  source?: DiagnosticSource
  severity?: DiagnosticSeverityFilter
  diagnostics: DiagnosticRecord[]
  sourceCounts: Record<string, number>
}

const resultLifetime = 90 * 60 * 1000
const defaultPageSize = 25
const maxPageSize = 100
const maxCachedResults = 20
const cachedResults = new Map<string, CachedDiagnostics>()

function resultRange(startInput?: number, endInput?: number) {
  const start = startInput ?? 1
  const end = endInput ?? start + defaultPageSize - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error(
      "resultStart/resultEnd must be positive integers defining a one-based inclusive range."
    )
  }
  if (end - start + 1 > maxPageSize) {
    throw new Error(`Request at most ${maxPageSize} diagnostics per page.`)
  }
  return { start, end }
}

function pruneResults() {
  for (const [id, result] of cachedResults) {
    if (result.expiresAt <= Date.now()) cachedResults.delete(id)
  }
}

function renderPage(
  resultId: string,
  cached: CachedDiagnostics,
  start: number,
  end: number
): string {
  const diagnostics = cached.diagnostics.slice(start - 1, end)
  const resultEnd = diagnostics.length ? start + diagnostics.length - 1 : null
  const hasMore = end < cached.diagnostics.length
  const severityCounts = Object.fromEntries(
    ["ERROR", "WARNING", "INFO", "HINT", "UNKNOWN"].map(severity => [
      severity,
      cached.diagnostics.filter(diagnostic => diagnostic.severity === severity).length
    ])
  )
  return JSON.stringify(
    {
      resultId,
      expiresAt: new Date(cached.expiresAt).toISOString(),
      fileUri: cached.fileUri,
      filters: { source: cached.source ?? "all", severity: cached.severity ?? "all" },
      summary: {
        totalDiagnostics: cached.diagnostics.length,
        severityCounts,
        availableSources: cached.sourceCounts
      },
      resultStart: diagnostics.length ? start : null,
      resultEnd,
      returned: diagnostics.length,
      hasMore,
      nextStart: hasMore ? end + 1 : null,
      diagnostics
    },
    null,
    2
  )
}

// ============================================================================
// CORE LOGIC
// ============================================================================

/**
 * Get diagnostics (errors, warnings, info) for a given file URI.
 * Opens the document first to ensure diagnostics are computed, then waits briefly.
 */
export async function getDiagnosticsForUri(params: IMcpGetDiagnosticsParams): Promise<string> {
  const { fileUri, source, severity, resultId } = params
  const { start, end } = resultRange(params.resultStart, params.resultEnd)

  pruneResults()
  if (resultId) {
    const cached = cachedResults.get(resultId)
    if (!cached) {
      return JSON.stringify({
        error: "DIAGNOSTICS_RESULT_EXPIRED",
        message:
          "Diagnostics result cache expired or is unavailable. Run get_abap_diagnostics again without resultId.",
        resultId
      })
    }
    if (fileUri && fileUri !== cached.fileUri) {
      throw new Error("resultId belongs to a different fileUri.")
    }
    if (source !== undefined && (source === "all" ? undefined : source) !== cached.source) {
      throw new Error(
        `This result was created with source="${cached.source ?? "all"}". Omit source to keep that filter, or start a new request to change it.`
      )
    }
    if (severity !== undefined && (severity === "all" ? undefined : severity) !== cached.severity) {
      throw new Error(
        `This result was created with severity="${cached.severity ?? "all"}". Omit severity to keep that filter, or start a new request to change it.`
      )
    }
    cached.expiresAt = Date.now() + resultLifetime
    return renderPage(resultId, cached, start, end)
  }

  if (!fileUri) throw new Error("fileUri is required when starting a diagnostics request")
  const uri = vscode.Uri.parse(fileUri)

  if (uri.scheme !== "adt") {
    throw new Error(
      `Invalid URI scheme '${uri.scheme}'. Expected 'adt://' URI. ` +
        "Use the abapfs_get_workspace_uri tool to get the correct URI."
    )
  }

  // Check if the file is already open in an editor tab
  const alreadyOpen = vscode.window.tabGroups.all.some(group =>
    group.tabs.some(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        return tab.input.uri.toString() === uri.toString()
      }
      return false
    })
  )

  let diagnostics: vscode.Diagnostic[]

  if (alreadyOpen) {
    // File is already open - language server already knows about it
    await triggerSyntaxCheck(uri.toString())
    await new Promise(resolve => setTimeout(resolve, 1000))
    diagnostics = vscode.languages.getDiagnostics(uri)
  } else {
    // File not open - must show it to trigger didOpen in language server
    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true })
    } catch {
      throw new Error(`File not found: ${fileUri}`)
    }

    // Wait for language server didOpen + syntax check (server has 500ms delay on didOpen)
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Also explicitly trigger in case the didOpen race was lost
    await triggerSyntaxCheck(uri.toString())
    await new Promise(resolve => setTimeout(resolve, 1000))

    diagnostics = vscode.languages.getDiagnostics(uri)

    // Close the tab we opened to avoid cluttering the editor
    const tabToClose = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .find(tab => {
        if (tab.input instanceof vscode.TabInputText) {
          return tab.input.uri.toString() === uri.toString()
        }
        return false
      })
    if (tabToClose) {
      await vscode.window.tabGroups.close(tabToClose)
    }
  }

  const severityLabel = (s: vscode.DiagnosticSeverity): string => {
    switch (s) {
      case vscode.DiagnosticSeverity.Error:
        return "ERROR"
      case vscode.DiagnosticSeverity.Warning:
        return "WARNING"
      case vscode.DiagnosticSeverity.Information:
        return "INFO"
      case vscode.DiagnosticSeverity.Hint:
        return "HINT"
      default:
        return "UNKNOWN"
    }
  }

  const sourceCounts: Record<string, number> = {}
  const records = diagnostics.map(diagnostic => {
    const sourceName = diagnostic.source || "(unknown)"
    sourceCounts[sourceName] = (sourceCounts[sourceName] || 0) + 1
    return {
      severity: severityLabel(diagnostic.severity),
      line: diagnostic.range.start.line + 1,
      character: diagnostic.range.start.character + 1,
      ...(diagnostic.source ? { source: diagnostic.source } : {}),
      message: diagnostic.message,
      ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {})
    }
  })
  const filtered = records.filter(diagnostic => {
    if (source && source !== "all" && diagnostic.source?.toLowerCase() !== source) return false
    if (severity && severity !== "all" && diagnostic.severity.toLowerCase() !== severity) {
      return false
    }
    return true
  })

  const id = randomUUID()
  const cached: CachedDiagnostics = {
    expiresAt: Date.now() + resultLifetime,
    fileUri,
    source: source && source !== "all" ? source : undefined,
    severity: severity && severity !== "all" ? severity : undefined,
    diagnostics: filtered,
    sourceCounts
  }
  while (cachedResults.size >= maxCachedResults) {
    const oldest = cachedResults.keys().next().value
    if (oldest) cachedResults.delete(oldest)
  }
  cachedResults.set(id, cached)
  return renderPage(id, cached, start, end)
}
