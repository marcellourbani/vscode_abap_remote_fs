import { EventEmitter } from "events"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

jest.mock(
  "vscode",
  () => ({
    extensions: { getExtension: jest.fn() },
    window: { showWarningMessage: jest.fn() },
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    lm: { registerTool: jest.fn() }
  }),
  { virtual: true }
)

jest.mock("./toolRegistry", () => ({ registerToolWithRegistry: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: jest.fn() }))
jest.mock("../../config", () => ({ formatKey: jest.fn(), RemoteManager: { get: jest.fn() } }))
jest.mock("../../lib", () => ({ log: { debug: jest.fn() } }))
jest.mock("../../adt/conections", () => ({ getOrCreateClient: jest.fn() }))
jest.mock("../../adt/sapgui/sapgui", () => ({ ssoLoginUrl: jest.fn() }))
jest.mock("../testing/config", () => ({ getTestFolder: jest.fn(), getWebGuiUrl: jest.fn() }))
jest.mock("../testing/browserResolver", () => ({ resolveBrowserExecutable: jest.fn() }))
jest.mock("child_process", () => ({ spawn: jest.fn() }))

import { spawn } from "child_process"
import * as vscode from "vscode"
import { formatKey, RemoteManager } from "../../config"
import { ssoLoginUrl } from "../../adt/sapgui/sapgui"
import { getTestFolder, getWebGuiUrl } from "../testing/config"
import { resolveBrowserExecutable } from "../testing/browserResolver"
import {
  PlaywrightTestTool,
  cleanupStorageState,
  killTree,
  playwrightArgs,
  registerPlaywrightTestTool,
  runProcess,
  summarizeReport
} from "./playwrightTestTool"
import { registerToolWithRegistry } from "./toolRegistry"

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
    onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() }))
  } as any
}

function options(input: Record<string, unknown>) {
  return { input } as any
}

