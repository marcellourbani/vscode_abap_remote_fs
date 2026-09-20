import * as vscode from "vscode"
import * as fs from "fs/promises"
import { connectedRoots } from "../../config"
import { WorkflowExportService } from "./workflowExportService"
import {
  defaultRepositoryCriteria,
  ExistenceComparisonRecord,
  RepositoryWorkflow,
  SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES
} from "./types"
import { defaultWorkflowName, WorkflowStore } from "./workflowStore"
import { RepositoryWorkflowEngine } from "./workflowEngine"
import { RepositoryWorkflowChange, RepositoryWorkflowRuntime } from "./runtime"
import { commandSection, REPOSITORY_OBJECT_TYPES } from "./workflowUiModel"
import { assistedApplySafety } from "./assistedApplyService"
import { objectFolderId } from "./snapshotService"

const DEFAULT_CRITERIA = () => defaultRepositoryCriteria(defaultConcurrency())
const WEBVIEW_EXPORTS = [
  "sourceDiscovery",
  "targetDiscovery",
  "existenceComparison",
  "sourceComparison",
  "assistedApplyPlan"
]

function defaultConcurrency(): number {
  const value = vscode.workspace
    .getConfiguration("abapfs.repositoryWorkflows")
    .get<number>("defaultConcurrency", 5)
  return Math.min(10, Math.max(1, value))
}

export class RepositoryWorkflowPanel {
  private static instance: RepositoryWorkflowPanel | undefined
  private selectedWorkflowId?: string
  private readonly panel: vscode.WebviewPanel
  private readonly store: WorkflowStore
  private readonly engine: RepositoryWorkflowEngine
  private readonly exporter: WorkflowExportService
  private progressRefresh?: ReturnType<typeof setTimeout>

