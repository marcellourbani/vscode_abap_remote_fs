/**
 * MCP-only tool registry.
 *
 * Tools registered here are exposed ONLY through the MCP server (for external
 * AI clients such as Claude Desktop, Cursor, headless agents). They are
 * intentionally NOT registered with `vscode.lm.registerTool()` and NOT declared
 * in `package.json` `contributes.languageModelTools`, so they will not appear
 * in `vscode.lm.tools` and Copilot Chat (in agent mode) will not discover or
 * invoke them. This keeps the existing Copilot workflow — which relies on the
 * built-in file edit tool plus the `adt://` FileSystemProvider — completely
 * untouched.
 *
 * Use registerMcpOnlyTool() to add a new tool. The MCP server iterates this
 * registry alongside the regular `abap-fs`-tagged tools when building its
 * tool list.
 */

export interface McpOnlyTool {
  /** MCP tool name (snake_case). */
  name: string
  /** One-paragraph description sent to the MCP client. */
  description: string
  /**
   * JSON Schema for the input. The MCP server converts this to a Zod schema
   * via the same jsonSchemaToZod helper used for the regular LM tools.
   */
  inputSchema: Record<string, unknown>
  /**
   * Implementation. Returns the markdown text shown to the agent. Throw to
   * surface an error (the MCP server will wrap it as `{ isError: true }`).
   */
  invoke: (args: Record<string, unknown>) => Promise<string>
}

const registry = new Map<string, McpOnlyTool>()

export function registerMcpOnlyTool(tool: McpOnlyTool): void {
  registry.set(tool.name, tool)
}

export function getMcpOnlyTools(): McpOnlyTool[] {
  return Array.from(registry.values())
}

/** Test-only: clear the registry between unit tests. */
export function _resetMcpOnlyRegistryForTests(): void {
  registry.clear()
}
