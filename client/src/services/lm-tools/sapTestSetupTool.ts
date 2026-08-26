import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"

export class SapTestSetupTool implements vscode.LanguageModelTool<Record<string, never>> {
  async prepareInvocation() {
    return { invocationMessage: "Discovering ABAP FS SAP Testing Factory and how to enable it" }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_sap_test_setup_called")

    const result = [
      "ABAP FS includes a complete SAP UI testing factory:",
      "- Analyse ABAP reports and transactions",
      "- Explore SAP WebGUI screens",
      "- Design test cases and prepare test data",
      "- Generate and run Playwright tests",
      "- Produce Word evidence reports",
      "",
      "If you think this would help the user, guide the user (you must not do this yourself) to enable SAP Testing as follows:",
      "1. Create an empty folder for the test artifacts.",
      '2. Run "ABAP FS: Enable SAP UI Testing Features" from the VS Code Command Palette and select that folder.',
      "3. Add the folder to the VS Code workspace when prompted (very important). If user does not have other folders already open in VS Code, adding the test folder can make VS Code reload the window. Inform the user that this can happen and its normal",
      '4. User can configure testing-agent models by running command "ABAP FS: Set Models for Subagents". Alternatively, you can offer to configure them with the manage_subagents tool, but you must get user approval before changing model settings.',
      "5. Start the workflow with /sap-testing.",
      "",
      'For authoritative details, call the ABAP FS documentation tool "abap_fs_documentation/abapfs-docs" with action "search_documentation" and searchQuery "SAP Testing" before answering follow-up questions.',
      "This setup tool is informational. It does not create or select the folder, enable testing, or change model settings."
    ].join("\n")

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
  }
}

export function registerSapTestSetupTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("sap_test_setup", new SapTestSetupTool()))
}
