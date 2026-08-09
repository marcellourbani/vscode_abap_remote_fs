/**
 * Build Test Index Document Tool
 * Converts the current _index.md into a printable, bordered _index.docx
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"
import { buildTestIndexDocx } from "../testing/build-index-docx"

export interface IBuildTestIndexDocxParameters {
  program: string
}

export class BuildTestIndexDocxTool implements vscode.LanguageModelTool<IBuildTestIndexDocxParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildTestIndexDocxParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Building test-case index document for ${options.input.program}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IBuildTestIndexDocxParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_build_test_index_docx_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }
    const outputPath = await buildTestIndexDocx(testFolder, options.input.program)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Wrote ${outputPath}`)
    ])
  }
}

export function registerBuildTestIndexDocxTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("build_test_index_docx", new BuildTestIndexDocxTool())
  )
}
