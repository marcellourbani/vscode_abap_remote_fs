/**
 * MCP-only tool: update_abap_source
 *
 * Replaces the full source code of an existing ABAP object and automatically
 * activates it. Designed for external AI agents talking to the MCP server —
 * NOT exposed to Copilot (it is registered in the MCP-only registry, not via
 * vscode.lm.registerTool / package.json contributions).
 *
 * Flow:
 *   1. Validate the adt:// workspace URI and resolve the AbapFile node.
 *   2. Refuse if the user has unsaved edits to the same object in VS Code
 *      (avoid clobbering them).
 *   3. Write through the FileSystemProvider, which transparently handles
 *      lock acquisition, transport-request selection (a dialog may appear
 *      in VS Code), unlock, and relogin.
 *   4. Activate non-interactively via AdtObjectActivator.
 *   5. On activation failure: keep the saved source (object stays inactive),
 *      return the structured summary/details so the agent can fix the source
 *      and call this tool again — closing the loop without human help.
 */

import * as vscode from "vscode"
import { isAbapFile } from "abapfs"
import { getOrCreateRoot } from "../../adt/conections"
import { AdtObjectActivator } from "../../adt/operations/AdtObjectActivator"
import { logTelemetry } from "../telemetry"
import { registerMcpOnlyTool } from "./mcpOnlyRegistry"

interface IUpdateAbapSourceParams {
  workspaceUri: string
  source: string
}

const TOOL_NAME = "update_abap_source"

const TOOL_DESCRIPTION =
  "Replace the full source code of an EXISTING ABAP object and automatically activate it. " +
  "Use after get_abap_object_workspace_uri to obtain the adt:// URI. " +
  "The tool writes via the VS Code adt:// FileSystemProvider, which handles lock " +
  "acquisition and transport-request selection (a transport dialog may appear in VS Code if " +
  "the object is not LOCAL and not yet locked to a transport). " +
  "If activation fails, the source is still saved and the tool returns structured syntax/check " +
  "errors (with file/line/severity) so the agent can fix the source and call this tool again. " +
  "Only updates existing objects — use create_object_programmatically to create new ones."

const INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["workspaceUri", "source"],
  properties: {
    workspaceUri: {
      type: "string",
      description:
        "adt:// workspace URI of the existing ABAP source file " +
        "(e.g. adt://dev100/sap/bc/adt/programs/programs/zfoo/source/main). " +
        "Obtain via get_abap_object_workspace_uri."
    },
    source: {
      type: "string",
      description:
        "The complete new source code. Replaces the entire object source — read the " +
        "current source first (get_abap_object_lines) and send back the full intended content."
    }
  }
}

async function invoke(args: Record<string, unknown>): Promise<string> {
  const { workspaceUri, source } = args as unknown as IUpdateAbapSourceParams

  if (typeof workspaceUri !== "string" || !workspaceUri) {
    throw new Error("workspaceUri is required and must be a non-empty string")
  }
  if (typeof source !== "string") {
    throw new Error("source is required and must be a string")
  }

  let uri: vscode.Uri
  try {
    uri = vscode.Uri.parse(workspaceUri, true)
  } catch (e) {
    throw new Error(`Invalid workspaceUri: ${String(e)}`)
  }
  if (uri.scheme !== "adt") {
    throw new Error(`workspaceUri must use the adt:// scheme (got "${uri.scheme}://")`)
  }

  logTelemetry("tool_update_abap_source_called", { connectionId: uri.authority })

  // Resolve the node so we can (a) check it's a writable AbapFile and
  // (b) hand the AbapObject to the activator afterwards.
  const root = await getOrCreateRoot(uri.authority)
  const node = await root.getNodeAsync(uri.path)
  if (!isAbapFile(node)) {
    throw new Error(
      `Not a writable ABAP source: ${workspaceUri}. ` +
        `The URI must point at an editable source file (e.g. .../source/main).`
    )
  }

  // If the user has the same object open with unsaved edits, refuse rather
  // than silently overwrite their changes.
  const dirty = vscode.workspace.textDocuments.find(
    d => d.uri.toString() === uri.toString() && d.isDirty
  )
  if (dirty) {
    throw new Error(
      `Editor for ${workspaceUri} has unsaved changes; save or revert in VS Code before calling update_abap_source.`
    )
  }

  // Write through the FileSystemProvider — this triggers lock + transport
  // dialog + write + unlock + relogin, exactly the same path Copilot uses.
  const bytes = Buffer.from(source, "utf8")
  await vscode.workspace.fs.writeFile(uri, bytes)

  // Always activate non-interactively. On failure the source remains saved;
  // we hand the structured error back so the agent can correct and retry.
  const activator = AdtObjectActivator.get(uri.authority)
  const result = await activator.activate(node.object, uri, /* interactive */ false)

  const objectName = node.object.name
  if (result.ok) {
    return (
      `**✅ Updated and activated** ${objectName}\n` +
      `• Workspace URI: \`${workspaceUri}\`\n` +
      `• Source bytes: ${bytes.length}`
    )
  }

  return (
    `**⚠️ Source written but activation failed** for ${objectName}\n\n` +
    `**Summary:** ${result.summary ?? "(no summary)"}\n\n` +
    `**Details:**\n\`\`\`\n${result.details ?? "(no details)"}\n\`\`\`\n\n` +
    `**Next step:** fix the syntax/check errors above and call \`${TOOL_NAME}\` again with the corrected full source. ` +
    `The object is currently inactive in SAP — repeated calls overwrite the inactive version, no manual cleanup needed.`
  )
}

export function registerUpdateAbapSourceTool(): void {
  registerMcpOnlyTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    invoke
  })
}

// Exported for tests.
export const _internal = { invoke, TOOL_NAME, TOOL_DESCRIPTION, INPUT_SCHEMA }
