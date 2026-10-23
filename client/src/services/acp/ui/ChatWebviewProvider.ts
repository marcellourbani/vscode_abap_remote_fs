import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { marked } from "marked"
import { SessionManager } from "../core/SessionManager"
import { SessionUpdateHandler, type SessionUpdateListener } from "../handlers/SessionUpdateHandler"
import type { ContentBlock, SessionNotification, SubagentUpdate } from "@agentclientprotocol/sdk"
import { log, logError } from "../utils/Logger"
import { sendEvent } from "../utils/TelemetryManager"
import { toAgentUri } from "../fs/AbapPathMapper"
import { ADTSCHEME } from "../../../adt/conections"
import { CHAT_MASCOT_HTML, CHAT_MASCOT_SCRIPT, CHAT_MASCOT_STYLES } from "./ChatMascot"

const TURN_RUNNING_CONTEXT = "abapfs.acp.turnRunning"

const ATTACHABLE_SCHEMES = new Set(["file", ADTSCHEME])

interface PastedAttachment {
  name: string
  mimeType: string
  data: string
  size: number
}

interface EditorSelection {
  key: string
  uri: vscode.Uri
  startLine: number
  endLine: number
  label: string
  text: string
}

function fileName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() || uri.fsPath
}

/**
 * WebviewViewProvider for the ABAP FS agent chat panel.
 * Renders chat messages, tool calls, plans, and handles user input.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "abapfs.views.agentChat"

  private view?: vscode.WebviewView
  private updateListener: SessionUpdateListener
  private _hasChatContent = false
  private mascotEnabled = true
  private mascotActivity: "connecting" | "idle" | "error" = "idle"
  private pendingAttachments = new Map<string, vscode.Uri | PastedAttachment>()
  private activeSessionId?: string
  private subagentSessions = new Map<string, SubagentUpdate>()
  private lastEditor?: vscode.TextEditor
  private dismissedSelection?: string
  private readonly usageReportedSessions = new Set<string>()
  private readonly editorListener = vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor(editor => this.onEditorChanged(editor)),
    vscode.window.onDidChangeTextEditorSelection(e => this.onEditorChanged(e.textEditor))
  )

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler
  ) {
    // Configure marked for safe rendering
    const markdownRenderer = new marked.Renderer()
    const renderCode = markdownRenderer.code.bind(markdownRenderer)
    markdownRenderer.code = token => (token.text.trim() ? renderCode(token) : "")
    marked.setOptions({
      breaks: true,
      gfm: true,
      renderer: markdownRenderer
    })

    // Register as a session update listener
    this.updateListener = (update: SessionNotification) => {
      this.handleSessionUpdate(update)
    }
    this.sessionUpdateHandler.addListener(this.updateListener)
  }

  /**
   * Render markdown text to HTML using marked.
   */
  private renderMarkdown(text: string): string {
    try {
      return marked.parse(text) as string
    } catch {
      return this.escapeHtml(text)
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    }

    webviewView.webview.html = this.getHtmlContent(webviewView.webview)

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message.type) {
        case "sendPrompt":
          this._hasChatContent = true
          await this.handleSendPrompt(
            message.text || "",
            message.attachmentIds || [],
            message.responseIndex
          )
          break
        case "recordResponseMetadata":
          if (
            typeof message.sessionId === "string" &&
            Number.isSafeInteger(message.responseIndex)
          ) {
            this.sessionManager.recordResponseMetadata(
              message.sessionId,
              message.responseIndex,
              message.metadata
            )
          }
          break
        case "pasteAttachments":
          this.acceptPastedAttachments(message.files)
          break
        case "pasteError":
          void vscode.window.showWarningMessage(message.message)
          break
        case "removeAttachment":
          this.pendingAttachments.delete(message.id)
          this.postAttachmentsUpdate()
          break
        case "dismissSelection":
          this.dismissedSelection = this.editorSelection(true)?.key
          this.postAttachmentsUpdate()
          break
        case "attachCurrentFile": {
          const current = this.currentFileUri()
          if (current) {
            this.attachFile(current)
          }
          break
        }
        case "cancelTurn":
          await this.handleCancelTurn()
          break
        case "cancelSubagent":
          await this.handleCancelSubagent(message.sessionId)
          break
        case "setMode":
          await this.handleSetMode(message.modeId)
          break
        case "setModel":
          await this.handleSetModel(message.modelId)
          break
        case "setConfigOption":
          await this.handleSetConfigOption(message.configId, message.value)
          break
        case "executeCommand":
          if (message.command) {
            await vscode.commands.executeCommand(message.command)
          }
          break
        case "ready":
          this.sendCurrentState()
          this.postMessage({ type: "mascotActivity", activity: this.mascotActivity })
          break
        case "renderMarkdown": {
          // Webview requests markdown rendering for history items
          const items: Array<{ index: number; text: string }> = message.items || []
          const rendered = items.map((item: { index: number; text: string }) => ({
            index: item.index,
            html: this.renderMarkdown(item.text)
          }))
          this.postMessage({ type: "markdownRendered", items: rendered })
          break
        }
      }
    })

    webviewView.onDidDispose(() => {
      this.view = undefined
    })
  }

  /**
   * Forward session update to webview.
   */
  private handleSessionUpdate(update: SessionNotification): void {
    const updateData = update.update as any

    // Persist session state BEFORE the active-session check. During session
    // creation the agent can dispatch notifications (e.g.
    // `available_commands_update`) before connectToAgent finishes setting
    // `activeSessionId`. Without this, those updates would be dropped and
    // the slash-command popup would never have commands to show.
    if (updateData?.sessionUpdate === "available_commands_update") {
      this.sessionManager.applyAvailableCommands(
        update.sessionId,
        updateData.availableCommands || []
      )
    }
    if (updateData?.sessionUpdate === "config_option_update") {
      this.sessionManager.applyConfigOptions(update.sessionId, updateData.configOptions || [])
    }
    if (
      updateData?.sessionUpdate === "usage_update" &&
      update.sessionId === this.sessionManager.getActiveSessionId()
    ) {
      this.usageReportedSessions.add(update.sessionId)
      log(
        `ACP usage_update: used=${updateData.used}, size=${updateData.size}, cost=${updateData.cost ? "reported" : "not reported"}`
      )
    }
    if (updateData?.sessionUpdate === "session_info_update") {
      this.sessionManager.applySessionInfoUpdate(update.sessionId, {
        title: updateData.title,
        updatedAt: updateData.updatedAt
      })
    }

    // Only forward to the webview if this is the active session — the
    // webview only shows the active parent and children it has been told about.
    const activeId = this.sessionManager.getActiveSessionId()
    if (update.sessionId === activeId && updateData?.sessionUpdate === "subagent_update") {
      const subagent = updateData as SubagentUpdate
      const previous = this.subagentSessions.get(subagent.sessionId)
      this.subagentSessions.set(subagent.sessionId, { ...previous, ...subagent })
    } else if (update.sessionId !== activeId && !this.subagentSessions.has(update.sessionId)) {
      return
    }

    this.postMessage({
      type: "sessionUpdate",
      update: update.update,
      sessionId: update.sessionId,
      isSubagent: update.sessionId !== activeId
    })
  }

  /**
   * Handle a prompt sent from the webview.
   */
  private async handleSendPrompt(
    text: string,
    attachmentIds: string[] = [],
    responseIndex?: number
  ): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId()
    if (!activeId) {
      this.postMessage({
        type: "error",
        message: "No agent connected. Connect to an agent before sending a message."
      })
      return
    }

    sendEvent(
      "chat/messageSent",
      {
        agentName: this.sessionManager.getActiveAgentName() ?? ""
      },
      {
        messageLength: text.length
      }
    )

    const session = this.sessionManager.getSession(activeId)
    if (!session) {
      this.postMessage({ type: "error", message: "The active session is unavailable." })
      return
    }

    // Track whether this particular turn receives a usage update.
    this.usageReportedSessions.delete(activeId)
    // Tell webview we're processing
    this.postMessage({ type: "promptStart", sessionId: activeId, responseIndex })
    void vscode.commands.executeCommand("setContext", TURN_RUNNING_CONTEXT, true)

    try {
      const capabilities = session.initResponse.agentCapabilities?.promptCapabilities
      const attachments: ContentBlock[] = []
      const selection = this.editorSelection()
      if (selection) {
        attachments.push(this.selectionBlock(selection, capabilities))
        this.dismissedSelection = selection.key
        this.postAttachmentsUpdate()
      }
      let inlineBudget = 10 * 1024 * 1024
      for (const id of attachmentIds.slice(0, 10)) {
        const attachment = this.pendingAttachments.get(id)
        if (!attachment) {
          continue
        }
        const prepared =
          attachment instanceof vscode.Uri
            ? await this.createPromptAttachment(attachment, capabilities, inlineBudget)
            : this.createPastedBlock(attachment, capabilities, inlineBudget)
        attachments.push(prepared.block)
        inlineBudget = Math.max(0, inlineBudget - prepared.inlineBytes)
      }
      const response = await this.sessionManager.sendPrompt(activeId, text, attachments)
      // Only label the session after the agent accepted the prompt.
      this.sessionManager.recordFirstPrompt(activeId, text || "Attachment")
      const turnUsage = response.usage
      log(
        `ACP prompt usage: ${turnUsage ? "reported" : "not reported"}; session usage_update: ${this.usageReportedSessions.has(activeId) ? "received" : "not received"}`
      )
      // Render the accumulated assistant text as markdown
      // The webview will have sent us the raw text via promptEnd handling
      this.postMessage({
        type: "promptEnd",
        stopReason: response.stopReason,
        usage: turnUsage
      })
      this.sessionManager.touchHistory(activeId)
      for (const id of attachmentIds) {
        this.pendingAttachments.delete(id)
      }
      this.postAttachmentsUpdate()
    } catch (e: any) {
      logError("Prompt failed", e)
      this.postMessage({
        type: "error",
        message: e.message || "Prompt failed"
      })
      this.postMessage({ type: "promptEnd", stopReason: "error" })
    } finally {
      void vscode.commands.executeCommand("setContext", TURN_RUNNING_CONTEXT, false)
    }
  }

  /**
   * Handle cancel request from webview.
   */
  private async handleCancelTurn(): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId()
    if (activeId) {
      try {
        await this.sessionManager.cancelTurn(activeId)
      } catch (e) {
        logError("Cancel failed", e)
      }
    }
  }

  private async handleCancelSubagent(sessionId: string): Promise<void> {
    if (!this.subagentSessions.get(sessionId)?.capabilities?.cancel) {
      return
    }
    const parentSessionId = this.sessionManager.getActiveSessionId()
    const connection = parentSessionId
      ? this.sessionManager.getConnectionForSession(parentSessionId)
      : undefined
    if (!connection) {
      return
    }
    try {
      await connection.agent.notify("session/cancel", { sessionId })
    } catch (error) {
      logError(`Failed to cancel subagent ${sessionId}`, error)
    }
  }

  /**
   * Handle mode change from webview picker.
   */
  private async handleSetMode(modeId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId()
    if (!activeId || !modeId) {
      return
    }
    try {
      await this.sessionManager.setMode(activeId, modeId)
    } catch (e: any) {
      logError("Failed to set mode", e)
      this.postMessage({ type: "error", message: `Failed to set mode: ${e.message}` })
    }
  }

  /**
   * Handle model change from webview picker.
   */
  private async handleSetModel(modelId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId()
    if (!activeId || !modelId) {
      return
    }
    try {
      await this.sessionManager.setModel(activeId, modelId)
    } catch (e: any) {
      logError("Failed to set model", e)
      this.postMessage({ type: "error", message: `Failed to set model: ${e.message}` })
    }
  }

  /**
   * Handle generic config-option change from webview picker
   * (ACP "Session Config Options"). The agent returns the full
   * configOptions state which we re-broadcast so any cascading
   * changes are reflected in the UI.
   */
  private async handleSetConfigOption(configId: string, value: string | boolean): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId()
    if (!activeId || !configId) {
      return
    }
    try {
      const options = await this.sessionManager.setConfigOption(activeId, configId, value)
      this.postMessage({ type: "configOptionsUpdate", configOptions: options })
    } catch (e: any) {
      logError("Failed to set config option", e)
      this.postMessage({ type: "error", message: `Failed to set ${configId}: ${e.message}` })
      // Roll back optimistic update on the webview by replaying current state
      const session = this.sessionManager.getSession(activeId)
      this.postMessage({
        type: "configOptionsUpdate",
        configOptions: session?.configOptions ?? null
      })
    }
  }

  /**
   * Send current session state to the webview on load.
   */
  private sendCurrentState(): void {
    this.postMessage({ type: "mascotVisibility", enabled: this.mascotEnabled })
    const activeId = this.sessionManager.getActiveSessionId()
    const session = activeId ? this.sessionManager.getSession(activeId) : null
    this.postMessage({
      type: "state",
      activeSessionId: activeId,
      session: session
        ? {
            sessionId: session.sessionId,
            agentName: session.agentDisplayName,
            title: session.title,
            cwd: session.cwd,
            modes: session.modes,
            models: session.models,
            configOptions: session.configOptions,
            availableCommands: session.availableCommands,
            responseMetadata: this.sessionManager.getResponseMetadata(session.sessionId)
          }
        : null
    })
    this.postAttachmentsUpdate()
  }

  setMascotEnabled(enabled: boolean): void {
    this.mascotEnabled = enabled
    this.postMessage({ type: "mascotVisibility", enabled })
  }

  notifyMascotActivity(activity: "connecting" | "idle" | "error"): void {
    this.mascotActivity = activity
    this.postMessage({ type: "mascotActivity", activity })
  }

  private postAttachmentsUpdate(): void {
    const selection = this.editorSelection()
    const current = this.currentFileUri()
    const suggested =
      !selection && current && !this.pendingAttachments.has(current.toString())
        ? current
        : undefined
    this.postMessage({
      type: "attachmentsUpdate",
      attachments: Array.from(this.pendingAttachments, ([id, attachment]) => ({
        id,
        name: attachment instanceof vscode.Uri ? fileName(attachment) : attachment.name
      })),
      currentFile: suggested ? { name: fileName(suggested) } : null,
      selection: selection ? { name: selection.label } : null
    })
  }

  private onEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (editor && ATTACHABLE_SCHEMES.has(editor.document.uri.scheme)) {
      this.lastEditor = editor
    }
    this.postAttachmentsUpdate()
  }

  /** The chat view takes focus away from the editor, so fall back to the last attachable one */
  private currentEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor ?? this.lastEditor
    if (!editor || editor.document.isClosed) {
      return undefined
    }
    return ATTACHABLE_SCHEMES.has(editor.document.uri.scheme) ? editor : undefined
  }

  /** The editor file offered as one-click context, like the current-file suggestion in Copilot Chat */
  private currentFileUri(): vscode.Uri | undefined {
    return this.currentEditor()?.document.uri
  }

  /** A non-empty editor selection is sent automatically with every prompt, as in Copilot Chat */
  private editorSelection(includeDismissed = false): EditorSelection | undefined {
    const editor = this.currentEditor()
    if (!editor || editor.selection.isEmpty) {
      return undefined
    }
    const { document, selection } = editor
    const endLine =
      selection.end.character === 0 && selection.end.line > selection.start.line
        ? selection.end.line - 1
        : selection.end.line
    const range = new vscode.Range(
      selection.start.line,
      0,
      endLine,
      document.lineAt(endLine).text.length
    )
    const key = `${document.uri.toString()}#${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`
    if (!includeDismissed && key === this.dismissedSelection) {
      return undefined
    }
    const lines =
      range.start.line === endLine ? `${endLine + 1}` : `${range.start.line + 1}-${endLine + 1}`
    return {
      key,
      uri: document.uri,
      startLine: range.start.line + 1,
      endLine: endLine + 1,
      label: `${fileName(document.uri)}:${lines}`,
      text: document.getText(range)
    }
  }

  private selectionBlock(
    selection: EditorSelection,
    capabilities: { embeddedContext?: boolean } | undefined
  ): ContentBlock {
    const lineRange = `L${selection.startLine}-L${selection.endLine}`
    const uri = `${toAgentUri(selection.uri)}#${lineRange}`
    if (capabilities?.embeddedContext) {
      return { type: "resource", resource: { uri, mimeType: "text/plain", text: selection.text } }
    }
    return {
      type: "text",
      text: `Selected lines ${selection.startLine}-${selection.endLine} of ${toAgentUri(selection.uri)}:\n\`\`\`\n${selection.text}\n\`\`\``
    }
  }

  private acceptPastedAttachments(files: unknown): void {
    if (!Array.isArray(files)) return
    for (const file of files) {
      if (
        !file ||
        typeof file.name !== "string" ||
        typeof file.mimeType !== "string" ||
        typeof file.data !== "string" ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > 5 * 1024 * 1024 ||
        file.data.length > 7 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) ||
        Buffer.byteLength(file.data, "base64") !== file.size
      )
        continue
      const capabilities =
        this.sessionManager.getActiveSession()?.initResponse.agentCapabilities?.promptCapabilities
      const image = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mimeType)
      const audio = [
        "audio/aac",
        "audio/flac",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/opus",
        "audio/wav",
        "audio/webm"
      ].includes(file.mimeType)
      const text =
        file.mimeType.startsWith("text/") ||
        file.mimeType === "application/json" ||
        /\.(?:abap|cfg|conf|css|csv|diff|html|java|js|json|jsonc|log|md|patch|py|sql|ts|tsx|txt|xml|yaml|yml)$/i.test(
          file.name
        )
      if (!(image && capabilities?.image) && !(audio && capabilities?.audio) && !text) {
        void vscode.window.showWarningMessage(
          "This pasted file type is not supported by the connected agent."
        )
        continue
      }
      if (this.pendingAttachments.size >= 10) {
        void vscode.window.showWarningMessage("Attach up to 10 files per prompt.")
        break
      }
      const id = `pasted-${randomUUID()}`
      this.pendingAttachments.set(id, {
        name: file.name.slice(0, 120),
        mimeType: file.mimeType,
        data: file.data,
        size: file.size
      })
    }
    this.postAttachmentsUpdate()
  }

  private createPastedBlock(
    file: PastedAttachment,
    capabilities: { image?: boolean; audio?: boolean; embeddedContext?: boolean } | undefined,
    budget: number
  ): { block: ContentBlock; inlineBytes: number } {
    if (file.size > budget) throw new Error("Pasted attachments exceed the 10 MB prompt limit.")
    if (file.mimeType.startsWith("image/") && capabilities?.image) {
      return {
        block: { type: "image", data: file.data, mimeType: file.mimeType },
        inlineBytes: file.size
      }
    }
    if (file.mimeType.startsWith("audio/") && capabilities?.audio) {
      return {
        block: { type: "audio", data: file.data, mimeType: file.mimeType },
        inlineBytes: file.size
      }
    }
    const textExtension =
      /\.(?:abap|cfg|conf|css|csv|diff|html|java|js|json|jsonc|log|md|patch|py|sql|ts|tsx|txt|xml|yaml|yml)$/i.test(
        file.name
      )
    if (
      file.mimeType.startsWith("text/") ||
      file.mimeType === "application/json" ||
      textExtension
    ) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(file.data, "base64")
      )
      if (text.includes("\0")) throw new Error("Pasted file is not text.")
      const content = `Pasted file ${file.name}:\n${text}`
      return { block: { type: "text", text: content }, inlineBytes: file.size }
    }
    throw new Error(
      `The agent cannot receive pasted ${file.mimeType} files. Attach a readable file instead.`
    )
  }

  private async createPromptAttachment(
    uri: vscode.Uri,
    capabilities: { image?: boolean; audio?: boolean; embeddedContext?: boolean } | undefined,
    inlineBudget: number
  ): Promise<{ block: ContentBlock; inlineBytes: number }> {
    const name = uri.path.split("/").pop() || uri.fsPath
    const uriString = toAgentUri(uri)
    const stat = await vscode.workspace.fs.stat(uri)
    const extension = name.split(".").pop()?.toLowerCase() || ""
    const imageMimeTypes: Record<string, string> = {
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      webp: "image/webp"
    }
    const audioMimeTypes: Record<string, string> = {
      aac: "audio/aac",
      flac: "audio/flac",
      m4a: "audio/mp4",
      mp3: "audio/mpeg",
      oga: "audio/ogg",
      ogg: "audio/ogg",
      opus: "audio/opus",
      wav: "audio/wav",
      webm: "audio/webm"
    }
    const textMimeTypes: Record<string, string> = {
      c: "text/x-c",
      cc: "text/x-c++",
      cfg: "text/plain",
      conf: "text/plain",
      cpp: "text/x-c++",
      cs: "text/x-csharp",
      css: "text/css",
      csv: "text/csv",
      diff: "text/x-diff",
      env: "text/plain",
      go: "text/x-go",
      h: "text/x-c",
      hpp: "text/x-c++",
      html: "text/html",
      java: "text/x-java",
      js: "text/javascript",
      json: "application/json",
      jsonc: "application/json",
      jsx: "text/javascript",
      kt: "text/x-kotlin",
      log: "text/plain",
      lua: "text/x-lua",
      md: "text/markdown",
      mjs: "text/javascript",
      patch: "text/x-diff",
      php: "text/x-php",
      pl: "text/x-perl",
      properties: "text/plain",
      ps1: "text/plain",
      py: "text/x-python",
      rb: "text/x-ruby",
      rs: "text/x-rust",
      sh: "text/x-shellscript",
      sql: "application/sql",
      swift: "text/x-swift",
      toml: "application/toml",
      ts: "text/typescript",
      tsx: "text/typescript",
      txt: "text/plain",
      vue: "text/html",
      xml: "application/xml",
      yaml: "text/yaml",
      yml: "text/yaml"
    }
    const imageMimeType = imageMimeTypes[extension]
    const audioMimeType = audioMimeTypes[extension]
    const textMimeType = textMimeTypes[extension]

    if (
      imageMimeType &&
      capabilities?.image &&
      stat.size <= Math.min(5 * 1024 * 1024, inlineBudget)
    ) {
      const data = await vscode.workspace.fs.readFile(uri)
      return {
        block: {
          type: "image",
          data: Buffer.from(data).toString("base64"),
          mimeType: imageMimeType,
          uri: uriString
        },
        inlineBytes: stat.size
      }
    }

    if (
      audioMimeType &&
      capabilities?.audio &&
      stat.size <= Math.min(8 * 1024 * 1024, inlineBudget)
    ) {
      const data = await vscode.workspace.fs.readFile(uri)
      return {
        block: {
          type: "audio",
          data: Buffer.from(data).toString("base64"),
          mimeType: audioMimeType
        },
        inlineBytes: stat.size
      }
    }

    if (capabilities?.embeddedContext && stat.size <= Math.min(1024 * 1024, inlineBudget)) {
      try {
        const openDocument = vscode.workspace.textDocuments.find(
          doc => doc.uri.toString() === uri.toString()
        )
        const data = openDocument ? undefined : await vscode.workspace.fs.readFile(uri)
        const text = openDocument
          ? openDocument.getText()
          : new TextDecoder("utf-8", { fatal: true }).decode(data)
        if (!text.includes("\0")) {
          return {
            block: {
              type: "resource",
              resource: { uri: uriString, mimeType: textMimeType || "text/plain", text }
            },
            inlineBytes: stat.size
          }
        }
      } catch {
        // Binary or non-UTF-8 files remain available as resource links.
      }
    }

    return {
      block: {
        type: "resource_link",
        name,
        uri: uriString,
        mimeType: imageMimeType || audioMimeType || textMimeType,
        size: stat.size
      },
      inlineBytes: 0
    }
  }

  /**
   * Post a message to the webview if it exists.
   */
  private postMessage(message: any): void {
    this.view?.webview.postMessage(message)
  }

  /**
   * Notify webview of a new active session.
   */
  notifyActiveSessionChanged(): void {
    const nextSessionId = this.sessionManager.getActiveSessionId() || undefined
    if (nextSessionId !== this.activeSessionId) {
      this.activeSessionId = nextSessionId
      this.subagentSessions.clear()
      this.postMessage({ type: "subagentsReset" })
    }
    this.sendCurrentState()
  }

  /**
   * Notify webview of mode state changes.
   */
  notifyModesUpdate(modes: any): void {
    this.postMessage({ type: "modesUpdate", modes })
  }

  /**
   * Notify webview of model state changes.
   */
  notifyModelsUpdate(models: any): void {
    this.postMessage({ type: "modelsUpdate", models })
  }

  /**
   * Notify webview of session config-option state changes.
   */
  notifyConfigOptionsUpdate(configOptions: any): void {
    this.postMessage({ type: "configOptionsUpdate", configOptions })
  }

  /**
   * Notify webview that a `session/load` replay is starting. The webview
   * wipes any previously-displayed history, disables input, and shows a
   * loading overlay until {@link notifyLoadSessionEnd} fires.
   */
  notifyLoadSessionStart(): void {
    this.postMessage({ type: "loadSessionStart" })
  }

  /** Notify webview that the active replay finished (success or failure). */
  notifyLoadSessionEnd(ok: boolean): void {
    this.postMessage({ type: "loadSessionEnd", ok })
  }

  /** Notify webview that session title / metadata changed. */
  notifySessionInfoUpdate(title: string | undefined | null): void {
    this.postMessage({ type: "sessionInfoUpdate", title: title ?? null })
  }

  /**
   * Clear the chat history and reset to welcome state.
   * Called when starting a new conversation.
   */
  clearChat(): void {
    this._hasChatContent = false
    this.subagentSessions.clear()
    this.postMessage({ type: "clearChat" })
  }

  /**
   * Whether the chat has any messages.
   */
  get hasChatContent(): boolean {
    return this._hasChatContent
  }

  /**
   * Generate the HTML content for the webview.
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce()
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "client", "dist", "media", "codicons", "codicon.css")
    )
    const htmlPath = path.join(
      this.extensionUri.fsPath,
      "client",
      "dist",
      "media",
      "acp",
      "chatView.html"
    )
    const template = readFileSync(htmlPath, "utf8")
    // `{{TOKEN}}` markers sit in plain attribute/text positions in chatView.html. The mascot
    // markers are wrapped as comments instead (`/* ... */`, `<!-- ... -->`) so the static file
    // stays valid CSS/HTML/JS for editors and linters to check on its own.
    // split/join (not String.replace) because replacement text can contain literal `$`
    // characters, which String.replace would otherwise treat as `$&`/`$$` patterns.
    const substitutions: [string, string][] = [
      ["{{CSP_SOURCE}}", webview.cspSource],
      ["{{NONCE}}", nonce],
      ["{{CODICONS_URI}}", codiconsUri.toString()],
      ["/* MASCOT_STYLES_PLACEHOLDER */", CHAT_MASCOT_STYLES],
      ["<!-- MASCOT_HTML_PLACEHOLDER -->", CHAT_MASCOT_HTML],
      ["/* MASCOT_SCRIPT_PLACEHOLDER */", CHAT_MASCOT_SCRIPT]
    ]
    return substitutions.reduce((html, [token, value]) => html.split(token).join(value), template)
  }

  /**
   * Attach a file URI — notify the webview to include it in the next prompt.
   */
  attachFile(uri: vscode.Uri): void {
    if (!this.pendingAttachments.has(uri.toString()) && this.pendingAttachments.size >= 10) {
      void vscode.window.showWarningMessage("Attach up to 10 files per prompt.")
      return
    }
    this.pendingAttachments.set(uri.toString(), uri)
    this.postAttachmentsUpdate()
    this.view?.show?.(true)
  }

  dispose(): void {
    this.sessionUpdateHandler.removeListener(this.updateListener)
    this.editorListener.dispose()
  }
}

function getNonce(): string {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
