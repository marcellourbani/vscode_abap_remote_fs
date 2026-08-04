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
import { formatKey } from "../../config"
import { getTestFolder, getWebGuiUrl } from "../testing/config"
import { resolveBrowserExecutable } from "../testing/browserResolver"

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
  const testPkgDir = path.join(vendorDir(extPath), "@playwright", "test")
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

type JsonReportTestResult = {
  status: string
  error?: { message?: string }
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
              .slice(0, 6)
              .map(l => `        ${l}`)
              .join("\n")
          )
        }
      }
    }
  }
  lines.push("")
  lines.push(`${passed} passed, ${failed} failed (${specs.length} total)`)
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

    const { program, tcId, headed } = options.input

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
        'No SAP testing folder configured. Ask the user to run "ABAP FS: Set Test Folder".'
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
    const reportFile = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "abapfs-testing-")),
      "report.json"
    )

    const args = ["test", "--config", configPath]
    if (tcId) args.push(tcId)

    const browser = await resolveBrowserExecutable()
    if (browser.warning) {
      vscode.window.showWarningMessage(browser.warning)
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SAP_TESTING_ROOT: testFolder,
      SAP_TESTING_SPEC_DIR: specDir,
      SAP_TESTING_HEADED: headed ? "1" : "0",
      SAP_TESTING_REPORT_FILE: reportFile,
      SAP_SYSTEM: connectionId,
      [`SAP_URL_${connectionId}`]: url
    }
    if (browser.executablePath) {
      env.SAP_TESTING_BROWSER_EXECUTABLE = browser.executablePath
    }

    const { code, stdout, stderr } = await runProcess(
      process.execPath,
      [cliPath, ...args],
      { cwd: testFolder, env },
      token
    )

    let summary: string
    try {
      const reportRaw = await fs.readFile(reportFile, "utf8")
      summary = summarizeReport(JSON.parse(reportRaw))
    } catch {
      // JSON reporter didn't produce a file — likely a config/spec-load error before
      // any test ran. Fall back to raw process output so the AI can still diagnose it.
      summary = `Playwright did not produce a report (exit code ${code}).\n\n${stderr || stdout}`
    }

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)])
  }
}

export function registerPlaywrightTestTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("playwright_test", new PlaywrightTestTool()))
}

function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
  token: vscode.CancellationToken
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", d => (stdout += d.toString()))
    child.stderr?.on("data", d => (stderr += d.toString()))
    const cancelSub = token.onCancellationRequested(() => child.kill())
    child.on("close", code => {
      cancelSub.dispose()
      resolve({ code, stdout, stderr })
    })
  })
}
