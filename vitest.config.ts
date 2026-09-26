import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const root = import.meta.dirname
const optionalSetup = (path: string) => (existsSync(path) ? [path] : [])

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/__tests__/*.{ts,tsx,js}"],
    projects: [
      {
        root: resolve(root, "client"),
        resolve: {
          alias: {
            vscode: resolve(root, "client/src/tests/vscode-stub.ts")
          },
          extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"]
        },
        test: {
          name: "client"
        }
      },
      {
        root: resolve(root, "server"),
        test: {
          name: "server"
        }
      },
      {
        root: resolve(root, "modules/abapObject"),
        test: {
          name: "abapObject",
          setupFiles: optionalSetup(resolve(root, "modules/abapObject/setenv.js"))
        }
      },
      {
        root: resolve(root, "modules/abapfs"),
        resolve: {
          alias: {
            vscode: resolve(root, "modules/abapfs/src/tests/vscode_alias_for_test.ts")
          }
        },
        test: {
          name: "abapfs",
          setupFiles: optionalSetup(resolve(root, "modules/abapfs/setenv.js"))
        }
      }
    ]
  }
})
