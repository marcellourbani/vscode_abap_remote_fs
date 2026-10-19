/**
 * Replace String in ABAP Object Tool
 *
 * Edits ABAP source code by performing find-and-replace operations on files identified
 * by their workspace URI. Registered as an LM tool tagged abap-fs, so it serves Copilot
 * (including harnesses whose built-in edit tools cannot write adt:// files) and, through
 * the ABAP FS MCP server, external clients such as Claude Code or Cursor.
 *
 * Flow:
 * 1. AI gets workspace URI via abapfs_get_workspace_uri tool
 * 2. AI reads current content via abapfs_get_object_source
 * 3. AI calls this tool with the URI, oldString, and newString
 * 4. This tool reads the file, validates the match, replaces, and writes back
 * 5. The adt:// filesystem provider handles locking, transport selection, and SAP sync
 */

import * as vscode from "vscode"
import { isAbapFile } from "abapfs"
import { getClient, getOrCreateRoot } from "../../adt/conections"
import { TransportIntentService, type ObjectSaveTransportChoice } from "../transportIntentService"
import { RE_READ_ADVICE, verifyInactiveSource } from "../inactiveSourceVerification"
import { serializeObjectWrite } from "../objectWriteQueue"
import { recordAbapEdit } from "../editReview"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IReplaceStringParams {
  /** The full workspace URI of the ABAP source file (e.g. 'adt://dev100/path/to/file.prog.abap').
   * Get this URI using the abapfs_get_workspace_uri tool. */
  fileUri: string
  /** The exact literal text to find and replace. Must match exactly one occurrence in the file.
   * Include enough context (3-5 surrounding lines) to ensure uniqueness. Cannot be empty. */
  oldString: string
  /** The replacement text. The resulting code must be syntactically valid ABAP. */
  newString: string
  transportChoice?: Exclude<ObjectSaveTransportChoice, { type: "local" }>
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
        "Read the current content with abapfs_get_object_source first and include the exact text to replace."
    )
  }

  if (oldString === newString) {
    throw new Error("oldString and newString are identical. No change would be made.")
  }

  const count = countOccurrences(content, oldString)

  if (count === 0) {
    // Try with normalized line endings
    const normalizedContent = content.replace(/\r\n/g, "\n")
    const normalizedOld = oldString.replace(/\r\n/g, "\n")
    const normalizedCount = countOccurrences(normalizedContent, normalizedOld)
    if (normalizedCount > 0) {
      assertUniqueMatch(normalizedCount)
      // Match found after EOL normalization - replace literally and preserve EOL style
      const normalizedNew = newString.replace(/\r\n/g, "\n")
      const updated = normalizedContent.replace(normalizedOld, () => normalizedNew)
      // Restore original EOL style if content had \r\n
      if (content.includes("\r\n")) {
        return updated.replace(/(?<!\r)\n/g, "\r\n")
      }
      return updated
    }
    throw new Error(
      "Could not find the specified oldString in the file. " +
        "Make sure the text matches exactly (including whitespace and indentation). " +
        "Use abapfs_get_object_source or abapfs_search_object_source to read the current file content first."
    )
  }

  assertUniqueMatch(count)
  return content.replace(oldString, () => newString)
}

function countOccurrences(content: string, search: string): number {
  let count = 0
  let offset = 0
  while (true) {
    const index = content.indexOf(search, offset)
    if (index < 0) return count
    count++
    offset = index + search.length
  }
}

function assertUniqueMatch(count: number): void {
  if (count > 1) {
    throw new Error(
      `Found ${count} occurrences of oldString. It must match exactly one location. ` +
        "Include more surrounding context lines to make the match unique."
    )
  }
}

/** Called inside the per-object write queue, so concurrent edits are reported in the order they were saved */
export type ReplaceAppliedCallback = (
  uri: vscode.Uri,
  before: string,
  after: string
) => Promise<void> | void

/**
 * Execute the replace operation against the VS Code filesystem.
 * This goes through the adt:// filesystem provider which handles
 * locking, transport selection, and syncing to SAP.
 */
