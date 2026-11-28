/**
 * abapfs_run_playwright_tests — runs the real @playwright/test CLI as a subprocess against a
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
import { funWindow } from "../funMessenger"

import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { formatKey, RemoteManager } from "../../config"
import { log } from "../../lib"
import { getOrCreateClient } from "../../adt/conections"
import { ssoLoginUrl } from "../../adt/sapgui/sapgui"
import { type SsoLauncher } from "../../adt/sapgui/ssoLaunch"
import { getTestFolder, getWebGuiUrl } from "../testing/config"
import { resolveBrowserExecutable } from "../testing/browserResolver"
import {
  normalizeMaxFailures,
  normalizeMaxTasks,
  normalizeTcIds
} from "../testing/playwright-limits"
import { findSqlVerificationGateErrors } from "../testing/verification-gate"
import {
  createRunDir,
  newRunId,
  pruneRuns,
  runsRoot,
  writeRunLog
} from "../testing/playwright-run-store"
import { type TestingWorkflowOverride, workflowBypassNotice } from "./testingWorkflowOverride"

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

export interface IPlaywrightTestParameters extends TestingWorkflowOverride {
  program: string
  tcIds?: string[]
  connectionId: string
  headed?: boolean
  maxFailures?: number
  runInParallel?: boolean
  maxTasks?: number
  keepArtifacts?: boolean
  prerequisiteConfirmation?: string
}

/**
 * The exact sentence required by default before a run. Explicit workflow overrides skip
 * this certification rather than asking the model to claim checks it did not perform.
 * Same behavioral-gate
 * technique as abapfs_build_test_index's reviewerConfirmation: the tool cannot itself re-derive
 * every upstream phase gate cheaply, but requiring the model to type this certification
 * forces it to consciously complete the run-scripts Step 0 gate (artifacts present, data
 * readiness confirmed via abapfs_check_test_data) instead of firing a run and hoping.
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

/** Playwright is copied into the bundle as loose files; its CLI forks worker processes by real path and can't be bundled. */
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

