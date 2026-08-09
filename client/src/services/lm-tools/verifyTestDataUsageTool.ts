/**
 * Verify Test Data Usage Tool
 * Cross-checks the data keys a spec references against those its data spec declares
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"
import { verifyTestDataUsage } from "../testing/verify-test-data"

export interface IVerifyTestDataUsageParameters {
  program: string
  tcId: string
}

export class VerifyTestDataUsageTool implements vscode.LanguageModelTool<IVerifyTestDataUsageParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IVerifyTestDataUsageParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Cross-checking ${options.input.tcId}.spec.ts against its data spec`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IVerifyTestDataUsageParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_verify_test_data_usage_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }

    const result = await verifyTestDataUsage(testFolder, options.input.program, options.input.tcId)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(result.messages.join("\n"))
    ])
  }
}

export function registerVerifyTestDataUsageTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("verify_test_data_usage", new VerifyTestDataUsageTool())
  )
}
