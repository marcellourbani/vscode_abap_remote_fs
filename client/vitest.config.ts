import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  // Prefer TypeScript sources over any stale compiled `.js` siblings in
  // `src/` (leftover build artifacts). Vite's default extension order puts
  // `.js` before `.ts`, which would load stale compiled code that does a raw
  // `require("vscode")` and bypasses the `vscode` alias below. This mirrors
  // the old jest `moduleFileExtensions: ["ts","tsx","js"]` ordering.
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"]
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/__tests__/*.{ts,tsx,js}"],
    // Setup file mocks the LM tool security guard at the vitest layer so
    // tests can exercise tool.invoke() paths without forging a Copilot
    // tool-invocation token or MCP nonce. The bypass lives ONLY here, never
    // in production code.
    setupFiles: [resolve(import.meta.dirname, "src/tests/vitest-setup.ts")],
    // Tests in this file collection rely on the mocked vscode runtime API.
    // The alias points module resolution at a stub - vi.mock("vscode", ...)
    // factories in individual tests override it at runtime.
    alias: {
      vscode: resolve(import.meta.dirname, "src/tests/vscode-stub.ts")
    }
  }
})
