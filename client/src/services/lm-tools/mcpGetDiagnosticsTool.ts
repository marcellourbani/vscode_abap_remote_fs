/**
 * MCP Get Diagnostics Tool
 *
 * MCP-only tool that returns syntax errors/warnings/info for a given ABAP file URI.
 * VS Code Copilot uses its built-in get_errors tool; this provides the same for MCP clients.
 */

import * as vscode from "vscode"
import { triggerSyntaxCheck } from "../../langClient"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IMcpGetDiagnosticsParams {
  /** The full workspace URI of the ABAP source file (e.g. 'adt://dev100/path/to/file.prog.abap'). */
  fileUri: string
}

// ============================================================================
// CORE LOGIC
// ============================================================================

/**
 * Get diagnostics (errors, warnings, info) for a given file URI.
 * Opens the document first to ensure diagnostics are computed, then waits briefly.
 */
export async function getDiagnosticsForUri(fileUri: string): Promise<string> {
  const uri = vscode.Uri.parse(fileUri)

  if (uri.scheme !== "adt") {
    throw new Error(
      `Invalid URI scheme '${uri.scheme}'. Expected 'adt://' URI. ` +
        "Use the get_abap_object_workspace_uri tool to get the correct URI."
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

  if (diagnostics.length === 0) {
    return `No diagnostics found for ${fileUri}. The file has no syntax errors or warnings.`
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

  const lines = diagnostics.map(d => {
    const range = `Line ${d.range.start.line + 1}, Col ${d.range.start.character + 1}`
    const severity = severityLabel(d.severity)
    const source = d.source ? ` [${d.source}]` : ""
    return `${severity} ${range}${source}: ${d.message}`
  })

  const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length
  const warningCount = diagnostics.filter(
    d => d.severity === vscode.DiagnosticSeverity.Warning
  ).length

  const summary = `Found ${diagnostics.length} diagnostic(s): ${errorCount} error(s), ${warningCount} warning(s)\n`

  return summary + "\n" + lines.join("\n")
}
