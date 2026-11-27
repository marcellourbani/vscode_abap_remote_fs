import { EventEmitter } from "events"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

vi.mock("vscode", () => ({
  extensions: { getExtension: vi.fn() },
  window: { showWarningMessage: vi.fn() },
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  lm: { registerTool: vi.fn() }
}))

vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../funMessenger", () => ({
  funWindow: { showWarningMessage: vi.fn() }
}))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("../../config", () => ({ formatKey: vi.fn(), RemoteManager: { get: vi.fn() } }))
vi.mock("../../lib", () => ({ log: { debug: vi.fn() } }))
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("../../adt/sapgui/sapgui", () => ({ ssoLoginUrl: vi.fn() }))
vi.mock("../testing/config", () => ({ getTestFolder: vi.fn(), getWebGuiUrl: vi.fn() }))
vi.mock("../testing/browserResolver", () => ({ resolveBrowserExecutable: vi.fn() }))
vi.mock("child_process", () => ({ spawn: vi.fn() }))

import { spawn } from "child_process"
import * as vscode from "vscode"
import { formatKey, RemoteManager } from "../../config"
import { ssoLoginUrl } from "../../adt/sapgui/sapgui"
import { getTestFolder, getWebGuiUrl } from "../testing/config"
import { resolveBrowserExecutable } from "../testing/browserResolver"
import { funWindow } from "../funMessenger"
import {
  PlaywrightTestTool,
  cleanupStorageState,
  playwrightArgs,
  registerPlaywrightTestTool,
  summarizeReport
} from "./playwrightTestTool"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import type { Mock } from "vitest"

const result = (status: string, extra: Record<string, unknown> = {}) => ({ status, ...extra })
const report = (...tests: Array<{ title: string; results: any[] }>) => ({
  suites: [{ specs: tests.map(test => ({ title: test.title, tests: [test] })) }]
})

describe("playwrightArgs", () => {
  it("runs all specs when tcIds are omitted", () => {
    expect(playwrightArgs("config.js")).toEqual(["test", "--config", "config.js"])
  })

  it("uses exact selected spec filenames in caller order", () => {
    expect(playwrightArgs("config.js", ["TC-002", "TC-010a-bt"])).toEqual([
      "test",
      "--config",
      "config.js",
      "TC-002.spec.ts",
      "TC-010a-bt.spec.ts"
    ])
  })
})

describe("summarizeReport", () => {
  it("reports pass, fail, and not-run separately with failure evidence", () => {
    const summary = summarizeReport(
      report(
        { title: "pass", results: [result("passed")] },
        {
          title: "fail",
          results: [
            result("failed", {
              error: { message: "boom\ndetail", location: { file: "TC.spec.ts", line: 7 } },
              attachments: [{ name: "trace", path: "trace.zip" }]
            })
          ]
        },
        {
          title: "fail without line",
          results: [result("failed", { error: { location: { file: "NoLine.spec.ts" } } })]
        },
        { title: "skip", results: [result("skipped")] },
        { title: "interrupt", results: [result("interrupted")] },
        { title: "unknown", results: [] }
      ),
      3
    )

    expect(summary).toContain("PASS  pass")
    expect(summary).toContain("FAIL  fail")
    expect(summary).toContain("at TC.spec.ts:7")
    expect(summary).toContain("[trace] trace.zip")
    expect(summary).toContain("NOT RUN  skip")
    expect(summary).toContain("INTERRUPTED  interrupt")
    expect(summary).toContain("NOT RUN  unknown")
    expect(summary).toContain("1 passed, 2 failed, 1 interrupted, 2 not run (6 selected)")
  })

  it("reports native max-failure early stopping", () => {
    const value: any = report(
      { title: "fail 1", results: [result("failed")] },
      { title: "fail 2", results: [result("failed")] },
      { title: "queued", results: [result("interrupted")] }
    )
    value.errors = [{ message: "Testing stopped early after 2 maximum allowed failures." }]

    expect(summarizeReport(value, 2)).toContain("Run stopped early after reaching maxFailures=2")
  })

  it("uses the count fallback when Playwright omits its stop error", () => {
    const value = report(
      { title: "fail", results: [result("timedOut")] },
      { title: "queued", results: [result("skipped")] }
    )
    expect(summarizeReport(value, 1)).toContain("Run stopped early after reaching maxFailures=1")
  })

  it("handles discovery errors and empty matches", () => {
    expect(summarizeReport({ errors: [{ message: "bad config" }] }, 3)).toBe(
      "No tests ran. Errors:\nbad config"
    )
    expect(summarizeReport({}, 3)).toBe("No tests matched.")
    expect(summarizeReport({ errors: [{}] }, 3)).toBe("No tests matched.")
    const withUnnamedError: any = report({ title: "pass", results: [result("passed")] })
    withUnnamedError.errors = [{}]
    expect(summarizeReport(withUnnamedError, 3)).not.toContain("stopped early")
  })

  it("collects nested suites and ignores undefined suite entries", () => {
    const value: any = {
      suites: [
        undefined,
        {
          suites: [
            {
              specs: [
                { title: "nested", tests: [{ title: "nested", results: [result("passed")] }] }
              ]
            }
          ]
        }
      ]
    }
    expect(summarizeReport(value, 3)).toContain("PASS  nested")
  })
})

