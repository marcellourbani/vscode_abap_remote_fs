---
"vscode-abap-remote-fs": patch
---

Complete the ESM migration for SAP UI testing and the build scripts. The managed test folder is now marked as an ES module, its Playwright config is emitted as `playwright.config.mjs`, and the generated `@playwright/test` wrapper gained an ESM entry point so specs can import `test` and `expect` as named exports. Pins `vscode-languageserver-protocol` to the version the language server expects, restores the missing `@typesafe-ai/sdk` dependency, and runs bundling and type-checking in parallel so `pnpm build` covers both.
