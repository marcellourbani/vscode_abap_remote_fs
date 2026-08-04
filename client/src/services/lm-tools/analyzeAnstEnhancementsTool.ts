/**
 * ANST Enhancement Analysis Tool
 * Classifies an ANST Customer Code export and writes the Markdown work list beside it
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { analyzeAnstEnhancements } from "../testing/analyze-anst-enhancements"

export interface IAnalyzeAnstEnhancementsParameters {
  xlsxPath: string
}

export class AnalyzeAnstEnhancementsTool implements vscode.LanguageModelTool<IAnalyzeAnstEnhancementsParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IAnalyzeAnstEnhancementsParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Analyzing ANST enhancements from ${options.input.xlsxPath}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IAnalyzeAnstEnhancementsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_analyze_anst_enhancements_called")

    const result = await analyzeAnstEnhancements(options.input.xlsxPath)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Wrote ${result.outputPath}`)
    ])
  }
}

export function registerAnalyzeAnstEnhancementsTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("analyze_anst_enhancements", new AnalyzeAnstEnhancementsTool())
  )
}
