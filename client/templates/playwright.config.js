// Loaded by @playwright/test's own CLI, not compiled by our build — plain CommonJS.
// Values come from environment variables the playwright_test tool sets before spawning,
// so this one static file drives every run instead of generating a config per call.
const path = require("path")
const { defineConfig } = require("@playwright/test")

// Set only when auto-login applies. globalSetup guarantees the file exists by the time a
// worker reads it — this config is evaluated before globalSetup runs, so it cannot check.
const storageState = process.env.SAP_TESTING_STORAGE_STATE || undefined

module.exports = defineConfig({
  testDir: process.env.SAP_TESTING_SPEC_DIR,
  timeout: Number(process.env.SAP_TESTING_TIMEOUT_MS ?? 60_000),
  // Bounds the whole run, not just one test. Without it a wedged browser or worker leaves the
  // runner alive indefinitely and the caller waiting on output that never comes.
  globalTimeout: Number(process.env.SAP_TESTING_GLOBAL_TIMEOUT_MS ?? 600_000),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: path.join(__dirname, "sso-global-setup.js"),
  // Traces and videos, NOT our evidence. Must be set explicitly: Playwright derives this from
  // the config file's location, and this config ships inside the extension install.
  outputDir: process.env.SAP_TESTING_ROOT
    ? path.join(process.env.SAP_TESTING_ROOT, ".playwright-artifacts")
    : undefined,
  reporter: [["json", { outputFile: process.env.SAP_TESTING_REPORT_FILE }]],
  use: {
    headless: process.env.SAP_TESTING_HEADED !== "1",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    storageState,
    launchOptions: process.env.SAP_TESTING_BROWSER_EXECUTABLE
      ? { executablePath: process.env.SAP_TESTING_BROWSER_EXECUTABLE }
      : {}
  }
})
