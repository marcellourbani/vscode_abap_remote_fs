import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { GENERAL_SKILL_REGISTRY, getSkillSettings, syncSkillContexts } from "./skillRegistry"

type WebviewMessage = { command: "ready" | "refresh" } | { command: "save"; selections?: unknown }

function selectionRecord(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const selections = value as Record<string, unknown>
  const enabledSkills: Record<string, boolean> = {}
  for (const skill of GENERAL_SKILL_REGISTRY) {
    if (typeof selections[skill.id] !== "boolean") return undefined
    enabledSkills[skill.id] = selections[skill.id] as boolean
  }
  return enabledSkills
}

export class SkillsPanel {
  private static current: SkillsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []

  static show(context: vscode.ExtensionContext): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.current = new SkillsPanel(context)
  }

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "abapfs.skills",
      "ABAP FS Skills",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "client", "dist", "media")]
      }
    )

    this.panel.onDidDispose(
      () => {
        SkillsPanel.current = undefined
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
        "skills-control",
        name
      )
    try {
      const template = await fs.readFile(
        path.join(
          this.context.extensionPath,
          "client",
          "dist",
          "media",
          "skills-control",
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
        "<html><body><h1>ABAP FS Skills</h1><p>The skills control panel could not be loaded.</p></body></html>"
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.command) {
      case "ready":
      case "refresh":
        await this.loadSkills()
        return
      case "save":
        await this.saveSkills(message.selections)
        return
    }
  }

  private async loadSkills(): Promise<void> {
    await this.panel.webview.postMessage({ type: "loading" })
    const settings = getSkillSettings()
    await this.panel.webview.postMessage({
      type: "skills",
      skills: GENERAL_SKILL_REGISTRY,
      enabledSkills: settings.enabledSkills
    })
  }

  private async saveSkills(value: unknown): Promise<void> {
    const enabledSkills = selectionRecord(value)
    if (!enabledSkills) {
      await this.panel.webview.postMessage({
        type: "error",
        message: "The panel returned an incomplete skill selection."
      })
      return
    }

    await this.panel.webview.postMessage({ type: "saving" })
    try {
      await vscode.workspace
        .getConfiguration("abapfs.skills")
        .update("enabledSkills", enabledSkills, vscode.ConfigurationTarget.Global)
      await syncSkillContexts()
      await this.panel.webview.postMessage({ type: "saved" })
    } catch (error) {
      await this.panel.webview.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export function registerSkillsControl(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.skills.configure", () => SkillsPanel.show(context)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("abapfs.skills.enabledSkills")) void syncSkillContexts()
    })
  )
  void syncSkillContexts()
}
