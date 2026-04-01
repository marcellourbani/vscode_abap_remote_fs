import * as vscode from "vscode"

/**
 * Shared registry of tool instances, keyed by tool name.
 * Populated at registration time so the MCP server can call invoke()
 * directly, bypassing vscode.lm.invokeTool() and its prepareInvocation
 * confirmation dialog pipeline.
 */
export const toolRegistry = new Map<string, vscode.LanguageModelTool<any>>()

/**
 * Register a tool with both VS Code LM and the shared registry.
 * Returns the disposable from vscode.lm.registerTool so callers can
 * push it onto context.subscriptions as before.
 */
export function registerToolWithRegistry(
  name: string,
  tool: vscode.LanguageModelTool<any>
): vscode.Disposable {
  toolRegistry.set(name, tool)
  return vscode.lm.registerTool(name, tool)
}
