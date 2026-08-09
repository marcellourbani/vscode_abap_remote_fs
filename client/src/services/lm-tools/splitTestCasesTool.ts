/**
 * Split Test Cases Tool
 * Splits a validated aggregate markdown file into one test case file per tagged block
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"
import { splitTestCases } from "../testing/split-test-cases"

export interface ISplitTestCasesParameters {
  sourcePath: string
}

export class SplitTestCasesTool implements vscode.LanguageModelTool<ISplitTestCasesParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISplitTestCasesParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Splitting test cases from ${options.input.sourcePath}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISplitTestCasesParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_split_test_cases_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }

    const result = await splitTestCases(testFolder, options.input.sourcePath)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        [
          `Split ${result.outputPaths.length} test case(s).`,
          ...result.outputPaths,
          "The aggregate source file was deleted.",
          "Run build_test_index separately after all test cases are ready."
        ].join("\n")
      )
    ])
  }
}

export function registerSplitTestCasesTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("split_test_cases", new SplitTestCasesTool()))
}
