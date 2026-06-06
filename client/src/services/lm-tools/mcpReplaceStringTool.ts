
/**
 * MCP Replace String in ABAP Object Tool
 *
 * This tool is MCP-only (not a VS Code LM tool). It enables external AI clients
 * (Cursor, Claude Code, Cline, etc.) to edit ABAP source code by performing
 * find-and-replace operations on files identified by their workspace URI.
 *
 * When VS Code Copilot edits ABAP files, it uses its built-in replace_string_in_file
 * tool which operates on the adt:// filesystem. External MCP clients don't have
 * access to those built-in tools, so this tool provides equivalent functionality.
 *
 * Flow:
 * 1. AI gets workspace URI via get_abap_object_workspace_uri tool
 * 2. AI reads current content via get_abap_object_lines
 * 3. AI calls this tool with the URI, oldString, and newString
 * 4. This tool reads the file, validates the match, replaces, and writes back
 * 5. The adt:// filesystem provider handles locking, transport selection, and SAP sync
 */

import * as vscode from "vscode"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IMcpReplaceStringParams {
  /** The full workspace URI of the ABAP source file (e.g. 'adt://dev100/path/to/file.prog.abap').
   * Get this URI using the get_abap_object_workspace_uri tool. */
  fileUri: string
  /** The exact literal text to find and replace. Must match exactly one occurrence in the file.
   * Include enough context (3-5 surrounding lines) to ensure uniqueness. Cannot be empty. */
  oldString: string
  /** The replacement text. The resulting code must be syntactically valid ABAP. */
  newString: string
}

// ============================================================================
// CORE LOGIC
// ============================================================================

/**
 * Perform a single find-and-replace on file content.
 * Returns the updated content or throws if match is not exactly 1.
 */
export function findAndReplace(content: string, oldString: string, newString: string): string {
  if (!oldString) {
    // Empty oldString is only allowed when the current file is completely blank
    // (e.g. a freshly created ABAP object with no source yet).
    if (content.length === 0) {
      return newString
    }
    throw new Error(
      "oldString can only be empty when the file is currently completely blank. " +
      "The file has existing content, so oldString is mandatory. " +
      "Read the current content with get_abap_object_lines first and include the exact text to replace."
    )
  }

  if (oldString === newString) {
    throw new Error("oldString and newString are identical. No change would be made.")
  }

  // Count occurrences
  let count = 0
  let searchIdx = 0
  while (true) {
    const idx = content.indexOf(oldString, searchIdx)
    if (idx === -1) break
    count++
    searchIdx = idx + oldString.length
  }

  if (count === 0) {
    // Try with normalized line endings
    const normalizedContent = content.replace(/\r\n/g, "\n")
    const normalizedOld = oldString.replace(/\r\n/g, "\n")
    if (normalizedContent.includes(normalizedOld)) {
      // Match found after EOL normalization - do the replacement on original content
      const normalizedNew = newString.replace(/\r\n/g, "\n")
      const updated = normalizedContent.replace(normalizedOld, normalizedNew)
      // Restore original EOL style if content had \r\n
      if (content.includes("\r\n")) {
        return updated.replace(/(?<!\r)\n/g, "\r\n")
      }
      return updated
    }
    throw new Error(
      "Could not find the specified oldString in the file. " +
      "Make sure the text matches exactly (including whitespace and indentation). " +
      "Use get_abap_object_lines or search_abap_object_lines to read the current file content first."
    )
  }

  if (count > 1) {
    throw new Error(
      `Found ${count} occurrences of oldString. It must match exactly one location. ` +
      "Include more surrounding context lines to make the match unique."
    )
  }

  // Exactly one match - do the replacement
  return content.replace(oldString, newString)
}

/**
 * Execute the replace operation against the VS Code filesystem.
 * This goes through the adt:// filesystem provider which handles
 * locking, transport selection, and syncing to SAP.
 */
export async function executeReplace(
  fileUri: string,
  oldString: string,
  newString: string
): Promise<string> {
  const uri = vscode.Uri.parse(fileUri)

  // Validate URI scheme
  if (uri.scheme !== "adt") {
    throw new Error(
      `Invalid URI scheme '${uri.scheme}'. Expected 'adt://' URI. ` +
      "Use the get_abap_object_workspace_uri tool to get the correct URI."
    )
  }

  // Read current file content
  const contentBytes = await vscode.workspace.fs.readFile(uri)
  const currentContent = Buffer.from(contentBytes).toString("utf8")

  // Perform the replacement
  const updatedContent = findAndReplace(currentContent, oldString, newString)

  // Write back through the filesystem provider (handles lock/transport/sync)
  // IMPORTANT: Must use Buffer.from() not TextEncoder - the FsProvider calls
  // content.toString() which only decodes UTF-8 correctly on Buffer, not Uint8Array
  await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedContent, "utf8"))

  return updatedContent
}
