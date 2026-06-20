/**
 * ABAP Create Object Tool
 * Programmatic creation of ABAP objects
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// INTERFACE
// ============================================================================

export interface ICreateObjectParameters {
  objectType: string // e.g., "PROG/P", "CLAS/OC"
  name: string
  description: string
  packageName?: string
  parentName?: string
  connectionId?: string
  additionalOptions?: {
    serviceDefinition?: string
    bindingType?: string
    bindingCategory?: string
    softwareComponent?: string
    packageType?: string
    transportLayer?: string
    transportRequest?: {
      type: "new" | "existing"
      number?: string
      description?: string
    }
  }
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🏗️ CREATE ABAP OBJECT TOOL - Programmatic object creation
 */
export class CreateABAPObjectTool implements vscode.LanguageModelTool<ICreateObjectParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateObjectParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectType, name, description, packageName = "$TMP", connectionId } = options.input

    const confirmationMessages = {
      title: "Create ABAP Object",
      message: new vscode.MarkdownString(
        `Create new ABAP object:\n` +
          `• **Type:** ${objectType}\n` +
          `• **Name:** ${name}\n` +
          `• **Description:** ${description}\n` +
          `• **Package:** ${packageName}` +
          (connectionId ? `\n• **Connection:** ${connectionId}` : "")
      )
    }

    return {
      invocationMessage: `Creating ${objectType}: ${name}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreateObjectParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let {
      objectType,
      name,
      description,
      packageName = "$TMP",
      parentName,
      connectionId,
      additionalOptions
    } = options.input
    logTelemetry("tool_create_abap_object_called", { connectionId })

    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }

    try {
      const result = await vscode.commands.executeCommand(
        "abapfs.createObjectProgrammatically",
        objectType,
        name,
        description,
        packageName,
        parentName,
        connectionId,
        additionalOptions
      )

      if (result && typeof result === "object" && "success" in result) {
        const structuredResult = result as any

        if (!structuredResult.success) {
          let errorText = ""

          if (
            structuredResult.message &&
            structuredResult.message.includes("Object not found in workspace")
          ) {
            errorText =
              `ABAP Object Creation Failed\n` +
              `Object Type: ${objectType}\n` +
              `Name: ${name}\n` +
              `Error: ${structuredResult.error || "WORKSPACE_REGISTRATION_FAILED"}\n` +
              `Message: ${structuredResult.message}\n\n` +
              `NOTE: object may have been created in SAP — this error is from workspace registration, not object creation.\n` +
              `Next steps:\n` +
              `1. Call get_abap_object_workspace_uri with name="${name}" type="${objectType}"\n` +
              `2. If valid URI returned, open it in VS Code to verify\n` +
              `3. SAP creation was likely successful despite this error`
          } else {
            errorText =
              `ABAP Object Creation Failed\n` +
              `Object Type: ${objectType}\n` +
              `Name: ${name}\n` +
              `Error: ${structuredResult.error || "UNKNOWN_ERROR"}\n` +
              `Message: ${structuredResult.message || "none"}\n`
          }

          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(errorText)])
        }
      }

      const resultText =
        `ABAP Object Created Successfully\n` +
        `Object Type: ${objectType}\n` +
        `Name: ${name}\n` +
        `Description: ${description}\n` +
        `Package: ${packageName}\n` +
        `Status: created, ready for development`

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      throw new Error(`Failed to create ABAP object: ${String(error)}`)
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerCreateObjectTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("create_object_programmatically", new CreateABAPObjectTool())
  )
}
