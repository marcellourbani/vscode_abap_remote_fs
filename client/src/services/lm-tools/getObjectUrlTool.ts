/**
 * ABAP Get Object URL Tool
 * Generate SAP GUI URLs for browser automation
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { funWindow as window } from "../funMessenger"
import { logTelemetry } from "../telemetry"
import { SapGuiPanel } from "../../views/sapgui/SapGuiPanel"
import { RemoteManager } from "../../config"
import { ADTClient } from "abap-adt-api"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// INTERFACE
// ============================================================================

export interface IGetAbapObjectUrlParameters {
  objectName: string
  objectType?: string
  connectionId?: string
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔗 GET ABAP OBJECT URL TOOL - Generate SAP GUI URLs for browser automation
 */
export class GetAbapObjectUrlTool implements vscode.LanguageModelTool<IGetAbapObjectUrlParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetAbapObjectUrlParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType = "PROG/P", connectionId } = options.input

    const confirmationMessages = {
      title: "Generate SAP GUI URL",
      message: new vscode.MarkdownString(
        `Generate SAP GUI URL for ABAP object: \`${objectName}\` (${objectType})` +
          (connectionId ? ` (connection: ${connectionId})` : "")
      )
    }

    return {
      invocationMessage: `Generating SAP GUI URL for: ${objectName}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetAbapObjectUrlParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let { objectName, objectType = "PROG/P", connectionId } = options.input
    logTelemetry("tool_get_abap_object_url_called", { connectionId })

    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }

    try {
      let activeConnectionId = connectionId

      if (!activeConnectionId) {
        const activeEditor = window.activeTextEditor
        if (activeEditor && activeEditor.document.uri.scheme === "adt") {
          activeConnectionId = activeEditor.document.uri.authority
        } else {
          throw new Error("No connection ID provided and no active ABAP document found")
        }
      }

      const config = RemoteManager.get().byId(activeConnectionId)
      if (!config) {
        throw new Error(`Connection configuration not found for ID: ${activeConnectionId}`)
      }

      const client = new ADTClient(
        config.url,
        config.username,
        config.password,
        config.client,
        config.language
      )

      const sapGuiPanel = SapGuiPanel.createOrShow(
        vscode.Uri.file(__dirname),
        client,
        activeConnectionId,
        objectName,
        objectType
      )

      const webguiUrl = await sapGuiPanel.buildWebGuiUrl()

      const transactionInfo = SapGuiPanel.getTransactionInfo(objectType, objectName)

      sapGuiPanel.dispose()

      const resultText =
        `SAP GUI URL Generated Successfully\n` +
        `Object: ${objectName}\n` +
        `Type: ${objectType}\n` +
        `Connection: ${activeConnectionId}\n` +
        `Transaction: ${transactionInfo.transaction}\n` +
        `URL: ${webguiUrl}\n\n` +
        `Playwright MCP workflow:\n` +
        `1. Navigate via mcp_playwright_browser_navigate\n` +
        `2. Ask user to login\n` +
        `3. Use mcp_playwright_browser_snapshot for testing/navigation (NOT screenshots)\n` +
        `4. Interact via mcp_playwright_browser_click / _type\n` +
        `5. Screenshots only for reference via mcp_playwright_browser_take_screenshot`

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      throw new Error(`Failed to generate SAP GUI URL: ${String(error)}`)
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerGetObjectUrlTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("get_abap_object_url", new GetAbapObjectUrlTool())
  )
}
