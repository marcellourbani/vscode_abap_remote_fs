import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import {
  discoverLanguageModels,
  effectiveSubagentModels,
  saveSubagentModels
} from "../subagents/modelConfiguration"
import { SUBAGENT_REGISTRY } from "../subagents/registry"

type WebviewMessage =
  | { command: "ready" | "refresh" | "reload" }
  | { command: "save"; selections?: unknown }

function selectionRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record: Record<string, string> = {}
  for (const agent of SUBAGENT_REGISTRY) {
    const selected = (value as Record<string, unknown>)[agent.id]
    if (typeof selected !== "string") return undefined
    record[agent.id] = selected
  }
  return record
}

export class SubagentModelsPanel {
  private static current: SubagentModelsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  static show(context: vscode.ExtensionContext): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.current = new SubagentModelsPanel(context)
  }

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "abapfs.testing.subagentModels",
      "SAP Testing Subagent Models",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "client", "dist", "media")]
      }
    )

    this.panel.onDidDispose(
      () => {
        SubagentModelsPanel.current = undefined
        while (this.disposables.length) this.disposables.pop()?.dispose()
      },
      undefined,
      this.disposables
    )
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => void this.handleMessage(message),
      undefined,
      this.disposables
    )
    void this.loadHtml()
  }

  private async loadHtml(): Promise<void> {
    const assetUri = (name: string) =>
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "client",
        "dist",
        "media",
        "subagent-models",
        name
      )
    try {
      const template = await fs.readFile(
        path.join(
          this.context.extensionPath,
          "client",
          "dist",
          "media",
          "subagent-models",
          "index.html"
        ),
        "utf8"
      )
      this.panel.webview.html = template
        .replaceAll("{{CSP_SOURCE}}", this.panel.webview.cspSource)
        .replaceAll(
          "{{STYLE_URI}}",
          this.panel.webview.asWebviewUri(assetUri("index.css")).toString()
        )
        .replaceAll(
          "{{SCRIPT_URI}}",
          this.panel.webview.asWebviewUri(assetUri("index.js")).toString()
        )
    } catch {
      this.panel.webview.html =
        "<html><body><h1>Subagent Models</h1><p>The model configuration panel could not be loaded.</p></body></html>"
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.command) {
      case "ready":
      case "refresh":
        await this.loadModels()
        return
      case "save":
        await this.saveModels(message.selections)
        return
      case "reload":
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
    }
  }

  private async loadModels(): Promise<void> {
    await this.panel.webview.postMessage({ type: "loading" })
    const discovery = await discoverLanguageModels()
    let configuredModels: Record<string, string>
    try {
      configuredModels = await effectiveSubagentModels(this.context)
    } catch (error) {
      await this.panel.webview.postMessage({
        type: "models",
        agents: SUBAGENT_REGISTRY,
        models: [],
        configuredModels: {},
        error: `Could not read the current agent defaults: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      return
    }
    await this.panel.webview.postMessage({
      type: "models",
      agents: SUBAGENT_REGISTRY,
      models: discovery.models,
      configuredModels,
      error: discovery.error
    })
  }

  private async saveModels(value: unknown): Promise<void> {
    const selections = selectionRecord(value)
    if (!selections) {
      await this.panel.webview.postMessage({
        type: "error",
        message: "The panel returned an incomplete model selection."
      })
      return
    }

    await this.panel.webview.postMessage({ type: "saving" })
    const discovery = await discoverLanguageModels()
    if (!discovery.models.length) {
      await this.panel.webview.postMessage({
        type: "error",
        message:
          discovery.error ||
          "No language models are currently available. Refresh after GitHub Copilot is ready."
      })
      return
    }

    try {
      const result = await saveSubagentModels(this.context, selections, discovery.models)
      await this.panel.webview.postMessage({
        type: "saved",
        reloadRequired: result.changedFiles.length > 0
      })
    } catch (error) {
      await this.panel.webview.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export function showSubagentModelsPanel(context: vscode.ExtensionContext): void {
  SubagentModelsPanel.show(context)
}
