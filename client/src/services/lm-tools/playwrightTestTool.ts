/**
 * playwright_test — runs the real @playwright/test CLI as a subprocess against a
 * spec (or every spec) under a program's test-scripts/ folder, using the extension's
 * own bundled Node/Playwright — the end user never installs or runs anything.
 *
 * Why a subprocess (deliberately, not in-process): @playwright/test's runner is
 * architected around worker *processes* even for a single test, so there is no
 * supported in-process invocation to fall back to. A subprocess also means a hung
 * SAP session or a runaway test can be killed cleanly without taking down the whole
 * extension host, and it means every native Playwright debugging feature (trace
 * viewer, --headed, the VS Code Playwright extension) keeps working exactly as
 * documented, because it genuinely is @playwright/test running, not a reimplementation.
 *
 * We spawn `process.execPath` (VS Code's own bundled Node) — never a system Node —
 * so end users need nothing installed themselves.
 */
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { spawn } from "child_process"

import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { formatKey, RemoteManager } from "../../config"
import { log } from "../../lib"
import { getOrCreateClient } from "../../adt/conections"
import { ssoLoginUrl } from "../../adt/sapgui/sapgui"
import { SsoLauncher } from "../../adt/sapgui/ssoLaunch"
import { getTestFolder, getWebGuiUrl } from "../testing/config"
import { resolveBrowserExecutable } from "../testing/browserResolver"

/** Time a startup phase into the debug channel, so a slow run points at a specific step. */
async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now()
  log.debug(`[playwright] ${label}...`)
  try {
    return await work()
  } finally {
    log.debug(`[playwright] ${label} took ${Date.now() - started}ms`)
  }
}

export interface IPlaywrightTestParameters {
  program: string
  tcId?: string
  connectionId: string
  headed?: boolean
  prerequisiteConfirmation: string
}

/**
 * The exact sentence the model must pass before a run is allowed. Same behavioral-gate
 * technique as build_test_index's reviewerConfirmation: the tool cannot itself re-derive
 * every upstream phase gate cheaply, but requiring the model to type this certification
 * forces it to consciously complete the run-scripts Step 0 gate (artifacts present, data
 * readiness confirmed via check_test_data) instead of firing a run and hoping.
 */
const REQUIRED_PREREQUISITE_CONFIRMATION =
  "I verified all upstream phase gates and test data readiness for this program"

/**
 * The login URL has to stay valid until globalSetup has started a browser of its own, which
 * on a cold start is far slower than opening an already-running one.
 */
const LOGIN_URL_TIMEOUT_MS = 180_000

/**
 * One-shot URL that authenticates a browser against `webguiUrl`, or undefined when the
 * connection opts out of auto-login, can't mint a ticket, or isn't reachable. Never throws:
 * a run without auto-login is still valid — the system may authenticate by other means.
 */
async function tryLoginUrl(
  connectionId: string,
  webguiUrl: string
): Promise<SsoLauncher | undefined> {
  try {
    const conn = await RemoteManager.get().byIdAsync(connectionId)
    if (!conn) return undefined
    if (conn.webGuiAutoLogin === false) return undefined
    const client = await timed("connect ADT session", () => getOrCreateClient(connectionId))
    return await timed("mint reentrance ticket", () =>
      // redirect: false — globalSetup only needs the session cookie. Following through to
      // WebGUI would open a second SAP session per run that nothing ever logs off.
      ssoLoginUrl(conn, client, webguiUrl, { timeoutMs: LOGIN_URL_TIMEOUT_MS, redirect: false })
    )
  } catch (e) {
    log.debug(`[playwright] auto-login unavailable: ${e instanceof Error ? e.message : e}`)
    return undefined
  }
}

function normalizeConfirmation(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").replace(/[.]+$/, "").toLowerCase()
}

/** Playwright is copied into the bundle as loose files; webpack cannot bundle its CLI. */
function vendorDir(extensionPath: string): string {
  return path.join(extensionPath, "client", "dist", "vendor")
}

function extensionPath(): string {
  const extension = vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")
  if (!extension) throw new Error("ABAP FS extension not found")
  return extension.extensionPath
}

async function resolvePlaywrightCli(extPath: string): Promise<string> {
  // A real node_modules layout, so Playwright's own require("playwright-core") resolves.
  const testPkgDir = path.join(vendorDir(extPath), "node_modules", "@playwright", "test")
  const pkgRaw = await fs.readFile(path.join(testPkgDir, "package.json"), "utf8").catch(() => null)
  if (!pkgRaw) {
    throw new Error(
      `@playwright/test is not bundled with this extension (expected at ${testPkgDir}). ` +
        `This is a packaging bug, not something the user can fix.`
    )
  }
  const pkg = JSON.parse(pkgRaw)
  const binRel = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin?.["playwright"] ?? "cli.js")
  return path.join(testPkgDir, binRel)
}

