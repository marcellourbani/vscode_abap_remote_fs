import * as vscode from "vscode"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { connectedRoots } from "../../config"
import { buildAbapGitArchive } from "../../services/customizing/archive"
import {
  checkInstallation,
  deployInstallation,
  provisionServices,
  validateDeployment
} from "../../services/customizing/setup"

interface SetupMessage {
  command: "ready" | "check" | "deploy" | "configureServices" | "export" | "guide"
  connectionId?: string
  packageName?: string
  transport?: string
  requestId?: number
}

export class CustomizingSetupView implements vscode.WebviewViewProvider {
  static readonly viewType = "abapfs.customizingSetup"
  private view?: vscode.WebviewView
  private busy = false
  constructor(private readonly extensionPath: string) {}
  private get assets() {
    return join(this.extensionPath, "client", "dist", "media", "customizing")
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    const nonce = randomBytes(24).toString("hex")
    view.webview.options = { enableScripts: true, localResourceRoots: [] }
    view.webview.html = readFileSync(join(this.assets, "setup.html"), "utf8").replaceAll(
      "{{NONCE}}",
      nonce
    )
    const listener = view.webview.onDidReceiveMessage((message: unknown) => {
      void this.receive(message)
    })
    view.onDidDispose(() => {
      listener.dispose()
      this.view = undefined
    })
  }

  private post(message: object) {
    return this.view?.webview.postMessage(message)
  }

  private async receive(raw: unknown) {
    if (!raw || typeof raw !== "object" || !("command" in raw)) return
    const message = raw as SetupMessage
    if (
      !["ready", "check", "deploy", "configureServices", "export", "guide"].includes(
        message.command
      )
    )
      return
    if (message.command === "ready") {
      await this.post({ type: "systems", systems: [...connectedRoots().keys()] })
      return
    }
    if (this.busy) return
    this.busy = true
    await this.post({ type: "busy", busy: true })
    try {
      if (message.command === "guide") {
        await vscode.commands.executeCommand(
          "markdown.showPreview",
          vscode.Uri.file(join(this.assets, "GUIDE.md"))
        )
      } else if (message.command === "export") {
        const destination = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file("abapfs-customizing.zip"),
          filters: { "abapGit ZIP": ["zip"] },
          saveLabel: "Save abapGit package"
        })
        if (destination) {
          await vscode.workspace.fs.writeFile(destination, buildAbapGitArchive(this.assets))
          await this.post({
            type: "success",
            command: message.command,
            text: "ZIP saved. Import it using the abapGit setup guide, then configure SICF and check installation."
          })
        }
      } else {
        if (typeof message.connectionId !== "string" || !connectedRoots().has(message.connectionId))
          throw new Error("Choose a currently connected SAP system")
        if (message.command === "check") {
          const status = await checkInstallation(message.connectionId)
          await this.post({
            type: "status",
            requestId: message.requestId,
            connectionId: message.connectionId,
            status
          })
        } else {
          if (
            typeof message.packageName !== "string" ||
            (message.transport !== undefined && typeof message.transport !== "string")
          )
            throw new Error("Invalid deployment fields")
          const input = validateDeployment({
            connectionId: message.connectionId,
            packageName: message.packageName,
            transport: message.transport
          })
          const configureOnly = message.command === "configureServices"
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: configureOnly
                ? "Configuring ABAP FS Customizing SICF services"
                : "Deploying ABAP FS Customizing objects & configuring SICF",
              cancellable: true
            },
            async (progress, token) =>
              (configureOnly ? provisionServices : deployInstallation)(
                input,
                this.assets,
                () => token.isCancellationRequested,
                text => progress.report({ message: text })
              )
          )
          await this.post({
            type: "status",
            connectionId: message.connectionId,
            requestId: message.requestId,
            status: result.installation
          })
          await this.post({
            type: result.installation.ready ? "success" : "warning",
            command: message.command,
            text: result.note
          })
        }
      }
    } catch (error) {
      await this.post({
        type: "error",
        command: message.command,
        text: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.busy = false
      await this.post({ type: "busy", busy: false })
    }
  }
}
