import { defineConfig } from "vitest/config"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const setupFiles = [resolve(import.meta.dirname, "setenv.js")].filter(existsSync)

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/__tests__/*.{ts,tsx,js}"],
    setupFiles
  }
})
