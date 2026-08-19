import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import {
  discoverLanguageModels,
  effectiveSubagentModels,
  saveSubagentModels
} from "../subagents/modelConfiguration"
import {
  ALL_AGENT_REGISTRY,
  ensureCustomAgentDelegationEnabled,
  getSubagentSettings
} from "../../subagentRegistry"
import { isTestFolderValid } from "../config"

type WebviewMessage = { command: "ready" | "refresh" } | { command: "save"; selections?: unknown }

function selectionRecord(
  value: unknown
): { models: Record<string, string>; enabledAgents: Record<string, boolean> } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const models = input.models
  const enabledAgents = input.enabledAgents
  if (!models || typeof models !== "object" || Array.isArray(models)) return undefined
  if (!enabledAgents || typeof enabledAgents !== "object" || Array.isArray(enabledAgents)) {
    return undefined
  }

  const modelRecord: Record<string, string> = {}
  const enabledRecord: Record<string, boolean> = {}
  for (const agent of ALL_AGENT_REGISTRY) {
    const selected = (models as Record<string, unknown>)[agent.id]
    if (typeof selected !== "string") return undefined
    modelRecord[agent.id] = selected
    if (agent.section === "general") {
      const enabled = (enabledAgents as Record<string, unknown>)[agent.id]
      if (typeof enabled !== "boolean") return undefined
      enabledRecord[agent.id] = enabled
    }
  }
  return { models: modelRecord, enabledAgents: enabledRecord }
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
      "abapfs.subagentModels",
      "Subagent Models",
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
        agents: ALL_AGENT_REGISTRY,
        models: [],
        configuredModels: {},
        enabledAgents: {},
        testingEnabled: false,
        error: `Could not read the current agent defaults: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      return
    }
    const settings = getSubagentSettings()
    await this.panel.webview.postMessage({
      type: "models",
      agents: ALL_AGENT_REGISTRY,
      models: discovery.models,
      configuredModels,
      enabledAgents: settings.enabledAgents,
      testingEnabled: await isTestFolderValid(),
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
      const testingEnabled = await isTestFolderValid()
      const requiredAgentIds = ALL_AGENT_REGISTRY.filter(
        agent => agent.section === "general" && selections.enabledAgents[agent.id] === true
      ).map(agent => agent.id)
      const result = await saveSubagentModels(
        this.context,
        selections.models,
        discovery.models,
        requiredAgentIds
      )
      await vscode.workspace
        .getConfiguration("abapfs.subagents")
        .update("enabledAgents", selections.enabledAgents, vscode.ConfigurationTarget.Global)
      const generalEnabled = Object.values(selections.enabledAgents).some(Boolean)
      if ((generalEnabled || testingEnabled) && (await ensureCustomAgentDelegationEnabled())) {
        await vscode.window.showInformationMessage("Custom agent delegation enabled.")
      }
      await this.panel.webview.postMessage({
        type: "saved"
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
