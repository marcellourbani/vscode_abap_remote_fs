// Loaded by @playwright/test's own CLI, not compiled by our build — plain CommonJS.
// Values come from environment variables the playwright_test tool sets before spawning,
// so this one static file drives every run instead of generating a config per call.
const { defineConfig } = require("@playwright/test")

module.exports = defineConfig({
  testDir: process.env.SAP_TESTING_SPEC_DIR,
  timeout: Number(process.env.SAP_TESTING_TIMEOUT_MS ?? 60_000),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["json", { outputFile: process.env.SAP_TESTING_REPORT_FILE }]],
  use: {
    headless: process.env.SAP_TESTING_HEADED !== "1",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    launchOptions: process.env.SAP_TESTING_BROWSER_EXECUTABLE
      ? { executablePath: process.env.SAP_TESTING_BROWSER_EXECUTABLE }
      : {}
  }
})