type JsonReportAttachment = { name: string; path?: string; contentType?: string }
type JsonReportTestResult = {
  status: string
  error?: {
    message?: string
    location?: { file?: string; line?: number; column?: number }
  }
  attachments?: JsonReportAttachment[]
  duration?: number
}
type JsonReportTest = {
  title: string
  results: JsonReportTestResult[]
}
type JsonReportSpec = { title: string; tests: JsonReportTest[] }
type JsonReportSuite = { specs?: JsonReportSpec[]; suites?: JsonReportSuite[] }
type JsonReport = {
  suites?: JsonReportSuite[]
  errors?: Array<{ message?: string }>
}

function collectSpecs(suite: JsonReportSuite | undefined, out: JsonReportSpec[]): void {
  if (!suite) return
  for (const s of suite.specs ?? []) out.push(s)
  for (const child of suite.suites ?? []) collectSpecs(child, out)
}

function summarizeReport(report: JsonReport): string {
  const specs: JsonReportSpec[] = []
  for (const suite of report.suites ?? []) collectSpecs(suite, specs)

  if (!specs.length) {
    const errs = (report.errors ?? []).map(e => e.message).filter(Boolean)
    return errs.length ? `No tests ran. Errors:\n${errs.join("\n")}` : "No tests matched."
  }

  const lines: string[] = []
  let passed = 0
  let failed = 0
  for (const spec of specs) {
    for (const test of spec.tests) {
      const last = test.results[test.results.length - 1]
      const status = last?.status ?? "unknown"
      if (status === "passed") {
        passed++
        lines.push(`PASS  ${spec.title}`)
      } else {
        failed++
        lines.push(`FAIL  ${spec.title}`)
        if (last?.error?.message) {
          lines.push(
            last.error.message
              .split("\n")
              .slice(0, 8)
              .map(l => `        ${l}`)
              .join("\n")
          )
        }
        // Point at the exact failing line so diagnosis doesn't start from the spec title alone.
        const loc = last?.error?.location
        if (loc?.file) {
          lines.push(`        at ${loc.file}${loc.line ? `:${loc.line}` : ""}`)
        }
        // Surface artifact paths (trace zip, failure screenshot, error context) so the model
        // can open the trace — which contains the HTTP request/response bodies and per-step DOM
        // snapshots — instead of guessing. Traces live under <root>/.playwright-artifacts/.
        for (const att of last?.attachments ?? []) {
          if (att.path && /trace|screenshot|snapshot|\.zip$|\.png$/i.test(att.name + att.path)) {
            lines.push(`        [${att.name}] ${att.path}`)
          }
        }
      }
    }
  }
  lines.push("")
  lines.push(`${passed} passed, ${failed} failed (${specs.length} total)`)
  if (failed > 0) {
    lines.push(
      "For each FAIL: open the trace (path above, under <test-folder>/.playwright-artifacts/) " +
        "for request/response bodies and per-step DOM; the last step + screenshot are in " +
        "test-results/<CONNECTION-ID>/<TC-ID>/ (connectionId UPPERCASE). Diagnose before rerunning."
    )
  }
  return lines.join("\n")
}

