/**
 * Check Test Data Tool
 * Pre-flight: resolves every case's data specs against a system before a real test run
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { formatKey } from "../../config"
import { getTestFolder } from "../testing/config"
import { checkTestData } from "../testing/check-fixtures"

export interface ICheckTestDataParameters {
  program: string
  connectionId: string
}

export class CheckTestDataTool implements vscode.LanguageModelTool<ICheckTestDataParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICheckTestDataParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: `Checking test data readiness for ${options.input.program} on ${options.input.connectionId}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICheckTestDataParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_check_test_data_called")

    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }
    const connectionId = formatKey(options.input.connectionId)
    const result = await checkTestData(testFolder, options.input.program, connectionId)
    const lines = [
      ...result.failures.map(f => `FAIL  ${f.tcId}\n        ${f.message}`),
      ...result.distinctViolations.map(v => `DISTINCT VIOLATION  ${v.tcId}\n        ${v.message}`),
      `\n${result.passed}/${result.total} case(s) resolvable on ${connectionId}. Breakdown:`,
      `  - prepared from data.json cache (sql/seeded): ${result.cached.length}` +
        (result.cached.length ? ` — ${result.cached.join(", ")}` : ""),
      `  - no cache needed (static/generated only, would pass on any system): ${result.noCacheNeeded.length}` +
        (result.noCacheNeeded.length ? ` — ${result.noCacheNeeded.join(", ")}` : ""),
      `  - resolved from a TESTDATA_* env pin, NOT a data.json: ${result.envPinned.length}` +
        (result.envPinned.length ? ` — ${result.envPinned.join(", ")}` : ""),
      `  - SEED PENDING (deferred — seeded precondition not produced yet; resolve after its viaTcId spec runs): ${result.seedPending.length}` +
        (result.seedPending.length ? ` — ${result.seedPending.join(", ")}` : ""),
      `  - FAILED: ${result.failures.length}` +
        (result.failures.length ? ` — ${result.failures.map(f => f.tcId).join(", ")}` : ""),
      result.distinctViolations.length
        ? `\nDISTINCT: ${result.distinctViolations.length} case(s) have keys that must differ but resolved to the same value — re-resolve them in prepare-data.`
        : "",
      ...result.shadowWarnings.map(
        w => `WARNING (cache shadows spec)  ${w.tcId}\n        ${w.message}`
      ),
      result.cached.length === 0 && result.noCacheNeeded.length > 0
        ? "\nNote: a high 'resolvable' count here does NOT mean data was prepared — the passing cases above need no per-system cache. Only the 'prepared from data.json cache' count reflects real data preparation."
        : ""
    ].filter(Boolean)
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join("\n"))])
  }
}

export function registerCheckTestDataTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("check_test_data", new CheckTestDataTool()))
}
