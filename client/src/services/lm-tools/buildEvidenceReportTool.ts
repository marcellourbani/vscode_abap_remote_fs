/**
 * Build Evidence Report Tool
 * Aggregates every test run's manifest and screenshots into one Word evidence report
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { formatKey } from "../../config"
import { getTestFolder } from "../testing/config"
import { buildEvidenceReport } from "../testing/build-evidence"

export interface IBuildEvidenceReportParameters {
  program: string
  connectionId: string
}

export class BuildEvidenceReportTool implements vscode.LanguageModelTool<IBuildEvidenceReportParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildEvidenceReportParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Building evidence report for ${options.input.program} on ${options.input.connectionId}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IBuildEvidenceReportParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_build_evidence_report_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }
    const connectionId = formatKey(options.input.connectionId)
    const outPath = await buildEvidenceReport(testFolder, options.input.program, connectionId)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Wrote ${outPath}`)
    ])
  }
}

export function registerBuildEvidenceReportTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("build_evidence_report", new BuildEvidenceReportTool())
  )
}
