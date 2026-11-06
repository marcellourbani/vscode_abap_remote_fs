import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { randomBytes } from "crypto"
import { connectedRoots } from "../../config"
import { analyse } from "./analysis"
import { UsageEngine } from "./engine"
import { UsageStore } from "./store"
import { INPUT_COLUMNS, readInput } from "./imports"
import { exportRows, issueColumns, usageColumns, usageExportName, usageIssueRows } from "./exports"
import { buildCsv, buildXlsx } from "../structuredDataExportService"
import {
  applyOptions,
  canRunDependencies,
  dependencyRetryKeys,
  resetStage,
  usageConfirmation
} from "./options"
import type { InputKind, Stage, UsageAnalysis } from "./types"

let runtime: { store: UsageStore; engine: UsageEngine; ready: Promise<void> } | undefined
function getRuntime() {
  if (!runtime) {
    const store = new UsageStore()
    runtime = { store, engine: new UsageEngine(store), ready: store.initialize() }
  }
  return runtime
}

export class RepositoryUsagePanel {
  private static instance?: RepositoryUsagePanel
  private readonly runtime = getRuntime()
  private selected?: string
  private messages: Promise<unknown> = Promise.resolve()
  private requests: Promise<unknown> = Promise.resolve()
  private disposed = false

  static async open(context: vscode.ExtensionContext) {
    if (this.instance) {
      this.instance.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      "abapfs.repositoryUsage",
      "Repository Usage Analysis",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "client", "dist", "media")]
      }
    )
    const instance = new RepositoryUsagePanel(context, panel)
    this.instance = instance
    await instance.initialize()
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    this.panel.webview.onDidReceiveMessage(message => {
      if (message.command === "pause") void this.handle(message)
      else this.requests = this.requests.catch(() => undefined).then(() => this.handle(message))
    })
    const onChanged = (state: UsageAnalysis) => this.enqueue(() => this.sendAnalysis(state, false))
    const onRows = (state: UsageAnalysis) => this.enqueue(() => this.sendAnalysis(state, true))
    this.runtime.engine.on("changed", onChanged).on("progress", onChanged).on("rows", onRows)
    this.panel.onDidDispose(() => {
      this.disposed = true
      this.runtime.engine.off("changed", onChanged).off("progress", onChanged).off("rows", onRows)
      if (this.selected) void this.runtime.engine.pause(this.selected)
      RepositoryUsagePanel.instance = undefined
    })
    const connections = vscode.workspace.onDidChangeConfiguration(() => {
      if (!this.disposed)
        void this.panel.webview.postMessage({
          command: "connections",
          systems: [...connectedRoots().keys()]
        })
    })
    this.panel.onDidDispose(() => connections.dispose())
    const visibility = this.panel.onDidChangeViewState(() => {
      if (!this.disposed)
        void this.panel.webview.postMessage({ command: "visibility", visible: this.panel.visible })
    })
    this.panel.onDidDispose(() => visibility.dispose())
  }

  private async initialize() {
    const folder = vscode.Uri.joinPath(this.context.extensionUri, "client", "dist", "media")
    let html = await fs.readFile(
      vscode.Uri.joinPath(folder, "repositoryUsage", "main.html").fsPath,
      "utf8"
    )
    const tokens: Record<string, string> = {
      CSP: this.panel.webview.cspSource,
      NONCE: randomBytes(18).toString("base64"),
      CSS: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(folder, "repositoryUsage", "main.css"))
        .toString(),
      JS: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(folder, "repositoryUsage", "main.js"))
        .toString(),
      MODEL: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(folder, "repositoryUsage", "viewModel.js"))
        .toString(),
      TABULATOR: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(folder, "tabulator.min.js"))
        .toString(),
      TABLECSS: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(folder, "tabulator_bootstrap4.min.css"))
        .toString(),
      ICONCSS: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(folder, "codicons", "codicon.css"))
        .toString()
    }
    html = html.replace(/\{\{([A-Z]+)\}\}/g, (_match, key: string) => tokens[key] || "")
    this.panel.webview.html = html
    await this.runtime.ready
  }

  private enqueue(operation: () => Promise<unknown>) {
    this.messages = this.messages
      .catch(() => undefined)
      .then(() => (this.disposed ? undefined : operation()))
      .catch(error => {
        console.error("Repository usage UI update failed", error)
      })
  }

  private async sendAnalysis(state: UsageAnalysis, withRows: boolean) {
    if (state.id !== this.selected || this.disposed) return
    const rows = withRows ? analyse(state.inventory, state.observations, state.edges) : undefined
    await this.panel.webview.postMessage({
      command: "update",
      analysis: presentation(state),
      rows,
      replaceRows: withRows
    })
  }

  private async sendState() {
    await this.runtime.ready
    const analyses = await this.runtime.store.list()
    const state = analyses.find(item => item.id === this.selected)
    const rows = state ? analyse(state.inventory, state.observations, state.edges) : []
    await this.panel.webview.postMessage({
      command: "state",
      analyses: analyses.map(item => ({ id: item.id, name: item.name })),
      analysis: state ? presentation(state) : undefined,
      rows,
      systems: [...connectedRoots().keys()]
    })
  }

  private async handle(message: Record<string, unknown>) {
    const command = String(message.command || "")
    try {
      await this.runtime.ready
      if (command === "ready") {
        if (
          typeof message.id === "string" &&
          (await this.runtime.store.list()).some(state => state.id === message.id)
        )
          this.selected = message.id
        this.enqueue(() => this.sendState())
        return
      }
      if (command === "create") {
        const baseName =
          String(message.name || "Repository Usage Analysis").trim() || "Repository Usage Analysis"
        const existingNames = new Set(
          (await this.runtime.store.list()).map(state => state.name.trim().toLowerCase())
        )
        let suggestedName = baseName
        for (let suffix = 2; existingNames.has(suggestedName.toLowerCase()); suffix++)
          suggestedName = `${baseName} (${suffix})`
        const name = await vscode.window.showInputBox({
          title: "New Repository Usage Analysis",
          prompt: "Analysis name",
          value: suggestedName,
          validateInput: value => this.runtime.store.nameError(value),
          ignoreFocusOut: true
        })
        if (name === undefined) return
        const state = await this.runtime.store.create(name)
        this.selected = state.id
        this.enqueue(() => this.sendState())
        return
      }
      if (command === "select") {
        if (this.selected) await this.runtime.engine.pause(this.selected)
        this.selected = String(message.id)
        this.enqueue(() => this.sendState())
        return
      }
      if (command === "save") {
        const id = String(message.analysisId || "")
        const state = await this.saveOptions(id, message)
        await this.panel.webview.postMessage({
          command: "saved",
          analysis: presentation(state || (await this.runtime.store.get(id))),
          cancelled: !state,
          analysisId: id,
          requestId: message.requestId
        })
        return
      }
      if (command === "delete") {
        const id = String(message.id || this.selected || "")
        const state = await this.runtime.store.get(id)
        if (
          (await vscode.window.showWarningMessage(
            `Delete "${state.name}" and its local files? Nothing in SAP will be deleted.`,
            { modal: true },
            "Delete"
          )) !== "Delete"
        )
          return
        await this.runtime.store.remove(id)
        if (this.selected === id) this.selected = undefined
        this.enqueue(() => this.sendState())
        return
      }
      if (!this.selected) throw new Error("Create or select an analysis first")
      const id = this.selected
      if (message.analysisId && message.analysisId !== id)
        throw new Error("This action belongs to a different analysis; select it again")
      if (command === "pause") {
        await this.runtime.engine.pause(id)
        return
      }
      if (command === "guide") {
        await this.openGuide(String(message.stage || "discovery"))
        return
      }
      if (command === "template") {
        await this.template(inputKind(message.kind))
        return
      }
      if (command === "export" || command === "exportIssues") {
        await this.export(message)
        return
      }
      if (command === "reset") {
        const stage = String(message.stage) as Stage
        if (!["discovery", "st03n", "jobs", "dependencies"].includes(stage))
          throw new Error("Unknown analysis stage")
        if (
          (await vscode.window.showWarningMessage(
            `Reset ${stage === "discovery" ? "Discovery and all usage results" : stage + " results"}? Uploaded files will be kept.`,
            { modal: true },
            "Reset"
          )) !== "Reset"
        )
          return
        await this.runtime.engine.reset(id, stage)
        this.enqueue(() => this.sendState())
        return
      }
      if (command === "upload") {
        await this.upload(id, inputKind(message.kind), String(message.period || ""))
        this.enqueue(() => this.sendState())
        return
      }
      if (command === "removeInput") {
        if (!(await this.confirmChange(await this.runtime.store.get(id), message))) return
        let removedInputId: string | undefined
        await this.runtime.engine.edit(id, state => {
          const input = state.inputs.find(item => item.id === message.inputId)
          state.inputs = state.inputs.filter(item => item.id !== message.inputId)
          if (input) {
            removedInputId = input.id
            resetStage(
              state,
              ["tadir", "enlfdir"].includes(input.kind)
                ? "discovery"
                : ["tbtco", "tbtcp"].includes(input.kind)
                  ? "jobs"
                  : "st03n"
            )
          }
        })
        if (removedInputId) await this.runtime.store.removeOriginal(id, removedInputId)
        this.enqueue(() => this.sendState())
        return
      }
      if (!(await this.saveOptions(id, message))) return
      if (command === "discover") await this.runtime.engine.discover(id, message.restart === true)
      else if (command === "st03n") await this.runtime.engine.processSt03n(id)
      else if (command === "jobs") {
        const connection =
          message.jobMode === "connected" ? String(message.jobConnection || "") : undefined
        if (message.jobMode === "connected" && !connection)
          throw new Error("Select a connected system for jobs")
        await this.runtime.engine.processJobs(id, connection)
      } else if (command === "dependencies") {
        const options = message.options as Record<string, unknown> | undefined
        const retry = options?.retryFailedOrEmptyDependencies === true
        if (retry && !dependencyRetryKeys(await this.runtime.store.get(id)).length) {
          await vscode.window.showInformationMessage(
            "No failed or empty dependency results are available to retry.",
            { modal: true },
            "OK"
          )
          return
        }
        await this.runtime.engine.dependencies(id, retry)
      } else if (command !== "save") throw new Error("Unknown analysis action")
    } catch (error) {
      if (!this.disposed)
        await this.panel.webview.postMessage({
          command: "error",
          message: String(error instanceof Error ? error.message : error),
          requestId: message.requestId,
          analysisId: message.analysisId
        })
    } finally {
      if (!this.disposed && command !== "save")
        await this.panel.webview.postMessage({ command: "idle", analysisId: message.analysisId })
    }
  }

  private async saveOptions(id: string, message: Record<string, unknown>) {
    const previous = await this.runtime.store.get(id)
    const options = message.options as Record<string, unknown> | undefined
    if (options?.refreshDependencies === true && options.retryFailedOrEmptyDependencies === true)
      throw new Error("Choose either full dependency-cache refresh or failed/empty retry, not both")
    if (options) applyOptions({ ...previous }, options)
    if (!(await this.confirmChange(previous, message))) return undefined
    return this.runtime.engine.edit(id, state => {
      if (options) applyOptions(state, options)
      if (message.command === "dependencies" && options?.refreshDependencies === true)
        resetStage(state, "dependencies")
    })
  }

  private async confirmChange(state: UsageAnalysis, message: Record<string, unknown>) {
    const warning = usageConfirmation(state, message)
    if (!warning) return true
    return (
      (await vscode.window.showWarningMessage(warning, { modal: true }, "Continue")) === "Continue"
    )
  }

  private async upload(id: string, kind: InputKind, period: string) {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { "Evidence files": ["xlsx", "csv"] }
    })
    if (!files) return
    for (const file of files) {
      const { input, bytes } = await readInput(file.fsPath, kind, period)
      await this.runtime.engine.edit(id, state => {
        if (state.inputs.some(existing => existing.id === input.id)) return
        const stage = ["tadir", "enlfdir"].includes(kind)
          ? "discovery"
          : ["tbtco", "tbtcp"].includes(kind)
            ? "jobs"
            : "st03n"
        if (state.stages?.[stage]) throw new Error(`Reset ${stage} before adding different files`)
        state.inputs.push(input)
      })
      await this.runtime.store.saveOriginal(id, input.id, path.extname(file.fsPath), bytes)
    }
  }

  private async template(kind: InputKind) {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(os.homedir(), `Repository_Usage_${kind}_template.xlsx`)
      ),
      filters: { Excel: ["xlsx"] }
    })
    if (target)
      await vscode.workspace.fs.writeFile(
        target,
        await buildXlsx(
          INPUT_COLUMNS[kind].map(name => ({ name })),
          [],
          "Extract"
        )
      )
  }

  private async openGuide(stage: string) {
    const name = ["discovery", "st03n", "jobs", "dependencies"].includes(stage)
      ? stage
      : "discovery"
    const uri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "client",
      "dist",
      "media",
      "repositoryUsage",
      `${name}.md`
    )
    await vscode.commands.executeCommand("markdown.showPreviewToSide", uri)
  }

  private async export(message: Record<string, unknown>) {
    const state = await this.runtime.store.get(this.selected!)
    const issues = message.command === "exportIssues"
    const view = String(message.view || "all")
    const keys = new Set(Array.isArray(message.keys) ? message.keys.map(String) : [])
    const values = issues
      ? usageIssueRows(state)
          .filter(row => view !== "filtered" || keys.has(row.id))
          .map(row => ({ ...row }))
      : exportRows(
          analyse(state.inventory, state.observations, state.edges)
            .filter(row => view !== "unclear" || row.status === "unclear")
            .filter(row => view !== "filtered" || keys.has(row.key))
        )
    const columns = issues ? issueColumns : usageColumns
    const type = message.type === "csv" ? "csv" : "xlsx"
    const previous =
      this.context.globalState.get<string>("abapfs.repositoryUsage.exportDirectory") || os.homedir()
    const target = await vscode.window.showSaveDialog({
      title: issues ? "Export unresolved issues" : "Export repository usage",
      defaultUri: vscode.Uri.file(
        path.join(previous, usageExportName(state, issues ? `${view}-issues` : view, type))
      ),
      filters: type === "csv" ? { CSV: ["csv"] } : { Excel: ["xlsx"] }
    })
    if (!target) return
    await vscode.workspace.fs.writeFile(
      target,
      type === "csv"
        ? buildCsv(columns, values)
        : await buildXlsx(columns, values, issues ? "Unresolved issues" : "Repository usage")
    )
    await this.context.globalState.update(
      "abapfs.repositoryUsage.exportDirectory",
      path.dirname(target.fsPath)
    )
  }
}

function inputKind(value: unknown): InputKind {
  if (typeof value !== "string" || !(value in INPUT_COLUMNS))
    throw new Error("Unknown evidence source")
  return value as InputKind
}

function presentation(state: UsageAnalysis) {
  const { inventory, observations, transactions, functions, edges, checks, inputs, ...metadata } =
    state
  return {
    ...metadata,
    discoveryDone:
      state.inventory.length > 0 &&
      ["complete", "partial"].includes(state.stages?.discovery?.status || ""),
    canDependencies: canRunDependencies(state),
    issueRows: usageIssueRows(state),
    inputs: inputs.map(({ rows, ...input }) => ({ ...input, rowCount: rows.length })),
    failedChecks: Object.entries(checks)
      .filter(([, check]) => check.status === "error")
      .map(([key, check]) => `${key}: ${check.error}`),
    evidenceCount: observations.length,
    edgeCount: edges.length
  }
}

export function registerRepositoryUsageCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.repositoryUsage", () =>
      RepositoryUsagePanel.open(context)
    )
  )
}
