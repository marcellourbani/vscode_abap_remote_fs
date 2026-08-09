import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { spawn } from "child_process"

import { pickAdtRoot } from "../../config"
import { withAutoLogin } from "../../adt/sapgui/sapgui"
import { getTestFolder, getWebGuiUrl } from "./config"
import { resolveBrowserExecutable } from "./browserResolver"

let recorderRunning = false

/** Ask which connected system to record against, then resolve its WebGUI URL. */
async function pickWebGuiUrl(): Promise<string | undefined> {
  const root = await pickAdtRoot()
  if (!root) return undefined

  const url = await getWebGuiUrl(root.uri.authority)
  if (url.startsWith("ERROR:")) throw new Error(url)

  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`The SAP WebGUI URL must use HTTP or HTTPS: ${url}`)
  }
  // Codegen records what the user does; starting on a logon screen would put credential
  // typing into the recording and leave every generated selector one screen out of step.
  return withAutoLogin(root.uri.authority, parsed.toString())
}

async function chooseRecordingPath(testFolder: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: "Name this SAP WebGUI recording",
    prompt:
      "Use a short descriptive name. The recording is reference evidence, not a runnable test.",
    placeHolder: "me21n-edit-po-item",
    validateInput: value => {
      const trimmed = value.trim()
      if (!trimmed) return "Enter a recording name."
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(trimmed)) {
        return "Use 1-80 letters, numbers, hyphens, or underscores; start with a letter or number."
      }
      return undefined
    }
  })
  if (name === undefined) return undefined

  const recordingDir = path.join(testFolder, "recordings")
  await fs.mkdir(recordingDir, { recursive: true })
  const outputPath = path.join(recordingDir, `${name.trim()}.recording.ts`)
  try {
    await fs.access(outputPath)
  } catch {
    return outputPath
  }
  throw new Error(
    `Recording already exists: ${outputPath}. Choose another descriptive name; existing recordings are never overwritten.`
  )
}

function appendLimited(current: string, chunk: Buffer): string {
  const combined = current + chunk.toString()
  return combined.length > 8000 ? combined.slice(-8000) : combined
}

async function runCodegen(
  cliPath: string,
  outputPath: string,
  url: string,
  cwd: string,
  token: vscode.CancellationToken
): Promise<{ code: number | null; output: string; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "codegen",
        "--browser=chromium",
        "--channel=msedge",
        "--target=playwright-test",
        "--output",
        outputPath,
        url
      ],
      {
        cwd,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1"
        }
      }
    )

    let output = ""
    let cancelled = false
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true
      child.kill()
    })

    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendLimited(output, chunk)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      output = appendLimited(output, chunk)
    })
    child.once("error", error => {
      cancellation.dispose()
      reject(error)
    })
    child.once("close", code => {
      cancellation.dispose()
      resolve({ code, output, cancelled })
    })
  })
}

async function openRecordingIfPresent(outputPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(outputPath)
    if (!stat.isFile() || stat.size === 0) return false
    const document = await vscode.workspace.openTextDocument(outputPath)
    await vscode.window.showTextDocument(document)
    return true
  } catch {
    return false
  }
}

export async function runRecordWebGuiFlow(context: vscode.ExtensionContext): Promise<void> {
  if (recorderRunning) {
    vscode.window.showWarningMessage("A SAP WebGUI recorder is already running.")
    return
  }

  const testFolder = getTestFolder()
  if (!testFolder) {
    vscode.window.showWarningMessage(
      "No SAP testing folder configured. Run 'ABAP FS: Enable SAP UI Testing Features' first."
    )
    return
  }

  try {
    const browser = await resolveBrowserExecutable()
    if (!browser.executablePath) {
      throw new Error(
        browser.warning ??
          "Microsoft Edge was not found. Set abapfs.testing.edgePath to a Chromium-based browser before recording."
      )
    }
    if (browser.warning) {
      vscode.window.showWarningMessage(browser.warning)
    }

    const url = await pickWebGuiUrl()
    if (!url) return
    const outputPath = await chooseRecordingPath(testFolder)
    if (!outputPath) return
    const cliPath = path.join(
      context.extensionPath,
      "client",
      "dist",
      "vendor",
      "node_modules",
      "playwright",
      "cli.js"
    )

    recorderRunning = true
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Recording ${path.basename(outputPath)} in Microsoft Edge`,
        cancellable: true
      },
      (_progress, token) => runCodegen(cliPath, outputPath, url, testFolder, token)
    )

    const opened = await openRecordingIfPresent(outputPath)
    if (result.cancelled) return
    if (result.code !== 0) {
      const details = result.output.trim()
      throw new Error(
        `Playwright recorder exited with code ${result.code}.${details ? `\n\n${details}` : ""}`
      )
    }
    if (!opened) {
      vscode.window.showWarningMessage("The Edge recorder closed without generating any test code.")
      return
    }
    vscode.window.showInformationMessage(
      `SAP WebGUI recording saved as reference evidence: ${outputPath}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Could not record in Edge: ${message}`)
  } finally {
    recorderRunning = false
  }
}
