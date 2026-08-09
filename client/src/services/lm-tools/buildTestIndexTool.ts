/**
 * Build Test Index Tool
 * Validates every test case and rebuilds the program's _index.md and _index.docx
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"
import { buildTestIndex } from "../testing/build-index"
import { buildTestIndexDocx } from "../testing/build-index-docx"

export interface IBuildTestIndexParameters {
  program: string
  sourceSnapshot: string
  reviewerConfirmation: string
}

/**
 * The exact sentence the model must pass in `reviewerConfirmation` before the index
 * will build. This is a behavioral gate, not a data field: the tool does nothing with
 * the value except verify the model actually typed it, which it can only truthfully do
 * AFTER it has delegated to the sap-test-plan-reviewer agent and received a PASS. It is
 * the cheapest reliable way to stop the reviewer step from being silently skipped.
 */
const REQUIRED_REVIEWER_CONFIRMATION = "I called the reviewer agent and it passed all test cases"

function normalizeConfirmation(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").replace(/[.]+$/, "").toLowerCase()
}

export class BuildTestIndexTool implements vscode.LanguageModelTool<IBuildTestIndexParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildTestIndexParameters>,
    _token: vscode.CancellationToken
  ) {
    return { invocationMessage: `Rebuilding test-case index for ${options.input.program}` }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IBuildTestIndexParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_build_test_index_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }

    if (
      normalizeConfirmation(options.input.reviewerConfirmation) !==
      normalizeConfirmation(REQUIRED_REVIEWER_CONFIRMATION)
    ) {
      throw new Error(
        "build_test_index is blocked: the mandatory 'reviewerConfirmation' field was " +
          "missing or did not match. Before building the index you MUST delegate the plan " +
          "to the sap-test-plan-reviewer agent and get a PASS. Only then, re-call this tool " +
          `passing reviewerConfirmation exactly as: "${REQUIRED_REVIEWER_CONFIRMATION}".`
      )
    }

    const result = await buildTestIndex(
      testFolder,
      options.input.program,
      options.input.sourceSnapshot
    )
    const docxPath = await buildTestIndexDocx(testFolder, options.input.program)
    const lines = [
      `Wrote ${result.indexPath}`,
      `Wrote ${docxPath}`,
      `Recorded analyzedOn: ${result.analyzedOn}`,
      `Recorded sourceSnapshot: ${result.sourceSnapshot}`,
      `${result.caseCount} case(s) — runnable: ${result.counts.runnable}, manual: ${result.counts.manual}, blocked: ${result.counts.blocked}, runnable-elsewhere: ${result.counts.elsewhere}`,
      ...result.warnings.map(w => `WARNING: ${w}`)
    ]
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join("\n"))])
  }
}

export function registerBuildTestIndexTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("build_test_index", new BuildTestIndexTool()))
}
