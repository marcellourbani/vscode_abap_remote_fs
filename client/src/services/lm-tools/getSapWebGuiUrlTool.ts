/**
 * Get SAP WebGUI URL Tool
 * Resolves a configured connection into the WebGUI URL used for browser exploration and test runs
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { formatKey } from "../../config"
import { withAutoLogin } from "../../adt/sapgui/sapgui"
import { getWebGuiUrl } from "../testing/config"

export interface IGetSapWebGuiUrlParameters {
  connectionId: string
  transaction?: string
}

export class GetSapWebGuiUrlTool implements vscode.LanguageModelTool<IGetSapWebGuiUrlParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetSapWebGuiUrlParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId, transaction } = options.input
    return {
      invocationMessage: transaction
        ? `Getting SAP WebGUI URL for ${transaction} on ${connectionId}`
        : `Getting SAP WebGUI URL for ${connectionId}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetSapWebGuiUrlParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_get_sap_webgui_url_called")

    // Lowercase is ABAP FS's canonical connection id; the model may pass any casing.
    const connectionId = formatKey(options.input.connectionId)
    const { transaction } = options.input
    const base = await getWebGuiUrl(connectionId)
    if (base.startsWith("ERROR:")) {
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(base)])
    }

    // Built here rather than left to the caller: the returned URL may be a one-shot sign-in
    // link whose path is token-matched, so appending a query parameter to it would 404.
    const target = transaction
      ? `${base}${base.includes("?") ? "&" : "?"}~transaction=${encodeURIComponent(transaction)}`
      : base

    const url = await withAutoLogin(connectionId, target)
    const signedIn = url !== target
    const sep = base.includes("?") ? "&" : "?"

    const landsOn = transaction ? `lands on ${transaction}` : "opens SAP Easy Access"
    const note = signedIn
      ? `This URL signs the browser in and then ${landsOn}. Open it EXACTLY as given — it is ` +
        "single-use, so do not append parameters and do not reopen it. Once it is open the " +
        "browser session is authenticated, so reach any other transaction by opening " +
        `${base}${sep}~transaction=<TCODE> directly.`
      : "Auto-login is not in use for this connection, so this URL may show the SAP logon " +
        "screen. If it does, ask the user to log in in that browser window."

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(url),
      new vscode.LanguageModelTextPart(note)
    ])
  }
}

export function registerGetSapWebGuiUrlTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("get_sap_webgui_url", new GetSapWebGuiUrlTool())
  )
}