/** Playwright colors its error text with ANSI escapes, which show up as noise in tool output. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "")
}

function collectSpecs(suite: JsonReportSuite | undefined, out: JsonReportSpec[]): void {
  if (!suite) return
  for (const s of suite.specs ?? []) out.push(s)
  for (const child of suite.suites ?? []) collectSpecs(child, out)
}

export function summarizeReport(report: JsonReport, maxFailures: number): string {
  const specs: JsonReportSpec[] = []
  for (const suite of report.suites ?? []) collectSpecs(suite, specs)

  if (!specs.length) {
    const errs = (report.errors ?? []).map(e => e.message && stripAnsi(e.message)).filter(Boolean)
    return errs.length ? `No tests ran. Errors:\n${errs.join("\n")}` : "No tests matched."
  }

  const lines: string[] = []
  let passed = 0
  let failed = 0
  let interrupted = 0
  let notRun = 0
  let total = 0
  for (const spec of specs) {
    for (const test of spec.tests) {
      total++
      const last = test.results[test.results.length - 1]
      const status = last?.status ?? "unknown"
      if (status === "passed") {
        passed++
        lines.push(`PASS  ${spec.title}`)
      } else if (status === "interrupted") {
        interrupted++
        lines.push(`INTERRUPTED  ${spec.title}`)
      } else if (status === "skipped" || status === "unknown") {
        notRun++
        lines.push(`NOT RUN  ${spec.title}`)
      } else {
        failed++
        lines.push(`FAIL  ${spec.title}`)
        if (last?.error?.message) {
          lines.push(
            stripAnsi(last.error.message)
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
        // snapshots — instead of guessing. Traces live under the per-call folder reported below.
        for (const att of last?.attachments ?? []) {
          if (att.path && /trace|screenshot|snapshot|\.zip$|\.png$/i.test(att.name + att.path)) {
            lines.push(`        [${att.name}] ${att.path}`)
          }
        }
      }
    }
  }
  lines.push("")
  lines.push(
    `${passed} passed, ${failed} failed, ${interrupted} interrupted, ` +
      `${notRun} not run (${total} selected)`
  )
  const stoppedEarly = (report.errors ?? []).some(error =>
    /stopped early|maximum allowed failures/i.test(error.message ?? "")
  )
  if (stoppedEarly || (failed >= maxFailures && interrupted + notRun > 0)) {
    lines.push(`Run stopped early after reaching maxFailures=${maxFailures}.`)
  }
  if (failed > 0) {
    lines.push(
      "For each FAIL: open the trace (path above, under the per-call run folder) " +
        "for request/response bodies and per-step DOM; the last step + screenshot are in " +
        "test-results/<CONNECTION-ID>/<TC-ID>/ (connectionId UPPERCASE). Diagnose before rerunning."
    )
  }
  return lines.join("\n")
}

export function playwrightArgs(configPath: string, tcIds?: string[]): string[] {
  return ["test", "--config", configPath, ...(tcIds?.map(tcId => `${tcId}.spec.ts`) ?? [])]
}

function splitTcIds(tcIds: string[], maxTasks: number): string[][] {
  const taskCount = Math.min(tcIds.length, maxTasks)
  const tasks = Array.from({ length: taskCount }, () => [] as string[])
  tcIds.forEach((tcId, index) => tasks[index % taskCount].push(tcId))
  return tasks
}

export function cleanupStorageState(storageStateFile: string): Promise<void> {
  return fs.rm(storageStateFile, { force: true }).catch(() => {})
}

export class PlaywrightTestTool implements vscode.LanguageModelTool<IPlaywrightTestParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IPlaywrightTestParameters>,
    _token: vscode.CancellationToken
  ) {
    const { program, tcIds, connectionId } = options.input
    const selection = tcIds?.join(", ") ?? "all specs"
    return {
      invocationMessage: `Running ${selection} for ${program} on ${connectionId}`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IPlaywrightTestParameters>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_playwright_test_called")

    const bypassNotice = workflowBypassNotice(
      options.input,
      "prerequisite confirmation and SE16N workflow proof"
    )
    const invokeStarted = Date.now()
    const { program, headed } = options.input
    const tcIds = normalizeTcIds(options.input.tcIds)
    const maxFailures = normalizeMaxFailures(options.input.maxFailures)
    const runInParallel = options.input.runInParallel === true
    const maxTasks = runInParallel ? normalizeMaxTasks(options.input.maxTasks) : 1
    log.debug(
      `[playwright] invoke ${tcIds?.join(", ") ?? "all specs"} for ${program} ` +
        `(${runInParallel ? `${maxTasks} parallel tasks` : "sequential"})`
    )

    if (
      !bypassNotice &&
      normalizeConfirmation(options.input.prerequisiteConfirmation) !==
        normalizeConfirmation(REQUIRED_PREREQUISITE_CONFIRMATION)
    ) {
      throw new Error(
        "abapfs_run_playwright_tests is blocked: the mandatory 'prerequisiteConfirmation' field was " +
          "missing or did not match. Before running, complete the run-scripts Step 0 gate — " +
          "confirm the case/spec/screens/index artifacts exist and that abapfs_check_test_data " +
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

    if (tcIds) {
      const missing: string[] = []
      for (const tcId of tcIds) {
        const exists = await fs
          .stat(path.join(specDir, `${tcId}.spec.ts`))
          .then(stat => stat.isFile())
          .catch(() => false)
        if (!exists) missing.push(tcId)
      }
      if (missing.length) {
        throw new Error(`No spec file found for: ${missing.join(", ")}.`)
      }
    }

    if (!bypassNotice) {
      const verificationErrors = await findSqlVerificationGateErrors(testFolder, program, tcIds)
      if (verificationErrors.length) {
        throw new Error(
          `abapfs_run_playwright_tests blocked: SQL/mixed post-validation cases require SE16N screenshot ` +
            `proof in the matching spec:\n- ${verificationErrors.join("\n- ")}`
        )
      }
    }

    const extPath = extensionPath()
    const cliPath = await resolvePlaywrightCli(extPath)
    const configPath = path.join(vendorDir(extPath), "playwright.config.js")
    const browser = await timed("resolve browser executable", () => resolveBrowserExecutable())
    if (browser.warning) {
      funWindow.showWarningMessage(browser.warning)
    }

    let taskIds: string[][]
    if (!runInParallel) {
      taskIds = [tcIds ?? []]
    } else {
      const selectedIds =
        tcIds ??
        (await fs.readdir(specDir))
          .filter(name => /^TC-[A-Za-z0-9-]+\.spec\.ts$/i.test(name))
          .map(name => name.replace(/\.spec\.ts$/i, ""))
          .sort()
      taskIds = splitTcIds(selectedIds, maxTasks)
    }

    const runId = newRunId(connectionId)
    const callDir = await createRunDir(testFolder, runId)
    const keepArtifacts = options.input.keepArtifacts === true

    const workerReports = await Promise.all(
      taskIds.map(async (workerTcIds, workerIndex) => {
        const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "abapfs-testing-"))
        const workerDir = path.join(callDir, `worker-${workerIndex + 1}`)
        await fs.mkdir(workerDir, { recursive: true })
        const reportFile = path.join(runDir, "report.json")
        // A parallel worker must establish its own SAP session, not clone a sibling's cookie.
        const storageStateFile = path.join(runDir, "storage-state.json")
        const loginUrl = await tryLoginUrl(connectionId, url)
        log.debug(
          loginUrl
            ? `[playwright] worker ${workerIndex + 1}: own SAP login URL ready`
            : `[playwright] worker ${workerIndex + 1}: auto-login unavailable`
        )
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          SAP_TESTING_ROOT: testFolder,
          SAP_TESTING_SPEC_DIR: specDir,
          SAP_TESTING_HEADED: headed ? "1" : "0",
          SAP_TESTING_MAX_FAILURES: String(maxFailures),
          SAP_TESTING_PARALLEL: "0",
          SAP_TESTING_MAX_TASKS: "1",
          SAP_TESTING_REPORT_FILE: reportFile,
          SAP_TESTING_STORAGE_STATE: storageStateFile,
          SAP_TESTING_ARTIFACTS_DIR: path.join(workerDir, "artifacts"),
          SAP_TESTING_KEEP_ARTIFACTS: keepArtifacts ? "1" : "0",
          SAP_SYSTEM: connectionId,
          [`SAP_URL_${connectionId.toUpperCase()}`]: url
        }
        if (loginUrl) env.SAP_TESTING_LOGIN_URL = loginUrl.url
        if (browser.executablePath) {
          env.SAP_TESTING_BROWSER_EXECUTABLE = browser.executablePath
        }

        try {
          const args = playwrightArgs(configPath, runInParallel ? workerTcIds : tcIds)
          const { code, stdout, stderr } = await timed(`playwright worker ${workerIndex + 1}`, () =>
            runProcess(process.execPath, [cliPath, ...args], { cwd: testFolder, env }, token)
          )
          await writeRunLog(workerDir, stdout, stderr)
          try {
            const raw = await fs.readFile(reportFile, "utf8")
            await fs.writeFile(path.join(workerDir, "report.json"), raw, "utf8").catch(() => {})
            return JSON.parse(raw) as JsonReport
          } catch {
            return {
              errors: [
                {
                  message:
                    `Playwright worker ${workerIndex + 1} did not produce a report ` +
                    `(exit code ${code}).\n${stderr || stdout}`
                }
              ]
            } satisfies JsonReport
          }
        } finally {
          // A cancelled worker may leave its one-shot ticket unused; always close its listener.
          loginUrl?.dispose()
          await cleanupStorageState(storageStateFile)
          await fs.rm(runDir, { recursive: true, force: true })
        }
      })
    )

    const mergedReport: JsonReport = {
      suites: workerReports.flatMap(worker => worker.suites ?? []),
      errors: workerReports.flatMap(worker => worker.errors ?? [])
    }
    const summaryStarted = Date.now()
    const summary = summarizeReport(mergedReport, maxFailures)
    log.debug(`[playwright] summarized report in ${Date.now() - summaryStarted}ms`)
    log.debug(`[playwright] returning to model after ${Date.now() - invokeStarted}ms total`)

    await pruneRuns(testFolder, runId)
    const runsNote =
      `\nFull report, runner log and traces for this call: ${callDir}` +
      ` (kept automatically; only the newest runs under ${runsRoot(testFolder)} are retained).`
    const withNote = summary + runsNote
    const output = bypassNotice ? `${bypassNotice}\n\n${withNote}` : withNote
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(output)])
  }
}

export function registerPlaywrightTestTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("abapfs_run_playwright_tests", new PlaywrightTestTool())
  )
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
export function killTree(child: ReturnType<typeof spawn>): void {
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

export function runProcess(
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
