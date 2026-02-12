/**
 * ABAP FS Documentation Tool
 * Access extension documentation and settings reference
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IDocumentationToolParameters {
  action: "get_documentation" | "search_documentation" | "get_settings" | "search_settings"
  searchQuery?: string
  startLine?: number
  lineCount?: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Read lines from a file
 */
function readFileLines(filePath: string, startLine: number, lineCount: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")
    
    // 1-based to 0-based conversion
    const start = Math.max(0, startLine - 1)
    const end = Math.min(lines.length, start + lineCount)
    
    const selectedLines = lines.slice(start, end)
    const totalLines = lines.length
    
    const header = `Lines ${startLine}-${start + selectedLines.length} of ${totalLines}:\n${"=".repeat(60)}\n\n`
    return header + selectedLines.join("\n")
  } catch (error) {
    throw new Error(`Failed to read file: ${error}`)
  }
}

/**
 * Search for text in file and return matching lines with context
 * Splits search query by spaces and finds lines matching ANY of the words
 */
function searchFileLines(
  filePath: string,
  searchQuery: string,
  contextLines: number = 3
): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")
    
    // Split search query by spaces and convert to lowercase
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(term => term.length > 0)
    
    const matches: Array<{ lineNumber: number; line: string; context: string[]; matchedTerms: string[] }> = []
    const matchedLineNumbers = new Set<number>()
    
    // Find all matching lines for each search term
    for (const searchTerm of searchTerms) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(searchTerm) && !matchedLineNumbers.has(i + 1)) {
          // Get context lines before and after
          const contextStart = Math.max(0, i - contextLines)
          const contextEnd = Math.min(lines.length, i + contextLines + 1)
          const contextLinesArray = lines.slice(contextStart, contextEnd)
          
          // Find which terms matched this line
          const matchedTerms = searchTerms.filter(term => 
            lines[i].toLowerCase().includes(term)
          )
          
          matches.push({
            lineNumber: i + 1, // 1-based
            line: lines[i],
            context: contextLinesArray,
            matchedTerms
          })
          matchedLineNumbers.add(i + 1)
        }
      }
    }
    
    if (matches.length === 0) {
      return `No matches found for: "${searchQuery}" (searched for: ${searchTerms.join(", ")})`
    }
    
    // Sort by line number
    matches.sort((a, b) => a.lineNumber - b.lineNumber)
    
    // Format results
    let result = `Found ${matches.length} match(es) for: "${searchQuery}"\n`
    result += `Search terms: ${searchTerms.join(", ")}\n`
    result += `${"=".repeat(60)}\n\n`
    
    for (const match of matches) {
      result += `📍 Line ${match.lineNumber} (matched: ${match.matchedTerms.join(", ")}):\n`
      result += `${"-".repeat(40)}\n`
      result += match.context.join("\n")
      result += `\n\n`
    }
    
    return result
  } catch (error) {
    throw new Error(`Failed to search file: ${error}`)
  }
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📚 ABAP FS DOCUMENTATION TOOL
 */
export class ABAPFSDocumentationTool implements vscode.LanguageModelTool<IDocumentationToolParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDocumentationToolParameters>,
    _token: vscode.CancellationToken
  ) {
    const { action, searchQuery, startLine = 1, lineCount = 50 } = options.input
    
    let message = ""
    switch (action) {
      case "get_documentation":
        message = `Reading ABAP FS DOCUMENTATION lines ${startLine}-${startLine + lineCount - 1}`
        break
      case "search_documentation":
        message = `Searching ABAP FS DOCUMENTATION for: "${searchQuery}"`
        break
      case "get_settings":
        message = `Reading ABAP FS settings lines ${startLine}-${startLine + lineCount - 1}`
        break
      case "search_settings":
        message = `Searching ABAP FS settings for: "${searchQuery}"`
        break
    }
    
    return {
      invocationMessage: message
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDocumentationToolParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { action, searchQuery, startLine = 1, lineCount = 50 } = options.input
    
    // Get extension path
    const extension = vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")
    if (!extension) {
      throw new Error("ABAP FS extension not found")
    }
    
    const extensionPath = extension.extensionPath
    const docsPath = path.join(extensionPath, "DOCUMENTATION.md")
    const settingsPath = path.join(extensionPath, "ABAP-FS-SETTINGS.md")
    
    let result = ""
    
    try {
      switch (action) {
        case "get_documentation":
          if (!fs.existsSync(docsPath)) {
            throw new Error("DOCUMENTATION.md not found in extension directory")
          }
          result = readFileLines(docsPath, startLine, lineCount)
          break
          
        case "search_documentation":
          if (!searchQuery) {
            throw new Error("searchQuery is required for search_documentation action")
          }
          if (!fs.existsSync(docsPath)) {
            throw new Error("DOCUMENTATION.md not found in extension directory")
          }
          result = searchFileLines(docsPath, searchQuery, 3)
          break
          
        case "get_settings":
          if (!fs.existsSync(settingsPath)) {
            throw new Error("ABAP-FS-SETTINGS.md not found in extension directory")
          }
          result = readFileLines(settingsPath, startLine, lineCount)
          break
          
        case "search_settings":
          if (!searchQuery) {
            throw new Error("searchQuery is required for search_settings action")
          }
          if (!fs.existsSync(settingsPath)) {
            throw new Error("ABAP-FS-SETTINGS.md not found in extension directory")
          }
          result = searchFileLines(settingsPath, searchQuery, 3)
          break
          
        default:
          throw new Error(`Unknown action: ${action}`)
      }
      
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Documentation tool error: ${error}`)
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerDocumentationTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool("abap_fs_documentation", new ABAPFSDocumentationTool())
  )
}
