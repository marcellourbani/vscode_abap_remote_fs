
/**
 * LM Tool Security Guard
 *
 * Prevents unauthorized extensions from invoking LM tools via vscode.lm.invokeTool().
 *
 * Authorized callers:
 * 1. Copilot — identified by VS Code validating toolInvocationToken at the API layer
 *    (forged tokens are rejected by VS Code before reaching our code)
 * 2. Our own MCP server — calls invoke() directly with a per-call nonce that only
 *    this module can generate and validate (not accessible externally)
 *
 * Unauthorized callers (rogue extensions):
 * - Call vscode.lm.invokeTool() → VS Code rejects forged tokens, or passes through
 *   with undefined token → our guard blocks it
 * - Cannot access the nonce set since it's in a module-private closure
 * - Cannot slip through during parallel MCP calls (nonce is per-invocation, not global)
 */

import { randomUUID } from "crypto"
import * as vscode from "vscode"

/** Set of currently valid one-time nonces for MCP invocations */
const activeNonces = new Set<string>()

/**
 * Symbol used as a hidden key on the options object to carry the MCP nonce.
 * Symbols are not enumerable, not accessible via Object.keys(), and this specific
 * symbol instance is private to this module's closure.
 */
const MCP_NONCE_KEY = Symbol("abapfs.mcpNonce")

/** Extended options type that can carry our hidden nonce */
export interface McpAuthorizedOptions<T> extends vscode.LanguageModelToolInvocationOptions<T> {
  [key: symbol]: string
}

/**
 * Creates an authorized options object for MCP tool invocations.
 * Injects a one-time nonce that assertToolInvocationAuthorized will validate.
 */
export function createMcpAuthorizedOptions<T>(input: T): McpAuthorizedOptions<T> {
  const nonce = randomUUID()
  activeNonces.add(nonce)
  // Safety: auto-expire nonce after 30 seconds to prevent unbounded accumulation
  // if a tool call is cancelled or throws before the guard checks it
  setTimeout(() => activeNonces.delete(nonce), 30_000)
  const options = { input, toolInvocationToken: undefined } as unknown as McpAuthorizedOptions<T>
  options[MCP_NONCE_KEY] = nonce
  return options
}

/**
 * Validates that a tool invocation is authorized.
 * Returns true if authorized, false if blocked.
 */
function isToolInvocationAuthorized(
  options: vscode.LanguageModelToolInvocationOptions<any>
): boolean {
  if (options.toolInvocationToken) return true
  const nonce = (options as any)[MCP_NONCE_KEY] as string | undefined
  if (nonce && activeNonces.has(nonce)) {
    activeNonces.delete(nonce)
    return true
  }
  return false
}

/**
 * Throws an error if the tool invocation is not authorized.
 * Call at the start of every tool's invoke() method.
 */
export function assertToolInvocationAuthorized(
  options: vscode.LanguageModelToolInvocationOptions<any>
): void {
  if (!isToolInvocationAuthorized(options)) {
    throw new Error(
      "Unauthorized tool invocation. This tool can only be called by GitHub Copilot or the ABAP FS MCP server."
    )
  }
}