  static async open(context: vscode.ExtensionContext, workflowId?: string) {
    if (this.instance) {
      this.instance.panel.reveal()
      if (workflowId) await this.instance.select(workflowId)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      "abapfs.repositoryWorkflow",
      "Repository Comparison Workflow",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "client", "dist", "media")]
      }
    )
    this.instance = new RepositoryWorkflowPanel(context, panel)
    if (workflowId) await this.instance.select(workflowId)
    else await this.instance.sendState()
  }

  private constructor(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
    this.panel = panel
    const runtime = RepositoryWorkflowRuntime.get(context)
    this.store = runtime.store
    this.engine = runtime.engine
    this.exporter = new WorkflowExportService(this.store)
    void runtime.ready.then(() => this.sendState())
    this.panel.webview.html = html(this.panel.webview, context.extensionUri)
    this.panel.webview.onDidReceiveMessage(message => this.handle(message))
    const refresh = (change: RepositoryWorkflowChange) => {
      if (change.focus) this.selectedWorkflowId = change.workflowId
      if (change.progress) {
        if (this.selectedWorkflowId === change.workflowId) this.scheduleProgress(change.workflowId)
        return
      }
      if (this.progressRefresh) clearTimeout(this.progressRefresh)
      this.progressRefresh = undefined
      void this.sendState()
    }
    runtime.on("changed", refresh)
    const configurationChanged = vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration("files.autoSave") ||
        event.affectsConfiguration("chat.saveBeforeSend")
      )
        void this.sendState()
    })
    this.panel.onDidChangeViewState(event => {
      if (event.webviewPanel.visible) void this.sendState()
    })
    this.panel.onDidDispose(() => {
      runtime.off("changed", refresh)
      configurationChanged.dispose()
      if (this.progressRefresh) clearTimeout(this.progressRefresh)
      if (this.selectedWorkflowId) void this.engine.pause(this.selectedWorkflowId).catch(() => {})
      RepositoryWorkflowPanel.instance = undefined
    })
  }

  private async handle(message: any) {
    try {
      switch (message.command) {
        case "ready":
          await this.sendState()
          break
        case "create":
          await this.create(message)
          break
        case "select":
          await this.panel.webview.postMessage({ command: "busy", value: true })
          try {
            await this.select(message.workflowId)
          } finally {
            await this.panel.webview.postMessage({ command: "busy", value: false })
          }
          break
        case "duplicate": {
          const duplicated = await this.store.duplicate(message.workflowId)
          await this.select(duplicated.workflowId)
          break
        }
        case "archive":
          if (
            (await vscode.window.showWarningMessage(
              "Archive this workflow? It will be moved under the configured workflow archive folder.",
              { modal: true },
              "Archive"
            )) !== "Archive"
          )
            break
          await this.store.archive(message.workflowId)
          this.selectedWorkflowId = undefined
          await this.sendState()
          break
        case "delete":
          if (
            (await vscode.window.showWarningMessage(
              "Permanently delete this workflow and all of its local artifacts?",
              { modal: true },
              "Delete"
            )) !== "Delete"
          )
            break
          await this.store.delete(message.workflowId)
          this.selectedWorkflowId = undefined
          await this.sendState()
          break
        case "saveCriteria":
          await this.saveCriteria(message.criteria)
          break
        case "runDiscovery":
          await this.saveCriteria(message.criteria, false)
          await this.runDiscoveryAndCompare()
          break
        case "resumeDiscovery":
          await this.runDiscoveryAndCompare()
          break
        case "compareExistence":
          await this.run(() => this.engine.compareExistence(this.requiredWorkflowId()))
          break
        case "selectSources":
          await this.run(() =>
            this.engine.saveSourceSelection(this.requiredWorkflowId(), message.keys)
          )
          break
        case "compareSourceCode":
          await this.saveDownloadConcurrency(message)
          await this.run(() =>
            this.engine.compareSourceCode(this.requiredWorkflowId(), message.keys)
          )
          break
        case "resumeSourceComparison":
          await this.saveDownloadConcurrency(message)
          await this.run(() => this.engine.compareSourceCode(this.requiredWorkflowId()))
          break
        case "openDiff":
          await this.openDiff(message.key)
          break
        case "openAssistedSource":
          await this.engine.openAssistedApplySource(this.requiredWorkflowId(), message.key)
          break
        case "openAssistedTarget":
          await this.engine.openAssistedApplyTarget(this.requiredWorkflowId(), message.key)
          break
        case "openAssistedDiff":
          await this.engine.openAssistedApplyDiff(this.requiredWorkflowId(), message.key)
          break
        case "stageAssistedSource":
          await this.engine.stageAssistedApplySource(this.requiredWorkflowId(), message.key)
          await this.sendState()
          break
        case "prepareAssistedApply":
          await this.run(() => this.engine.prepareAssistedApply(this.requiredWorkflowId()))
          break
        case "openAutoSaveSettings":
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@id:files.autoSave @lang:abap"
          )
          break
        case "openChatSaveSettings":
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "chat.saveBeforeSend"
          )
          break
        case "pause":
          await this.engine.pause(this.requiredWorkflowId())
          await this.sendState()
          break
        case "export":
          await this.export(message.output, message.type)
          break
        case "askCopilot":
          await vscode.commands.executeCommand("workbench.action.chat.open", {
            query: `Inspect repository workflow ${this.requiredWorkflowId()} using abapfs_get_repository_workflow and help with: ${message.prompt}`,
            isPartialQuery: true
          })
          break
      }
    } catch (error) {
      await this.panel.webview.postMessage({
        command: "error",
        section: commandSection(message.command),
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async create(message: any) {
    const roots = connectedRoots()
    if (!roots.has(message.source) || !roots.has(message.target))
      throw new Error("Select two currently connected systems")
    const workflow = await this.store.create({
      name: message.name,
      description: message.description,
      sourceConnectionId: message.source,
      targetConnectionId: message.target
    })
    this.selectedWorkflowId = workflow.workflowId
    await this.sendState()
  }

  private async select(workflowId: string) {
    await this.store.get(workflowId)
    this.selectedWorkflowId = workflowId
    await this.sendState()
  }

  private async saveCriteria(input: any, sendState = true) {
    const parse = (value: string) =>
      String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean)
    await this.store.saveCriteria(this.requiredWorkflowId(), {
      ...DEFAULT_CRITERIA(),
      updatedAt: new Date().toISOString(),
      includeNames: String(input.includeNames || "").trim()
        ? [String(input.includeNames).trim()]
        : [],
      excludeNames: parse(input.excludeNames),
      packages: parse(input.packages),
      objectTypes: parse(input.objectTypes),
      namespaces: parse(input.namespaces),
      authors: parse(input.authors),
      createdFrom: input.createdFrom || undefined,
      createdTo: input.createdTo || undefined,
      includeSubpackages: !!input.includeSubpackages,
      includeDeleted: !!input.includeDeleted,
      includeGenerated: !!input.includeGenerated,
      includeTemporary: !!input.includeTemporary,
      sourceConcurrency: Number(input.sourceConcurrency) || 5,
      targetConcurrency: Number(input.targetConcurrency) || 5,
      verificationConcurrency: Number(input.verificationConcurrency) || 32
    })
    if (sendState) await this.sendState()
  }

  private async saveDownloadConcurrency(message: any) {
    const workflowId = this.requiredWorkflowId()
    const criteria = await this.store.getCriteria(workflowId)
    if (!criteria) throw new Error("Workflow criteria are missing")
    await this.store.saveDownloadConcurrency(
      workflowId,
      Number(message.sourceConcurrency) || criteria.sourceConcurrency,
      Number(message.targetConcurrency) || criteria.targetConcurrency,
      Number(message.verificationConcurrency) || criteria.verificationConcurrency || 32
    )
  }

  private async openDiff(key: string) {
    const workflow = await this.store.get(this.requiredWorkflowId())
    const changed = await changedFiles(workflow, this.store, key)
    if (!changed.length) throw new Error("No changed text file is available for this object")
    const relative =
      changed.length === 1
        ? changed[0]
        : await vscode.window.showQuickPick(changed, {
            title: `Select changed source for ${key}`,
            placeHolder: "Choose one source file to compare",
            ignoreFocusOut: true
          })
    if (!relative) return
    const id = objectFolderId(key)
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(
        this.store.artifactPath(workflow, "sources", "source", "objects", id, "content", relative)
      ),
      vscode.Uri.file(
        this.store.artifactPath(workflow, "sources", "target", "objects", id, "content", relative)
      ),
      `${key}: source ↔ target`
    )
  }

  private async export(output: string, type: "xlsx" | "csv") {
    const workflow = await this.store.get(this.requiredWorkflowId())
    const exported = await this.exporter.export(workflow, output, type)
    if (exported) vscode.window.showInformationMessage(`Exported ${exported}`)
  }

  private async run(operation: () => Promise<unknown>) {
    await this.panel.webview.postMessage({ command: "busy", value: true })
    try {
      await operation()
    } finally {
      await this.panel.webview.postMessage({ command: "busy", value: false })
      await this.sendState()
    }
  }

  private async runDiscoveryAndCompare() {
    const workflowId = this.requiredWorkflowId()
    await this.run(async () => {
      const discovered = await this.engine.runDiscovery(workflowId)
      if (discovered.steps.discovery.status !== "complete") return discovered
      return this.engine.compareExistence(workflowId)
    })
  }

  private requiredWorkflowId() {
    if (!this.selectedWorkflowId) throw new Error("Select a workflow first")
    return this.selectedWorkflowId
  }

  private async sendState() {
    const workflows = await this.store.list()
    const workflow = this.selectedWorkflowId
      ? workflows.find(item => item.workflowId === this.selectedWorkflowId)
      : undefined
    const criteria = workflow
      ? await this.store.getCriteria(workflow.workflowId, workflow)
      : undefined
    const previews = workflow ? await this.previews(workflow) : {}
    const exportAvailability = workflow
      ? await this.exporter.availability(workflow, WEBVIEW_EXPORTS)
      : {}
    const targetFolder = workflow ? connectedRoots().get(workflow.target.connectionId) : undefined
    const applySafety = assistedApplySafety(
      targetFolder
        ? ({ uri: targetFolder.uri, languageId: "abap" } as vscode.TextDocument)
        : undefined
    )
    await this.panel.webview.postMessage({
      command: "state",
      workflows,
      workflow,
      criteria,
      previews,
      exportAvailability,
      assistedApplySafety: applySafety,
      connectedSystems: [...connectedRoots().keys()],
      objectTypes: REPOSITORY_OBJECT_TYPES,
      sourceComparisonExcludedTypes: SOURCE_COMPARISON_EXCLUDED_OBJECT_TYPES
    })
  }

  private async sendProgress(workflowId: string) {
    await this.panel.webview.postMessage({
      command: "progress",
      workflow: await this.store.get(workflowId)
    })
  }

  private scheduleProgress(workflowId: string) {
    if (this.progressRefresh) return
    this.progressRefresh = setTimeout(() => {
      this.progressRefresh = undefined
      if (this.selectedWorkflowId === workflowId) void this.sendProgress(workflowId)
    }, 100)
  }

  private async previews(workflow: RepositoryWorkflow) {
    const [sourceDiscovery, targetDiscovery, existenceComparison, sourceComparison, plan] =
      await Promise.all([
        readInventoryPreview(this.store, workflow, "source"),
        readInventoryPreview(this.store, workflow, "target"),
        readExistencePreview(this.store, workflow),
        readSourceComparisonPreview(this.store, workflow),
        readJson(this.store.artifactPath(workflow, "assisted-apply", "plan.json"))
      ])
    return {
      sourceDiscovery,
      targetDiscovery,
      existenceComparison,
      sourceComparison,
      assistedApplyPlan: plan
    }
  }
}

