/**
 * Get Test Folder Tool
 * Returns the configured SAP testing folder and warns when it isn't open in the workspace
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"

export class GetTestFolderTool implements vscode.LanguageModelTool<Record<string, never>> {
  async prepareInvocation() {
    return { invocationMessage: "Getting configured SAP testing folder" }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_get_test_folder_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          'No SAP testing folder configured. Ask the user to run the command "ABAP FS: Enable SAP UI Testing Features" in VS Code.'
        )
      ])
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? []
    const isOpen = workspaceFolders.some(
      wf => wf.uri.fsPath === testFolder || testFolder.startsWith(wf.uri.fsPath)
    )

    const lines: string[] = [`Test folder: ${testFolder}`]
    if (!isOpen) {
      lines.push(
        "WARNING: This folder is NOT currently open in the VS Code workspace. " +
          "Ask the user to open it (File > Add Folder to Workspace) " +
          "so that file tools can read and write test artifacts."
      )
    }

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join("\n"))])
  }
}

export function registerGetTestFolderTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("get_test_folder", new GetTestFolderTool()))
}