function mockProcess(reportValue?: unknown, output = { stdout: "runner out", stderr: "" }) {
  ;(spawn as unknown as jest.Mock).mockImplementation(
    (_command: string, _args: string[], processOptions: { env: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as any
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.pid = 123
      child.exitCode = null
      child.signalCode = null
      child.kill = jest.fn()
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
    }
  )
}

describe("PlaywrightTestTool", () => {
  let root: string
  let extension: string
  let specDir: string
  let tool: PlaywrightTestTool

  beforeEach(async () => {
    jest.clearAllMocks()
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
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue({ extensionPath: extension })
    ;(formatKey as jest.Mock).mockImplementation((value: string) => value.toLowerCase())
    ;(getTestFolder as jest.Mock).mockReturnValue(root)
    ;(getWebGuiUrl as jest.Mock).mockResolvedValue("http://sap/webgui")
    ;(resolveBrowserExecutable as jest.Mock).mockResolvedValue({
      executablePath: "C:/browser.exe"
    })
    ;(RemoteManager.get as jest.Mock).mockReturnValue({
      byIdAsync: jest.fn().mockResolvedValue(null)
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

  it("runs an exact parallel subset with capped limits and one shared login URL", async () => {
    await fs.writeFile(path.join(specDir, "TC-001.spec.ts"), "test")
    await fs.writeFile(path.join(specDir, "TC-002.spec.ts"), "test")
    const launcher = { url: "http://launcher", dispose: jest.fn() }
    ;(RemoteManager.get as jest.Mock).mockReturnValue({
      byIdAsync: jest.fn().mockResolvedValue({ webGuiAutoLogin: true })
    })
    ;(ssoLoginUrl as jest.Mock).mockResolvedValue(launcher)
    ;(resolveBrowserExecutable as jest.Mock).mockResolvedValue({
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

    expect(value.parts[0].text).toContain("1 passed")
    expect(spawn).toHaveBeenCalledTimes(1)
    const [_command, args, processOptions] = (spawn as unknown as jest.Mock).mock.calls[0]
    expect(args).toEqual(expect.arrayContaining(["TC-001.spec.ts", "TC-002.spec.ts"]))
    expect(processOptions.env).toMatchObject({
      SAP_TESTING_PARALLEL: "1",
      SAP_TESTING_MAX_TASKS: "5",
      SAP_TESTING_MAX_FAILURES: "10",
      SAP_TESTING_HEADED: "1",
      SAP_TESTING_LOGIN_URL: "http://launcher",
      SAP_TESTING_BROWSER_EXECUTABLE: "C:/browser.exe",
      SAP_SYSTEM: "dev100",
      SAP_URL_DEV100: "http://sap/webgui"
    })
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("browser warning")
    expect(launcher.dispose).toHaveBeenCalledTimes(1)
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
    expect(value.parts[0].text).toContain("Playwright did not produce a report (exit code 1)")
    expect(value.parts[0].text).toContain("load failed")
    const [_command, args, processOptions] = (spawn as unknown as jest.Mock).mock.calls[0]
    expect(args.some((arg: string) => arg.endsWith(".spec.ts"))).toBe(false)
    expect(processOptions.env).toMatchObject({
      SAP_TESTING_PARALLEL: "0",
      SAP_TESTING_MAX_TASKS: "1",
      SAP_TESTING_MAX_FAILURES: "3",
      SAP_TESTING_HEADED: "0"
    })
  })

  it("continues without auto-login when connection setup throws", async () => {
    ;(RemoteManager.get as jest.Mock).mockReturnValue({
      byIdAsync: jest.fn().mockRejectedValue(new Error("session expired"))
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
    const processOptions = (spawn as unknown as jest.Mock).mock.calls[0][2]
    expect(processOptions.env.SAP_TESTING_LOGIN_URL).toBeUndefined()
  })

  it("handles non-Error auto-login failures and stdout-only report fallback", async () => {
    ;(RemoteManager.get as jest.Mock).mockReturnValue({
      byIdAsync: jest.fn().mockRejectedValue("offline")
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
    ;(RemoteManager.get as jest.Mock).mockReturnValue({
      byIdAsync: jest.fn().mockResolvedValue({ webGuiAutoLogin: false })
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

  it("rejects invalid readiness, folder, URL, spec directory, selected files, and gates", async () => {
    const base = { program: "PROGRAM", connectionId: "DEV100" }
    await expect(tool.invoke(options(base), token())).rejects.toThrow(/prerequisiteConfirmation/)
    ;(getTestFolder as jest.Mock).mockReturnValue(undefined)
    await expect(
      tool.invoke(options({ ...base, prerequisiteConfirmation: confirmation }), token())
    ).rejects.toThrow(/No SAP testing folder/)
    ;(getTestFolder as jest.Mock).mockReturnValue(root)
    ;(getWebGuiUrl as jest.Mock).mockResolvedValue("ERROR: unavailable")
    await expect(
      tool.invoke(options({ ...base, prerequisiteConfirmation: confirmation }), token())
    ).rejects.toThrow("ERROR: unavailable")
    ;(getWebGuiUrl as jest.Mock).mockResolvedValue("http://sap/webgui")
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
    await expect(
      tool.invoke(
        options({ ...base, tcIds: ["TC-001"], prerequisiteConfirmation: confirmation }),
        token()
      )
    ).rejects.toThrow(/missing EKKO/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it("fails clearly when the extension or vendored Playwright package is missing", async () => {
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined)
    await expect(
      tool.invoke(
        options({
          program: "PROGRAM",
          connectionId: "DEV100",
          prerequisiteConfirmation: confirmation
        }),
        token()
      )
    ).rejects.toThrow("ABAP FS extension not found")
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue({ extensionPath: extension })
    await fs.rm(
      path.join(extension, "client", "dist", "vendor", "node_modules", "@playwright", "test"),
      { recursive: true, force: true }
    )
    await expect(
      tool.invoke(
        options({
          program: "PROGRAM",
          connectionId: "DEV100",
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
    expect((spawn as unknown as jest.Mock).mock.calls[0][1][0]).toMatch(/run\.js$/)

    jest.clearAllMocks()
    ;(vscode.extensions.getExtension as jest.Mock).mockReturnValue({ extensionPath: extension })
    ;(formatKey as jest.Mock).mockImplementation((value: string) => value.toLowerCase())
    ;(getTestFolder as jest.Mock).mockReturnValue(root)
    ;(getWebGuiUrl as jest.Mock).mockResolvedValue("http://sap/webgui")
    ;(resolveBrowserExecutable as jest.Mock).mockResolvedValue({})
    ;(RemoteManager.get as jest.Mock).mockReturnValue({
      byIdAsync: jest.fn().mockResolvedValue(null)
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
    expect((spawn as unknown as jest.Mock).mock.calls[0][1][0]).toMatch(/cli\.js$/)
  })

  it("registers the tool", () => {
    const context = { subscriptions: { push: jest.fn() } } as any
    ;(registerToolWithRegistry as jest.Mock).mockReturnValue("registration")
    registerPlaywrightTestTool(context)
    expect(registerToolWithRegistry).toHaveBeenCalledWith(
      "playwright_test",
      expect.any(PlaywrightTestTool)
    )
    expect(context.subscriptions.push).toHaveBeenCalledWith("registration")
  })
})

function fakeChild() {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 321
  child.exitCode = null
  child.signalCode = null
  child.kill = jest.fn()
  return child
}

describe("Playwright process lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("captures both streams and settles on close", async () => {
    const child = fakeChild()
    ;(spawn as unknown as jest.Mock).mockReturnValue(child)
    const cancel = { dispose: jest.fn() }
    const runToken = { onCancellationRequested: jest.fn(() => cancel) } as any
    const promise = runProcess("node", ["cli"], { cwd: "C:/tests", env: {} }, runToken)
    child.stdout.emit("data", Buffer.from("out\n"))
    child.stderr.emit("data", Buffer.from("err\n"))
    child.emit("close", 2)
    child.emit("close", 3)
    await expect(promise).resolves.toEqual({ code: 2, stdout: "out\n", stderr: "err\n" })
    expect(cancel.dispose).toHaveBeenCalledTimes(1)
  })

  it("settles through the exit grace path when close never arrives", async () => {
    jest.useFakeTimers()
    const child = fakeChild()
    ;(spawn as unknown as jest.Mock).mockReturnValue(child)
    const promise = runProcess("node", [], { cwd: "C:/tests", env: {} }, token())
    child.emit("exit", 0)
    jest.advanceTimersByTime(2_000)
    await expect(promise).resolves.toEqual({ code: 0, stdout: "", stderr: "" })
    jest.useRealTimers()
  })

  describe("on Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" })
    })

    afterEach(() => {
      Object.defineProperty(process, "platform", platform)
    })

    it("kills an active process tree on cancellation", async () => {
      const child = fakeChild()
      const taskkill = fakeChild()
      const calls: any[] = []
      ;(spawn as unknown as jest.Mock).mockImplementation((...args: any[]) => {
        calls.push(args)
        return calls.length === 1 ? child : taskkill
      })
      let cancel: (() => void) | undefined
      const runToken = {
        onCancellationRequested: jest.fn((handler: () => void) => {
          cancel = handler
          return { dispose: jest.fn() }
        })
      } as any
      const promise = runProcess("node", [], { cwd: "C:/tests", env: {} }, runToken)
      cancel!()
      child.signalCode = "SIGKILL"
      child.emit("close", null)
      await promise
      expect(calls[1][0]).toBe("taskkill")
      expect(calls[1][1]).toEqual(["/pid", "321", "/T", "/F"])
    })

    it("does not kill a settled child and falls back when taskkill fails", () => {
      const settled = fakeChild()
      settled.exitCode = 0
      killTree(settled)
      expect(spawn).not.toHaveBeenCalled()

      const child = fakeChild()
      const taskkill = fakeChild()
      ;(spawn as unknown as jest.Mock).mockReturnValue(taskkill)
      killTree(child)
      taskkill.emit("error", new Error("taskkill unavailable"))
      expect(child.kill).toHaveBeenCalledTimes(1)
    })
  })

  it("kills a POSIX process group and falls back to the child when that fails", () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!
    Object.defineProperty(process, "platform", { value: "linux" })
    const processKill = jest.spyOn(process, "kill").mockImplementation(() => true)
    try {
      const grouped = fakeChild()
      killTree(grouped)
      expect(processKill).toHaveBeenCalledWith(-321, "SIGKILL")

      processKill.mockImplementation(() => {
        throw new Error("no group")
      })
      const fallback = fakeChild()
      killTree(fallback)
      expect(fallback.kill).toHaveBeenCalledWith("SIGKILL")
    } finally {
      processKill.mockRestore()
      Object.defineProperty(process, "platform", descriptor)
    }
  })
})
