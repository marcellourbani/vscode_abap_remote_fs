import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { connectedRoots } from "../config"
import { getClient } from "../adt/conections"
import { executeAbapCode, checkReplAvailability, ReplResponse } from "./replService"
import { getSAPSystemInfo } from "../services/sapSystemInfo"
import { log } from "../lib"

export class ReplPanel {
  public static readonly viewType = "ABAPRepl"

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private disposables: vscode.Disposable[] = []

  public static create(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn
    const panel = vscode.window.createWebviewPanel(
      ReplPanel.viewType,
      "Execute ABAP Code",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "client", "dist", "media"),
          vscode.Uri.joinPath(extensionUri, "client", "media")
        ]
      }
    )
    new ReplPanel(panel, extensionUri)
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel
    this.extensionUri = extensionUri
    this.panel.webview.html = this.getHtml(this.panel.webview)

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(
      msg => this.handleMessage(msg).catch(e => log(`ABAP REPL message error: ${e}`)),
      null,
      this.disposables
    )
  }

  private dispose(): void {
    while (this.disposables.length) {
      const d = this.disposables.pop()
      d?.dispose()
    }
  }

  private static executing = false

  private async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg !== "object") return
    switch (msg.command) {
      case "execute": {
        const code = typeof msg.code === "string" ? msg.code : ""
        const connId = typeof msg.connectionId === "string" ? msg.connectionId : ""
        if (ReplPanel.executing) {
          this.panel.webview.postMessage({
            command: "result",
            data: { success: false, output: "", error: "Another ABAP execution is already in progress. Wait for it to complete.", runtime_ms: 0 }
          })
          return
        }
        ReplPanel.executing = true
        try {
          await this.handleExecute(code, connId)
        } finally {
          ReplPanel.executing = false
        }
        break
      }
      case "getSystems":
        this.sendSystems()
        break
    }
  }

  private sendSystems(): void {
    const roots = connectedRoots()
    const systems = Array.from(roots.keys())
    this.panel.webview.postMessage({ command: "systems", systems })
  }

  private async handleExecute(code: string, connectionId: string): Promise<void> {
    if (!code || !code.trim()) {
      this.panel.webview.postMessage({
        command: "result",
        data: { success: false, output: "", error: "No code to execute.", runtime_ms: 0 }
      })
      return
    }

    if (!connectionId) {
      this.panel.webview.postMessage({
        command: "result",
        data: { success: false, output: "", error: "No SAP system selected.", runtime_ms: 0 }
      })
      return
    }

    try {
      const client = getClient(connectionId.toLowerCase())

      let health
      try {
        health = await checkReplAvailability(client)
      } catch (e) {
        log(`ABAP REPL availability check failed: ${e instanceof Error ? e.message : String(e)}`)
        this.panel.webview.postMessage({
          command: "result",
          data: {
            success: false,
            output: "",
            error: `REPL service not available on '${connectionId}'. ` +
              `Deploy ZCL_ABAP_REPL and create SICF service '/sap/bc/z_abap_repl'. ` +
              `See the setup guide in the repl/ folder.`,
            runtime_ms: 0
          }
        })
        return
      }

      let isProduction = true
      try {
        // Both checks must agree it's NOT production. If either says production, block.
        const sapSaysNotProd = health.production === false
        const sysInfo = await getSAPSystemInfo(connectionId.toLowerCase())
        const cat = sysInfo.currentClient?.category
        const sysInfoSaysNotProd = !!cat && cat !== "Production" && !cat.startsWith("P")
        isProduction = !(sapSaysNotProd && sysInfoSaysNotProd)
      } catch (e) {
        log(`ABAP REPL production check failed: ${e instanceof Error ? e.message : String(e)}`)
        // Can't verify — block (fail-closed)
      }

      if (isProduction) {
        this.panel.webview.postMessage({
          command: "result",
          data: {
            success: false,
            output: "",
            error: "REPL is disabled on production systems.",
            runtime_ms: 0
          }
        })
        return
      }

      const result: ReplResponse = await executeAbapCode(client, code)
      this.panel.webview.postMessage({ command: "result", data: result })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log(`ABAP REPL execution error: ${msg}`)
      this.panel.webview.postMessage({
        command: "result",
        data: {
          success: false,
          output: "",
          error: msg,
          runtime_ms: 0
        }
      })
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "client", "dist", "media", "repl.js")
    )
    const csp = webview.cspSource

    const htmlPath = path.join(this.extensionUri.fsPath, "client", "dist", "media", "repl.html")
    try {
      let html = fs.readFileSync(htmlPath, "utf8")
      html = html.replace(/\{\{CSP_SOURCE\}\}/g, csp)
      html = html.replace(/\{\{SCRIPT_URI\}\}/g, scriptUri.toString())
      return html
    } catch (err) {
      const safeErr = String(err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      return `<html><body><h3>Failed to load REPL panel</h3><pre>${safeErr}</pre></body></html>`
    }
  }
}
