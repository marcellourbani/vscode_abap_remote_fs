/**
 * Get SAP WebGUI URL Tool
 * Resolves a configured connection into the WebGUI URL used for browser exploration and test runs
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getWebGuiUrl } from "../testing/config"

export interface IGetSapWebGuiUrlParameters {
  connectionId: string
}

export class GetSapWebGuiUrlTool implements vscode.LanguageModelTool<IGetSapWebGuiUrlParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetSapWebGuiUrlParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Getting SAP WebGUI URL for ${options.input.connectionId}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetSapWebGuiUrlParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_get_sap_webgui_url_called")

    const url = await getWebGuiUrl(options.input.connectionId)
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(url)])
  }
}

export function registerGetSapWebGuiUrlTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("get_sap_webgui_url", new GetSapWebGuiUrlTool())
  )
}
