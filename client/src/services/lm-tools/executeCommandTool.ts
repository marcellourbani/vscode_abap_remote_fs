/**
 * ABAP FS Execute Command Tool
 *
 * Thin wrapper around vscode.commands.executeCommand that lets Copilot trigger
 * a curated allow-list of ABAP FS commands (comm log, debug recording, ...).
 * The allow-list lives in the tool's package.json enum — the model literally
 * cannot invoke anything outside it.
 *
 * Fire-and-forget only: return value is discarded, tool reports "triggered".
 * Commands that need meaningful args or return structured data should get
 * their own dedicated LM tool.
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"

export interface IExecuteCommandParameters {
  command: string
}

/**
 * Commands the tool should await before returning. Anything not in this set is
 * fired and forgotten — the tool reports "triggered" immediately. Add a command
 * here when the model needs to know it finished before deciding what to do next
 * (e.g. a setup / bootstrap command).
 */
const AWAIT_COMMANDS = new Set<string>(["abapfs.activateCommLog"])

export class ExecuteCommandTool implements vscode.LanguageModelTool<IExecuteCommandParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IExecuteCommandParameters>,
    _token: vscode.CancellationToken
  ) {
    const { command } = options.input
    return {
      invocationMessage: `Running ABAP FS command: ${command}`,
      confirmationMessages: {
        title: "Run ABAP FS Command",
        message: new vscode.MarkdownString(`Run VS Code command:\n\n**\`${command}\`**`)
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IExecuteCommandParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const { command } = options.input
    logTelemetry("tool_execute_command_called", {})
    logTelemetry(`command_${command}_called`, {})

    if (AWAIT_COMMANDS.has(command)) {
      await vscode.commands.executeCommand(command)
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Command \`${command}\` finished.`)
      ])
    }

    void vscode.commands.executeCommand(command)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Command \`${command}\` was triggered.`)
    ])
  }
}

export function registerExecuteCommandTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("abap_execute_command", new ExecuteCommandTool())
  )
}
