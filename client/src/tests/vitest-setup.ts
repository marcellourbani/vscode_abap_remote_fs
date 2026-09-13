/**
 * Vitest setup file (loaded via test.setupFiles in client/vitest.config.ts).
 *
 * The LM tool security guard (`src/services/lm-tools/toolGuard.ts`) requires a
 * Copilot-validated `toolInvocationToken` or an MCP-issued nonce on every
 * `tool.invoke()` call. Both come from runtime infrastructure that does not
 * exist during unit tests. This setup replaces the guard with no-ops so the
 * ~30 client test files can exercise tool-invocation paths.
 *
 * This is a plain factory (not `vi.importActual`) on purpose: importActual
 * eagerly loads the REAL toolGuard module graph (logger, oauth, ...) into every
 * test file, and those modules touch `vscode.*` / internal barrels at import
 * time — which crashes tests that only partially mock those modules. The guard
 * only exports these three symbols; tests never rely on the real implementation
 * of any of them, so a plain factory is both safe and avoids the graph load.
 *
 * The bypass lives ONLY in the test harness: this file is loaded only by vitest
 * (`setupFiles`), never bundled; production builds (tsdown) ignore `src/tests/**`;
 * and there is no runtime flag in production code that can neutralize the guard.
 */

import { vi } from "vitest"

vi.mock("../services/lm-tools/toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(() => true),
  createMcpAuthorizedOptions: <T>(input: T) => ({ input }) as unknown
}))