const confirmation = "I verified all upstream phase gates and test data readiness for this program"

function token() {
  return {
    onCancellationRequested: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  } as any
}

function options(input: Record<string, unknown>) {
  return { input } as any
}

function mockProcess(reportValue?: unknown, output = { stdout: "runner out", stderr: "" }) {
  ;(spawn as unknown as Mock).mockImplementation(function (
    _command: string,
    _args: string[],
    processOptions: { env: NodeJS.ProcessEnv }
  ) {
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.pid = 123
    child.exitCode = null
    child.signalCode = null
    child.kill = vi.fn()
    setImmediate(async () => {
      if (output.stdout) child.stdout.emit("data", Buffer.from(output.stdout))
      if (output.stderr) child.stderr.emit("data", Buffer.from(output.stderr))
      if (reportValue !== undefined) {
        await fs.writeFile(
          processOptions.env.SAP_TESTING_REPORT_FILE!,
          JSON.stringify(reportValue),
          "utf8"
        )
      }
      child.exitCode = reportValue === undefined ? 1 : 0
      child.emit("close", child.exitCode)
    })
    return child
  })
}

describe("PlaywrightTestTool", () => {
  let root: string
  let extension: string
  let specDir: string
  let tool: PlaywrightTestTool

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(assertToolInvocationAuthorized).mockReset()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "playwright-tool-"))
    extension = path.join(root, "extension")
    specDir = path.join(root, "tests", "PROGRAM", "test-scripts")
    await fs.mkdir(specDir, { recursive: true })
    const packageDir = path.join(
      extension,
      "client",
      "dist",
      "vendor",
      "node_modules",
      "@playwright",
      "test"
    )
    await fs.mkdir(packageDir, { recursive: true })
    await fs.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ bin: { playwright: "cli.js" } })
    )
    await fs.writeFile(path.join(packageDir, "cli.js"), "")
    ;(vscode.extensions.getExtension as Mock).mockReturnValue({ extensionPath: extension })
    ;(formatKey as Mock).mockImplementation(function (value: string) {
      return value.toLowerCase()
    })
    ;(getTestFolder as Mock).mockReturnValue(root)
    ;(getWebGuiUrl as Mock).mockResolvedValue("http://sap/webgui")
    ;(resolveBrowserExecutable as Mock).mockResolvedValue({
      executablePath: "C:/browser.exe"
    })
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue(null)
    })
    tool = new PlaywrightTestTool()
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("describes exact and all-spec invocations", async () => {
    await expect(
      tool.prepareInvocation(
        options({ program: "PROGRAM", tcIds: ["TC-001", "TC-002"], connectionId: "DEV" }),
        token()
      )
    ).resolves.toEqual({ invocationMessage: "Running TC-001, TC-002 for PROGRAM on DEV" })
    await expect(
      tool.prepareInvocation(options({ program: "PROGRAM", connectionId: "DEV" }), token())
    ).resolves.toEqual({ invocationMessage: "Running all specs for PROGRAM on DEV" })
  })

  it("runs an exact parallel subset with capped limits and a login URL per worker", async () => {
    await fs.writeFile(path.join(specDir, "TC-001.spec.ts"), "test")
    await fs.writeFile(path.join(specDir, "TC-002.spec.ts"), "test")
    const launcher = { url: "http://launcher", dispose: vi.fn() }
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({ webGuiAutoLogin: true })
    })
    ;(ssoLoginUrl as Mock).mockResolvedValue(launcher)
    ;(resolveBrowserExecutable as Mock).mockResolvedValue({
      executablePath: "C:/browser.exe",
      warning: "browser warning"
    })
    mockProcess(report({ title: "selected", results: [result("passed")] }))

    const invocation = tool.invoke(
      options({
        program: "PROGRAM",
        tcIds: ["TC-001", "TC-002"],
        connectionId: "DEV100",
        headed: true,
        maxFailures: 99,
        runInParallel: true,
        maxTasks: 99,
        prerequisiteConfirmation: `${confirmation}.`
      }),
      token()
    ) as Promise<any>
    const value = await invocation

    expect(value.parts[0].text).toContain("2 passed, 0 failed")
    expect(spawn).toHaveBeenCalledTimes(2)
    const workers = (spawn as unknown as Mock).mock.calls.map(call => call[2].env)
    expect(workers.map(env => env.SAP_TESTING_LOGIN_URL)).toEqual([
      "http://launcher",
      "http://launcher"
    ])
    expect(new Set(workers.map(env => env.SAP_TESTING_STORAGE_STATE)).size).toBe(2)
    expect(workers.every(env => env.SAP_TESTING_PARALLEL === "0")).toBe(true)
    expect(workers.every(env => env.SAP_TESTING_MAX_TASKS === "1")).toBe(true)
    expect(workers.every(env => env.SAP_TESTING_MAX_FAILURES === "10")).toBe(true)
    expect(workers.every(env => env.SAP_TESTING_HEADED === "1")).toBe(true)
    expect(workers.every(env => env.SAP_TESTING_BROWSER_EXECUTABLE === "C:/browser.exe")).toBe(true)
    expect(workers.every(env => env.SAP_SYSTEM === "dev100")).toBe(true)
    expect(workers.every(env => env.SAP_URL_DEV100 === "http://sap/webgui")).toBe(true)
    expect(funWindow.showWarningMessage).toHaveBeenCalledWith("browser warning")
    expect(launcher.dispose).toHaveBeenCalledTimes(2)
  })

  it("gives each parallel worker a distinct SAP login and isolated report state", async () => {
    await fs.writeFile(path.join(specDir, "TC-001.spec.ts"), "test")
    await fs.writeFile(path.join(specDir, "TC-002.spec.ts"), "test")
    await fs.writeFile(path.join(specDir, "TC-003.spec.ts"), "test")
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({ webGuiAutoLogin: true })
    })
    ;(ssoLoginUrl as Mock)
      .mockResolvedValueOnce({ url: "http://launcher/one", dispose: vi.fn() })
      .mockResolvedValueOnce({ url: "http://launcher/two", dispose: vi.fn() })
      .mockResolvedValueOnce({ url: "http://launcher/three", dispose: vi.fn() })
    mockProcess(report({ title: "worker", results: [result("passed")] }))

    const value: any = await tool.invoke(
      options({
        program: "PROGRAM",
        tcIds: ["TC-001", "TC-002", "TC-003"],
        connectionId: "DEV100",
        runInParallel: true,
        maxTasks: 3,
        skipWorkflowValidation: true,
        overrideReason: "User requested parallel testing"
      }),
      token()
    )

    expect(value.parts[0].text).toContain("3 passed, 0 failed")
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(ssoLoginUrl).toHaveBeenCalledTimes(3)
    const workers = (spawn as unknown as Mock).mock.calls.map(call => call[2].env)
    expect(workers.map(env => env.SAP_TESTING_LOGIN_URL).sort()).toEqual([
      "http://launcher/one",
      "http://launcher/three",
      "http://launcher/two"
    ])
    expect(new Set(workers.map(env => env.SAP_TESTING_STORAGE_STATE)).size).toBe(3)
    expect(workers.every(env => env.SAP_TESTING_PARALLEL === "0")).toBe(true)
  })

  it("runs all specs sequentially and falls back to process output without JSON", async () => {
    mockProcess(undefined, { stdout: "", stderr: "load failed" })
    const value: any = await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        prerequisiteConfirmation: confirmation
      }),
      token()
    )
    expect(value.parts[0].text).toContain(
      "Playwright worker 1 did not produce a report (exit code 1)"
    )
    expect(value.parts[0].text).toContain("load failed")
    const [_command, args, processOptions] = (spawn as unknown as Mock).mock.calls[0]
    expect(args.some((arg: string) => arg.endsWith(".spec.ts"))).toBe(false)
    expect(processOptions.env).toMatchObject({
      SAP_TESTING_PARALLEL: "0",
      SAP_TESTING_MAX_TASKS: "1",
      SAP_TESTING_MAX_FAILURES: "3",
      SAP_TESTING_HEADED: "0"
    })
  })

  it("continues without auto-login when connection setup throws", async () => {
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockRejectedValue(new Error("session expired"))
    })
    mockProcess(report({ title: "no login", results: [result("passed")] }))
    const value: any = await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        prerequisiteConfirmation: confirmation
      }),
      token()
    )
    expect(value.parts[0].text).toContain("1 passed")
    const processOptions = (spawn as unknown as Mock).mock.calls[0][2]
    expect(processOptions.env.SAP_TESTING_LOGIN_URL).toBeUndefined()
  })

  it("handles non-Error auto-login failures and stdout-only report fallback", async () => {
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockRejectedValue("offline")
    })
    mockProcess(undefined, { stdout: "config failed", stderr: "" })
    const value: any = await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        prerequisiteConfirmation: confirmation
      }),
      token()
    )
    expect(value.parts[0].text).toContain("config failed")
  })

  it("honors explicitly disabled auto-login and ignores storage cleanup failure", async () => {
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue({ webGuiAutoLogin: false })
    })
    mockProcess(report({ title: "disabled login", results: [result("passed")] }))
    const value: any = await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        prerequisiteConfirmation: confirmation
      }),
      token()
    )
    expect(value.parts[0].text).toContain("1 passed")

    const nonEmpty = path.join(root, "non-empty-state")
    await fs.mkdir(nonEmpty)
    await fs.writeFile(path.join(nonEmpty, "child"), "locked")
    await expect(cleanupStorageState(nonEmpty)).resolves.toBeUndefined()
  })

  it.each([false, true])("retains execution checks with bypass=%s", async bypass => {
    const base = {
      program: "PROGRAM",
      connectionId: "DEV100",
      skipWorkflowValidation: bypass,
      overrideReason: "User requested smoke testing"
    }
    if (!bypass) {
      await expect(tool.invoke(options(base), token())).rejects.toThrow(/prerequisiteConfirmation/)
    }
    ;(getTestFolder as Mock).mockReturnValue(undefined)
    await expect(
      tool.invoke(options({ ...base, prerequisiteConfirmation: confirmation }), token())
    ).rejects.toThrow(/No SAP testing folder/)
    ;(getTestFolder as Mock).mockReturnValue(root)
    ;(getWebGuiUrl as Mock).mockResolvedValue("ERROR: unavailable")
    await expect(
      tool.invoke(options({ ...base, prerequisiteConfirmation: confirmation }), token())
    ).rejects.toThrow("ERROR: unavailable")
    ;(getWebGuiUrl as Mock).mockResolvedValue("http://sap/webgui")
    await fs.rm(specDir, { recursive: true, force: true })
    await expect(
      tool.invoke(options({ ...base, prerequisiteConfirmation: confirmation }), token())
    ).rejects.toThrow(/No test-scripts folder/)

    await fs.mkdir(specDir, { recursive: true })
    await expect(
      tool.invoke(
        options({ ...base, tcIds: ["TC-404"], prerequisiteConfirmation: confirmation }),
        token()
      )
    ).rejects.toThrow(/No spec file found for: TC-404/)

    await fs.writeFile(path.join(specDir, "TC-001.spec.ts"), "await sap.finish()")
    const cases = path.join(root, "tests", "PROGRAM", "test-cases")
    await fs.mkdir(cases, { recursive: true })
    await fs.writeFile(
      path.join(cases, "TC-001.md"),
      "---\nverification: sql\nse16nTables: [EKKO]\n---\n"
    )
    if (bypass) {
      mockProcess(report({ title: "smoke", results: [result("passed")] }))
      const value: any = await tool.invoke(options({ ...base, tcIds: ["TC-001"] }), token())
      expect(value.parts[0].text).toContain("SE16N workflow proof")
      expect(value.parts[0].text).toContain("1 passed")
    } else {
      await expect(
        tool.invoke(
          options({ ...base, tcIds: ["TC-001"], prerequisiteConfirmation: confirmation }),
          token()
        )
      ).rejects.toThrow(/missing EKKO/)
      expect(spawn).not.toHaveBeenCalled()
    }
  })

  it("bypasses confirmations without planning artifacts and reports the actual scope", async () => {
    await fs.writeFile(path.join(specDir, "TC-001.spec.ts"), "test")
    mockProcess(report({ title: "smoke", results: [result("passed")] }))
    const value: any = await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        tcIds: ["TC-001"],
        skipWorkflowValidation: true,
        overrideReason: "  User requested execution only  "
      }),
      token()
    )
    expect(value.parts[0].text).toContain("WORKFLOW VALIDATION BYPASSED")
    expect(value.parts[0].text).toContain("Reason: User requested execution only")
    expect(value.parts[0].text).toContain("not verified")
    expect(value.parts[0].text).not.toContain(confirmation)
    expect(value.parts[0].text).toContain("1 passed")
  })

  it.each([undefined, "", "   "])("requires a bypass reason: %s", async overrideReason => {
    await expect(
      tool.invoke(
        options({
          program: "PROGRAM",
          connectionId: "DEV100",
          skipWorkflowValidation: true,
          overrideReason,
          prerequisiteConfirmation: confirmation
        }),
        token()
      )
    ).rejects.toThrow(/nonempty overrideReason/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it("still enforces authorization during a workflow bypass", async () => {
    vi.mocked(assertToolInvocationAuthorized).mockImplementationOnce(() => {
      throw new Error("Unauthorized")
    })
    await expect(
      tool.invoke(
        options({
          program: "PROGRAM",
          connectionId: "DEV100",
          skipWorkflowValidation: true,
          overrideReason: "User requested execution only"
        }),
        token()
      )
    ).rejects.toThrow("Unauthorized")
    expect(getWebGuiUrl).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each([false, true])("retains packaging checks with bypass=%s", async bypass => {
    ;(vscode.extensions.getExtension as Mock).mockReturnValue(undefined)
    await expect(
      tool.invoke(
        options({
          program: "PROGRAM",
          connectionId: "DEV100",
          skipWorkflowValidation: bypass,
          overrideReason: "User requested execution only",
          prerequisiteConfirmation: confirmation
        }),
        token()
      )
    ).rejects.toThrow("ABAP FS extension not found")
    ;(vscode.extensions.getExtension as Mock).mockReturnValue({ extensionPath: extension })
    await fs.rm(
      path.join(extension, "client", "dist", "vendor", "node_modules", "@playwright", "test"),
      { recursive: true, force: true }
    )
    await expect(
      tool.invoke(
        options({
          program: "PROGRAM",
          connectionId: "DEV100",
          skipWorkflowValidation: bypass,
          overrideReason: "User requested execution only",
          prerequisiteConfirmation: confirmation
        }),
        token()
      )
    ).rejects.toThrow("@playwright/test is not bundled")
  })

  it("supports string and default Playwright package bin declarations", async () => {
    const packageDir = path.join(
      extension,
      "client",
      "dist",
      "vendor",
      "node_modules",
      "@playwright",
      "test"
    )
    mockProcess(report({ title: "bin", results: [result("passed")] }))
    await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({ bin: "run.js" }))
    await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        prerequisiteConfirmation: confirmation
      }),
      token()
    )
    expect((spawn as unknown as Mock).mock.calls[0][1][0]).toMatch(/run\.js$/)

    vi.clearAllMocks()
    ;(vscode.extensions.getExtension as Mock).mockReturnValue({ extensionPath: extension })
    ;(formatKey as Mock).mockImplementation(function (value: string) {
      return value.toLowerCase()
    })
    ;(getTestFolder as Mock).mockReturnValue(root)
    ;(getWebGuiUrl as Mock).mockResolvedValue("http://sap/webgui")
    ;(resolveBrowserExecutable as Mock).mockResolvedValue({})
    ;(RemoteManager.get as Mock).mockReturnValue({
      byIdAsync: vi.fn().mockResolvedValue(null)
    })
    mockProcess(report({ title: "default bin", results: [result("passed")] }))
    await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({}))
    await tool.invoke(
      options({
        program: "PROGRAM",
        connectionId: "DEV100",
        prerequisiteConfirmation: confirmation
      }),
      token()
    )
    expect((spawn as unknown as Mock).mock.calls[0][1][0]).toMatch(/cli\.js$/)
  })

  it("registers the tool", () => {
    const context = { subscriptions: { push: vi.fn() } } as any
    ;(registerToolWithRegistry as Mock).mockReturnValue("registration")
    registerPlaywrightTestTool(context)
    expect(registerToolWithRegistry).toHaveBeenCalledWith(
      "abapfs_run_playwright_tests",
      expect.any(PlaywrightTestTool)
    )
    expect(context.subscriptions.push).toHaveBeenCalledWith("registration")
  })
})
