/**
 * SAP System Info Tool
 * LM tool to retrieve comprehensive SAP system information
 */

import * as vscode from "vscode"
import { getSAPSystemInfo, formatSAPSystemInfoAsText } from "../sapSystemInfo"

// ============================================================================
// INTERFACE
// ============================================================================

export interface ISAPSystemInfoParameters {
  connectionId: string
  includeComponents?: boolean
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📊 SAP SYSTEM INFO TOOL
 * Retrieves comprehensive information about the SAP system including:
 * - Client information (from T000)
 * - Software component versions (from CVERS)
 * - SAP release information (from SVERS)
 */
export class SAPSystemInfoTool implements vscode.LanguageModelTool<ISAPSystemInfoParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISAPSystemInfoParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId } = options.input

    if (!connectionId) {
      throw new Error("connectionId is required")
    }

    const confirmationMessages = {
      title: "Get SAP System Info",
      message: new vscode.MarkdownString(
        `Retrieve comprehensive SAP system information for connection: \`${connectionId}\`\n\n` +
          `This will query system tables (T000, CVERS, SVERS) to gather:\n` +
          `- Client configuration\n` +
          `- Software component versions\n` +
          `- SAP release information`
      )
    }

    return {
      invocationMessage: `Getting SAP system info for: ${connectionId}...`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISAPSystemInfoParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { connectionId, includeComponents } = options.input

    if (!connectionId) {
      throw new Error("connectionId is required")
    }

    // Normalize connection ID to lowercase
    connectionId = connectionId.toLowerCase()

    // Default includeComponents to false
    includeComponents = includeComponents ?? false

    try {
      // Get system information (with caching) - connectionId lookup is done internally
      const systemInfo = await getSAPSystemInfo(connectionId, includeComponents)

      // Create concise summary
      let summary = `SAP System: ${connectionId.toUpperCase()}\n`
      summary += `- Type: ${systemInfo.systemType}\n`
      summary += `- Release: ${systemInfo.sapRelease || "N/A"}\n`

      if (systemInfo.currentClient) {
        summary += `- Client: ${systemInfo.currentClient.clientNumber} (${systemInfo.currentClient.clientName})\n`
      }

      if (systemInfo.timezone) {
        summary += `- Timezone: ${systemInfo.timezone.timezone} (${systemInfo.timezone.description}), ${systemInfo.timezone.utcOffset}`
        if (systemInfo.timezone.dstRule !== "NONE") {
          summary += `, DST: ${systemInfo.timezone.dstRule}`
        }
        summary += "\n"
      }

      if (includeComponents && systemInfo.softwareComponents.length > 0) {
        summary += `- Components: ${systemInfo.softwareComponents.length} installed\n`
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(summary),
        new vscode.LanguageModelTextPart(JSON.stringify(systemInfo, null, 2))
      ])
    } catch (error: any) {
      const errorMsg = error?.localizedMessage || error?.message || String(error)
      throw new Error(`Failed to get SAP system info: ${errorMsg}`)
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerSAPSystemInfoTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool("get_sap_system_info", new SAPSystemInfoTool()))
}