export async function executeReplace(
  fileUri: string,
  oldString: string,
  newString: string,
  transportChoice?: Exclude<ObjectSaveTransportChoice, { type: "local" }>,
  onApplied?: ReplaceAppliedCallback
): Promise<string> {
  const uri = vscode.Uri.parse(fileUri)

  // Validate URI scheme
  if (uri.scheme !== "adt") {
    throw new Error(
      `Invalid URI scheme '${uri.scheme}'. Expected 'adt://' URI. ` +
        "Use the abapfs_get_workspace_uri tool to get the correct URI."
    )
  }

  return serializeObjectWrite(uri, () =>
    replaceAndVerify(uri, oldString, newString, transportChoice, onApplied)
  )
}

async function replaceAndVerify(
  uri: vscode.Uri,
  oldString: string,
  newString: string,
  transportChoice?: Exclude<ObjectSaveTransportChoice, { type: "local" }>,
  onApplied?: ReplaceAppliedCallback
): Promise<string> {
  // Read current file content
  const contentBytes = await vscode.workspace.fs.readFile(uri)
  const currentContent = Buffer.from(contentBytes).toString("utf8")

  // Perform the replacement
  const updatedContent = findAndReplace(currentContent, oldString, newString)
  const intent = transportChoice
    ? TransportIntentService.get().register({
        objectUri: uri,
        process: "normal-edit",
        transportChoice
      })
    : undefined

  // Write back through the filesystem provider (handles lock/transport/sync)
  // IMPORTANT: Must use Buffer.from() not TextEncoder - the FsProvider calls
  // content.toString() which only decodes UTF-8 correctly on Buffer, not Uint8Array
  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedContent, "utf8"))
  } catch (error) {
    if (intent) TransportIntentService.get().fail(intent.intentId, error)
    throw error
  }
  // SAP has the new source even if the verification below fails, so it must be reviewable
  await onApplied?.(uri, currentContent, updatedContent)

  const connectionId = uri.authority.toLowerCase()
  const path = await savedSourcePath(connectionId, uri.path).catch(error => {
    throw new Error(
      `SAP accepted the write, but it could not be verified: ${error?.message || error}. ${RE_READ_ADVICE}`
    )
  })
  const readInactive = () =>
    getClient(connectionId).statelessClone.getObjectSource(path, { version: "inactive" })
  await verifyInactiveSource(readInactive, updatedContent, currentContent)

  return updatedContent
}

/** The tree can be refreshed while saving, leaving a node whose metadata is not loaded yet */
async function savedSourcePath(connectionId: string, path: string) {
  const root = await getOrCreateRoot(connectionId)
  const node = await root.getNodeAsync(path)
  if (!isAbapFile(node)) throw new Error("the saved ABAP resource could not be resolved")
  if (!node.object.structure) await node.object.loadStructure()
  return node.object.contentsPath()
}

// ============================================================================
// TOOL CLASS
// ============================================================================

export const REPLACE_STRING_TOOL_NAME = "replace_string_in_abap_object"

export class ReplaceStringInAbapObjectTool implements vscode.LanguageModelTool<IReplaceStringParams> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IReplaceStringParams>,
    _token: vscode.CancellationToken
  ) {
    const name = options.input.fileUri?.split("/").pop() || options.input.fileUri
    return { invocationMessage: `Editing ${name}` }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IReplaceStringParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const { fileUri, oldString, newString, transportChoice } = options.input
    if (!fileUri) throw new Error("fileUri is required")
    if (newString === undefined || newString === null) {
      throw new Error("newString is required (use empty string to delete text)")
    }

    await executeReplace(fileUri, oldString ?? "", newString, transportChoice, recordAbapEdit)

    const oldLineCount = (oldString ?? "").split("\n").length
    const newLineCount = newString.split("\n").length
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Successfully replaced ${oldLineCount} line(s) with ${newLineCount} line(s) in ${fileUri}\n\n` +
          "The file has been saved and synced to SAP."
      )
    ])
  }
}

export function registerReplaceStringTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry(REPLACE_STRING_TOOL_NAME, new ReplaceStringInAbapObjectTool())
  )
}