export async function readInventoryPreview(
  store: WorkflowStore,
  workflow: RepositoryWorkflow,
  side: "source" | "target"
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  try {
    for await (const row of store.readJsonLines<Record<string, unknown>>(
      store.artifactPath(workflow, "discovery", side, "tadir.jsonl")
    ))
      rows.push({
        objectName: row.objectName,
        objectType: row.objectType,
        packageName: row.packageName,
        classification: row.classification,
        classificationReason: row.classificationReason
      })
  } catch {}
  return rows
}

export async function readExistencePreview(
  store: WorkflowStore,
  workflow: RepositoryWorkflow
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  try {
    for await (const row of store.readJsonLines<ExistenceComparisonRecord>(
      store.artifactPath(workflow, "comparison", "existence.jsonl")
    )) {
      const record = row.source ?? row.target
      rows.push({
        key: row.key,
        status: row.status,
        objectName: record?.objectName,
        objectType: record?.objectType,
        packageName: record?.packageName
      })
    }
  } catch {}
  return rows
}

export async function readSourceComparisonPreview(
  store: WorkflowStore,
  workflow: RepositoryWorkflow
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  try {
    for await (const row of store.readJsonLines<Record<string, any>>(
      store.artifactPath(workflow, "comparison", "source.jsonl")
    ))
      rows.push({
        key: row.key,
        status: row.status,
        filesChanged:
          (row.added?.length ?? 0) + (row.removed?.length ?? 0) + (row.changed?.length ?? 0),
        linesAdded: row.linesAdded,
        linesRemoved: row.linesRemoved,
        linesChanged: row.linesChanged
      })
  } catch {}
  return rows
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return undefined
  }
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = Math.random().toString(36).slice(2)
  const script = webview.asWebviewUri(repositoryWorkflowAsset(extensionUri, "main.js"))
  const style = webview.asWebviewUri(repositoryWorkflowAsset(extensionUri, "main.css"))
  const tabulatorScript = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "client", "dist", "media", "tabulator.min.js")
  )
  const tabulatorStyle = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "client", "dist", "media", "tabulator_bootstrap4.min.css")
  )
  return `<!doctype html>
  <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${tabulatorStyle}"><link rel="stylesheet" href="${style}"></head><body><main class="shell"><header><div><h1>Repository comparison workflow</h1><p id="subtitle">Persistent source and target analysis</p></div><button id="home" class="secondary hidden">Workflows</button></header><div id="error"></div><div id="app"></div></main><script nonce="${nonce}" src="${tabulatorScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`
}

export function repositoryWorkflowAssetRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "client", "dist", "media", "repositoryWorkflow")
}

export function repositoryWorkflowAsset(extensionUri: vscode.Uri, fileName: string): vscode.Uri {
  return vscode.Uri.joinPath(repositoryWorkflowAssetRoot(extensionUri), fileName)
}

export function registerRepositoryWorkflowCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.repositoryWorkflow", (workflowId?: string) =>
      RepositoryWorkflowPanel.open(context, workflowId)
    )
  )
}

async function changedFiles(
  workflow: RepositoryWorkflow,
  store: WorkflowStore,
  key: string
): Promise<string[]> {
  for await (const row of store.readJsonLines<any>(
    store.artifactPath(workflow, "comparison", "source.jsonl")
  ))
    if (row.key === key) return [...(row.changed || [])]
  return []
}