export class PlaywrightTestTool implements vscode.LanguageModelTool<IPlaywrightTestParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IPlaywrightTestParameters>,
    _token: vscode.CancellationToken
  ) {
    const { program, tcId, connectionId } = options.input
    return {
      invocationMessage: `Running ${tcId ?? "all specs"} for ${program} on ${connectionId}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IPlaywrightTestParameters>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_playwright_test_called")

    const invokeStarted = Date.now()
    const { program, tcId, headed } = options.input
    log.debug(`[playwright] invoke ${tcId ?? "all specs"} for ${program}`)

    if (
      normalizeConfirmation(options.input.prerequisiteConfirmation) !==
      normalizeConfirmation(REQUIRED_PREREQUISITE_CONFIRMATION)
    ) {
      throw new Error(
        "playwright_test is blocked: the mandatory 'prerequisiteConfirmation' field was " +
          "missing or did not match. Before running, complete the run-scripts Step 0 gate — " +
          "confirm the case/spec/screens/index artifacts exist and that check_test_data " +
          "reports the selected cases resolvable on this connection. Then re-call this tool " +
          `passing prerequisiteConfirmation exactly as: "${REQUIRED_PREREQUISITE_CONFIRMATION}".`
      )
    }

    // Lowercase is ABAP FS's canonical connection id, and it also names the
    // per-system results folder, so the same system always maps to one folder.
    const connectionId = formatKey(options.input.connectionId)
    const testFolder = getTestFolder()
    if (!testFolder) {
      throw new Error(
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Enable SAP UI Testing Features".'
      )
    }

    const url = await getWebGuiUrl(connectionId)
    if (url.startsWith("ERROR:")) throw new Error(url)

    const specDir = path.resolve(testFolder, "tests", program, "test-scripts")
    try {
      await fs.stat(specDir)
    } catch {
      throw new Error(`No test-scripts folder found at ${specDir}.`)
    }

    const extPath = extensionPath()
    const cliPath = await resolvePlaywrightCli(extPath)
    const configPath = path.join(vendorDir(extPath), "playwright.config.js")
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "abapfs-testing-"))
    const reportFile = path.join(runDir, "report.json")
    // Holds a live session cookie, so it lives in the temp dir and is deleted after the run.
    const storageStateFile = path.join(runDir, "storage-state.json")

    const args = ["test", "--config", configPath]
    if (tcId) args.push(tcId)

    const browser = await timed("resolve browser executable", () => resolveBrowserExecutable())
    if (browser.warning) {
      vscode.window.showWarningMessage(browser.warning)
    }

    const loginUrl = await tryLoginUrl(connectionId, url)
    // Logged host-side so the auto-login decision is visible even if the child says nothing.
    log.debug(
      loginUrl
        ? "[playwright] auto-login enabled, login URL passed to globalSetup"
        : "[playwright] auto-login not in use — SAP must authenticate this session by other means"
    )
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SAP_TESTING_ROOT: testFolder,
      SAP_TESTING_SPEC_DIR: specDir,
      SAP_TESTING_HEADED: headed ? "1" : "0",
      SAP_TESTING_REPORT_FILE: reportFile,
      SAP_TESTING_STORAGE_STATE: storageStateFile,
      SAP_SYSTEM: connectionId,
      [`SAP_URL_${connectionId}`]: url
    }
    if (loginUrl) env.SAP_TESTING_LOGIN_URL = loginUrl.url
    if (browser.executablePath) {
      env.SAP_TESTING_BROWSER_EXECUTABLE = browser.executablePath
    }

    const { code, stdout, stderr } = await timed("playwright run", () =>
      runProcess(process.execPath, [cliPath, ...args], { cwd: testFolder, env }, token)
    ).finally(() => {
      // A cancelled run never fetches the login URL, so without this a usable ticket stays
      // served on a loopback port until its expiry elapses.
      loginUrl?.dispose()
      return fs.rm(storageStateFile, { force: true }).catch(() => {})
    })

    let summary: string
    const summaryStarted = Date.now()
    try {
      const reportRaw = await fs.readFile(reportFile, "utf8")
      summary = summarizeReport(JSON.parse(reportRaw))
    } catch {
      // JSON reporter didn't produce a file — likely a config/spec-load error before
      // any test ran. Fall back to raw process output so the AI can still diagnose it.
      summary = `Playwright did not produce a report (exit code ${code}).\n\n${stderr || stdout}`
    }
    log.debug(`[playwright] summarized report in ${Date.now() - summaryStarted}ms`)
    log.debug(`[playwright] returning to model after ${Date.now() - invokeStarted}ms total`)

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)])
  }
}

export function registerPlaywrightTestTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("playwright_test", new PlaywrightTestTool()))
}

/**
 * How long to keep reading stdio after the process has exited. "close" is the correct signal
 * but it waits for every inherited pipe to be released, and a browser grandchild that outlives
 * the run can hold one open for minutes, long after the results are on disk.
 */
const STDIO_FLUSH_GRACE_MS = 2_000

/**
 * Kill the runner AND everything it started. `child.kill()` reaches only the CLI process;
 * Playwright's worker and the browser it drives are grandchildren, and on Windows they
 * survive as orphans — still holding the SAP session, which makes every later run contend
 * with a logon that never ended.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  log.debug(`[playwright] cancelled — killing process tree (pid ${child.pid})`)
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on(
      "error",
      () => child.kill()
    )
    return
  }
  try {
    process.kill(-child.pid, "SIGKILL") // negative pid = the whole process group
  } catch {
    child.kill("SIGKILL")
  }
}

function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
  token: vscode.CancellationToken
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      // Its own process group, so a cancel can take the group down in one call.
      detached: process.platform !== "win32"
    })
    let stdout = ""
    let stderr = ""
    let lastOutputAt = Date.now()
    // Mirrored to the channel as it arrives: buffering alone tells you nothing until the
    // run ends, which is exactly the case worth diagnosing.
    const capture = (stream: "out" | "err") => (d: Buffer) => {
      const text = d.toString()
      lastOutputAt = Date.now()
      if (stream === "out") stdout += text
      else stderr += text
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) log.debug(`[playwright:${stream}] ${line}`)
      }
    }
    child.stdout?.on("data", capture("out"))
    child.stderr?.on("data", capture("err"))
    const cancelSub = token.onCancellationRequested(() => killTree(child))

    let graceTimer: NodeJS.Timeout | undefined
    let settled = false
    const finish = (code: number | null, via: string) => {
      if (settled) return
      settled = true
      if (graceTimer) clearTimeout(graceTimer)
      cancelSub.dispose()
      log.debug(`[playwright] process settled via ${via} (exit code ${code})`)
      resolve({ code, stdout, stderr })
    }

    child.on("exit", code => {
      // A long gap here means the runner was busy AFTER its last output — trace zipping,
      // worker teardown, or a browser it hasn't closed yet.
      log.debug(
        `[playwright] process exited with ${code}, ` +
          `${Date.now() - lastOutputAt}ms after its last output; flushing`
      )
      graceTimer = setTimeout(() => finish(code, "exit+grace"), STDIO_FLUSH_GRACE_MS)
    })
    child.on("close", code => finish(code, "close"))
  })
}
