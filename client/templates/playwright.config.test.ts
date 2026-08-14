import * as path from "path"
import { afterAll, describe, expect, it, jest } from "@jest/globals"

jest.mock("@playwright/test", () => ({ defineConfig: (config: unknown) => config }))

const configPath = path.resolve(__dirname, "playwright.config.js")
const originalEnv = { ...process.env }

function loadConfig(env: Record<string, string | undefined>) {
  process.env = { ...originalEnv }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  let config: any
  jest.isolateModules(() => {
    config = require(configPath)
  })
  return config
}

afterAll(() => {
  process.env = originalEnv
})

describe("bundled Playwright config", () => {
  it("defaults to sequential execution and three failures", () => {
    const config = loadConfig({
      SAP_TESTING_PARALLEL: undefined,
      SAP_TESTING_MAX_TASKS: undefined,
      SAP_TESTING_MAX_FAILURES: undefined
    })
    expect(config.workers).toBe(1)
    expect(config.fullyParallel).toBe(false)
    expect(config.maxFailures).toBe(3)
    expect(config.globalTimeout).toBe(3_600_000)
    expect(config.globalSetup).toMatch(/sso-global-setup\.js$/)
  })

  it("parallelizes files only and preserves one global setup", () => {
    const config = loadConfig({ SAP_TESTING_PARALLEL: "1", SAP_TESTING_MAX_TASKS: "4" })
    expect(config.workers).toBe(4)
    expect(config.fullyParallel).toBe(false)
    expect(config.globalSetup).toMatch(/sso-global-setup\.js$/)
  })

  it("passes report, storage, browser, timeout, and output settings through", () => {
    const config = loadConfig({
      SAP_TESTING_ROOT: "C:/tests",
      SAP_TESTING_SPEC_DIR: "C:/tests/specs",
      SAP_TESTING_REPORT_FILE: "C:/tmp/report.json",
      SAP_TESTING_STORAGE_STATE: "C:/tmp/state.json",
      SAP_TESTING_BROWSER_EXECUTABLE: "C:/browser.exe",
      SAP_TESTING_HEADED: "1",
      SAP_TESTING_TIMEOUT_MS: "1234",
      SAP_TESTING_GLOBAL_TIMEOUT_MS: "5678",
      SAP_TESTING_MAX_FAILURES: "7"
    })
    expect(config.testDir).toBe("C:/tests/specs")
    expect(config.timeout).toBe(1234)
    expect(config.globalTimeout).toBe(5678)
    expect(config.maxFailures).toBe(7)
    expect(config.outputDir).toBe(path.join("C:/tests", ".playwright-artifacts"))
    expect(config.reporter).toEqual([["json", { outputFile: "C:/tmp/report.json" }]])
    expect(config.use.storageState).toBe("C:/tmp/state.json")
    expect(config.use.headless).toBe(false)
    expect(config.use.launchOptions).toEqual({ executablePath: "C:/browser.exe" })
  })
})
