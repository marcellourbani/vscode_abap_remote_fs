import * as vscode from "vscode"
import { marked } from "marked"
import { SessionManager } from "../core/SessionManager"
import { SessionUpdateHandler, type SessionUpdateListener } from "../handlers/SessionUpdateHandler"
import type { ContentBlock, SessionNotification, SubagentUpdate } from "@agentclientprotocol/sdk"
import { logError } from "../utils/Logger"
import { sendEvent } from "../utils/TelemetryManager"
import { toAgentUri } from "../fs/AbapPathMapper"
import { ADTSCHEME } from "../../../adt/conections"

const TURN_RUNNING_CONTEXT = "abapfs.acp.turnRunning"

const ATTACHABLE_SCHEMES = new Set(["file", ADTSCHEME])

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
  private pendingAttachments = new Map<string, vscode.Uri>()
  private activeSessionId?: string
  private subagentSessions = new Map<string, SubagentUpdate>()
  private lastEditor?: vscode.TextEditor
  private dismissedSelection?: string
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
    marked.setOptions({
      breaks: true,
      gfm: true
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
          await this.handleSendPrompt(message.text || "", message.attachmentIds || [])
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
          // Webview loaded — send current session state
          this.sendCurrentState()
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
  private async handleSendPrompt(text: string, attachmentIds: string[] = []): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId()
    if (!activeId) {
      this.postMessage({
        type: "error",
        message: "No active session. Create a session first."
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

    // Record the first prompt for the history store (used as a label
    // fallback when no title is supplied by the agent).
    this.sessionManager.recordFirstPrompt(activeId, text)

    // Tell webview we're processing
    this.postMessage({ type: "promptStart" })
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
        const uri = this.pendingAttachments.get(id)
        if (!uri) {
          continue
        }
        const prepared = await this.createPromptAttachment(uri, capabilities, inlineBudget)
        attachments.push(prepared.block)
        inlineBudget = Math.max(0, inlineBudget - prepared.inlineBytes)
      }
      const response = await this.sessionManager.sendPrompt(activeId, text, attachments)
      // Render the accumulated assistant text as markdown
      // The webview will have sent us the raw text via promptEnd handling
      this.postMessage({
        type: "promptEnd",
        stopReason: response.stopReason,
        usage: (response as any).usage
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
            availableCommands: session.availableCommands
          }
        : null
    })
    this.postAttachmentsUpdate()
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
      attachments: Array.from(this.pendingAttachments, ([id, uri]) => ({
        id,
        name: fileName(uri)
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

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource}; media-src data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>ABAP FS - Agent Chat</title>
  <link rel="stylesheet" href="${codiconsUri}">
  <style>
    :root {
      --container-padding: 12px;
      --message-radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-panel-background, var(--vscode-sideBar-background));
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Session connected banner */
    .session-banner {
      display: none;
      padding: 10px var(--container-padding);
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 0.9em;
    }
    .session-banner.visible { display: flex; align-items: center; gap: 8px; }
    .session-banner .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed);
      flex-shrink: 0;
    }
    .session-banner .info { flex: 1; }
    .session-banner .agent { font-weight: 600; }
    .session-banner .cwd {
      font-size: 0.85em;
      opacity: 0.6;
      margin-top: 1px;
    }
    .session-banner .status {
      font-size: 0.85em;
      opacity: 0.7;
      flex-shrink: 0;
    }

    /* Messages area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: var(--container-padding);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .message {
      padding: 8px 12px;
      border-radius: var(--message-radius);
      max-width: 95%;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      max-width: 88%;
      background: var(--vscode-chat-requestBackground, var(--vscode-editorWidget-background));
      color: var(--vscode-foreground);
    }
    .message.assistant {
      align-self: flex-start;
      max-width: 100%;
      padding-left: 4px;
      padding-right: 4px;
      background: transparent;
      border: 0;
    }
    .message.notice {
      align-self: flex-start;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      font-size: 0.9em;
    }
    .message.notice.warning { border-left: 3px solid var(--vscode-editorWarning-foreground); }
    .message.notice.error { border-left: 3px solid var(--vscode-errorForeground); }
    .message.compaction { align-self: flex-start; opacity: 0.8; font-size: 0.85em; }
    .message.compaction.failed { border-left: 3px solid var(--vscode-errorForeground); }
    .message.media { align-self: flex-start; max-width: 100%; }
    .message.media img { display: block; max-width: 100%; max-height: 320px; object-fit: contain; }
    .message.media audio { display: block; max-width: 100%; }
    /* Markdown body inside assistant messages */
    .message.assistant.md-rendered {
      white-space: normal;
    }
    .message.assistant.md-rendered p {
      margin: 0 0 0.5em;
    }
    .message.assistant.md-rendered p:last-child {
      margin-bottom: 0;
    }
    .message.assistant.md-rendered pre {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
      overflow-x: auto;
      margin: 0.5em 0;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      line-height: 1.4;
    }
    .message.assistant.md-rendered code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .message.assistant.md-rendered pre code {
      background: none;
      padding: 0;
      border-radius: 0;
    }
    .message.assistant.md-rendered ul,
    .message.assistant.md-rendered ol {
      margin: 0.4em 0;
      padding-left: 1.5em;
    }
    .message.assistant.md-rendered li {
      margin: 0.15em 0;
    }
    .message.assistant.md-rendered h1,
    .message.assistant.md-rendered h2,
    .message.assistant.md-rendered h3,
    .message.assistant.md-rendered h4 {
      margin: 0.6em 0 0.3em;
      font-weight: 600;
    }
    .message.assistant.md-rendered h1 { font-size: 1.3em; }
    .message.assistant.md-rendered h2 { font-size: 1.15em; }
    .message.assistant.md-rendered h3 { font-size: 1.05em; }
    .message.assistant.md-rendered blockquote {
      border-left: 3px solid var(--vscode-focusBorder);
      margin: 0.4em 0;
      padding: 0.2em 0 0.2em 0.8em;
      opacity: 0.85;
    }
    .message.assistant.md-rendered a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .message.assistant.md-rendered a:hover {
      text-decoration: underline;
    }
    .message.assistant.md-rendered table {
      border-collapse: collapse;
      margin: 0.4em 0;
      font-size: 0.9em;
    }
    .message.assistant.md-rendered th,
    .message.assistant.md-rendered td {
      border: 1px solid var(--vscode-panel-border);
      padding: 4px 8px;
    }
    .message.assistant.md-rendered th {
      background: var(--vscode-editorWidget-background);
      font-weight: 600;
    }
    .message.assistant.md-rendered hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 0.6em 0;
    }
    /* Thought block — collapsible <details> element */
    .thought-block {
      width: 100%;
      margin-bottom: 4px;
    }
    .thought-block summary {
      font-size: 0.85em;
      opacity: 0.7;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
      list-style: none;
    }
    .thought-block summary::-webkit-details-marker { display: none; }
    .thought-block summary::before {
      content: '▸';
      font-size: 0.9em;
      transition: transform 0.15s;
    }
    .thought-block[open] summary::before {
      content: '▾';
    }
    .thought-block summary:hover { opacity: 1; }
    .thought-block.streaming summary .thought-indicator {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--vscode-progressBar-background);
      animation: thoughtPulse 1.2s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes thoughtPulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .thought-block .thought-content {
      margin-top: 4px;
      padding: 8px 12px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      font-size: 0.88em;
      opacity: 0.75;
      font-style: italic;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }

    .message.error {
      align-self: center;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }

    /* Turn container — groups assistant text + tool calls */
    .turn {
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-self: flex-start;
      max-width: 95%;
    }

    /* Tool calls group inside a turn */
    .turn-tools {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 10px;
      border-left: 2px solid var(--vscode-panel-border);
      margin: 2px 0;
    }
    .turn-tools-summary {
      font-size: 0.8em;
      opacity: 0.6;
      cursor: pointer;
      padding: 2px 0;
      user-select: none;
    }
    .turn-tools-summary:hover { opacity: 0.9; }
    .turn-tools-list { }
    .turn-tools-list.collapsed { display: none; }

    .subagent-card {
      margin: 4px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editorWidget-background);
    }
    .subagent-heading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
    }
    .subagent-title { flex: 1; min-width: 0; font-weight: 600; }
    .subagent-state { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .subagent-description {
      padding: 0 8px 6px;
      color: var(--vscode-descriptionForeground);
      white-space: pre-wrap;
    }
    .subagent-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 8px 8px;
    }
    .subagent-message {
      padding: 6px 8px;
      border-left: 2px solid var(--vscode-panel-border);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .subagent-tool {
      padding: 4px 8px;
      background: var(--vscode-editor-background);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }
    .subagent-cancel {
      border: 0;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
    }
    .subagent-cancel[hidden] { display: none; }

    /* Compact inline tool call */
    .tool-call-inline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      font-size: 0.85em;
      border-radius: 4px;
      background: var(--vscode-editorWidget-background);
      opacity: 0.85;
    }
    .tool-call-inline .tc-icon {
      flex-shrink: 0;
      width: 14px;
      text-align: center;
    }
    .tool-call-inline .tc-icon.pending { color: var(--vscode-badge-foreground); }
    .tool-call-inline .tc-icon.running { color: var(--vscode-progressBar-background); }
    .tool-call-inline .tc-icon.completed { color: var(--vscode-testing-iconPassed); }
    .tool-call-inline .tc-icon.failed { color: var(--vscode-testing-iconFailed); }
    .tool-call-inline .tc-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-call-inline .tc-toggle {
      border: 0;
      padding: 0 4px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      cursor: pointer;
    }
    .tool-call-inline .tc-output {
      flex-basis: 100%;
      max-height: 220px;
      overflow: auto;
      margin: 4px 0 0 20px;
      padding: 6px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family);
    }
    .tool-call-inline .tc-output[hidden] { display: none; }

    /* Legacy standalone tool-call card (for history restore) */
    .tool-call {
      padding: 8px 12px;
      border-radius: var(--message-radius);
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      font-size: 0.9em;
    }
    .tool-call .title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .tool-call .status-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.8em;
      margin-left: 6px;
    }
    .tool-call .status-badge.pending { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .tool-call .status-badge.running { background: var(--vscode-progressBar-background); color: white; }
    .tool-call .status-badge.completed { background: var(--vscode-testing-iconPassed); color: white; }
    .tool-call .status-badge.failed { background: var(--vscode-testing-iconFailed); color: white; }

    /* Plan */
    .plan {
      padding: 8px 12px;
      border-radius: var(--message-radius);
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .plan .plan-title { font-weight: 600; margin-bottom: 6px; }
    .plan .plan-entry {
      padding: 2px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .plan .plan-entry.completed { text-decoration: line-through; opacity: 0.6; }

    /* Empty / welcome state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
      padding: 24px 20px;
      gap: 6px;
      position: relative;
      z-index: 1;
    }
    .empty-state .icon { font-size: 2.4em; margin-bottom: 4px; opacity: 0.85; }
    .empty-state .title {
      font-size: 1.1em;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .empty-state .subtitle {
      font-size: 0.85em;
      opacity: 0.6;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .empty-state .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 220px;
    }
    .empty-state .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      font-weight: 500;
      pointer-events: auto;
      position: relative;
      z-index: 2;
    }
    .empty-state .action-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .empty-state .action-btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .empty-state .action-btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .empty-state .action-btn.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .empty-state .hint {
      font-size: 0.8em;
      opacity: 0.5;
      margin-top: 8px;
    }
    .empty-state .hint kbd {
      padding: 1px 5px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.95em;
      background: var(--vscode-editor-background);
    }

    /* Session connected banner */
    .session-banner {
      display: none;
      padding: 10px var(--container-padding);
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 0.9em;
    }
    .session-banner.visible { display: flex; align-items: center; gap: 8px; }

    /* Input area states */
    .input-area.disabled .input-toolbar,
    .input-area.disabled .input-editor-wrap,
    .input-area.disabled .input-send-row { opacity: 0.4; pointer-events: none; }

    /* Input area container */
    .input-area {
      position: relative;
      margin: 8px 12px 12px;
      padding: 8px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--vscode-input-background);
    }

    /* Resize handle */
    .input-resize-handle {
      display: none;
    }
    .input-resize-handle::after {
      content: '';
      width: 32px;
      height: 2px;
      border-radius: 1px;
      background: var(--vscode-panel-border);
      transition: background 0.15s;
    }
    .input-resize-handle:hover::after {
      background: var(--vscode-focusBorder);
    }

    /* Toolbar row */
    .input-toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 28px;
      padding: 0 2px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .composer-icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      color: var(--vscode-foreground);
      background: transparent;
      font-size: 20px;
      cursor: pointer;
    }
    .composer-icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }

    /* Picker wrapper — positioned relatively to anchor the dropdown */
    .picker-wrap {
      position: relative;
      min-width: 0;
      max-width: 100%;
    }
    .picker-wrap.hidden { display: none; }

    /* Picker buttons */
    .picker-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: calc(var(--vscode-font-size) - 1px);
      cursor: pointer;
      white-space: nowrap;
      max-width: 100%;
      min-width: 0;
      opacity: 0.8;
    }
    .picker-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      opacity: 1;
    }
    .picker-btn .picker-icon {
      flex-shrink: 0;
      font-size: 14px;
    }
    .picker-btn .picker-label {
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .picker-btn .picker-chevron {
      flex-shrink: 0;
      font-size: 10px;
      opacity: 0.6;
    }
    .config-boolean-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 0 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      color: var(--vscode-foreground);
      font-size: 0.9em;
      cursor: pointer;
    }
    .config-boolean-label input { margin: 0; }

    /* Picker dropdown — sibling of button, positioned from wrapper */
    .picker-dropdown {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      min-width: 180px;
      max-width: min(420px, calc(100vw - 16px));
      max-height: 240px;
      overflow-y: auto;
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      z-index: 100;
      margin-bottom: 4px;
    }
    .picker-dropdown.open { display: block; }
    .picker-dropdown-item {
      padding: 6px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: calc(var(--vscode-font-size) - 1px);
      color: var(--vscode-dropdown-foreground);
    }
    .picker-dropdown-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .picker-dropdown-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .picker-dropdown-item .check {
      width: 14px;
      text-align: center;
      flex-shrink: 0;
    }
    .picker-dropdown-item .item-label {
      flex: 1 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Floating tooltip used by all picker dropdowns to show option
       description on hover (positioned outside the dropdown). */
    .picker-tooltip {
      position: fixed;
      display: none;
      max-width: 280px;
      padding: 6px 10px;
      background: var(--vscode-editorHoverWidget-background);
      color: var(--vscode-editorHoverWidget-foreground);
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      font-size: calc(var(--vscode-font-size) - 1px);
      line-height: 1.4;
      white-space: normal;
      word-break: break-word;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      z-index: 300;
    }
    .picker-tooltip.visible { display: block; }

    /* Header for grouped picker options */
    .picker-dropdown-group-header {
      padding: 6px 10px 2px;
      font-size: 0.75em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      pointer-events: none;
      color: var(--vscode-dropdown-foreground);
    }
    .picker-dropdown-group-header:not(:first-child) {
      border-top: 1px solid var(--vscode-panel-border);
      margin-top: 4px;
    }

    /* Dynamic config-options picker row — sits inline with legacy pickers */
    .picker-row {
      display: contents;
    }

    /* Toolbar spacer */
    .toolbar-spacer { flex: 1; }

    /* Editor wrapper */
    .input-editor-wrap {
      padding: 0 2px;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .attachment-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 0 var(--container-padding) 6px;
    }
    .attachment-list:empty { display: none; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      padding: 2px 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    .attachment-chip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .attachment-chip-remove {
      border: 0;
      padding: 0 2px;
      color: inherit;
      background: transparent;
      cursor: pointer;
    }
    .input-editor-wrap textarea {
      flex: 1;
      resize: none;
      background: transparent;
      color: var(--vscode-input-foreground);
      border: 0;
      border-radius: 0;
      padding: 6px 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.4;
      min-height: 56px;
      outline: none;
    }
    .input-editor-wrap textarea:focus {
      outline: none;
    }

    /* Send row */
    .input-send-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 2px 2px;
      gap: 6px;
      flex-shrink: 0;
    }

    /* Send / Stop toggle button — pill-shaped */
    .send-stop-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 0 8px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      font-weight: 500;
      white-space: nowrap;
      min-width: 30px;
      height: 28px;
      font-size: 18px;
      transition: background 0.15s;
    }
    .send-stop-btn.send {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .send-stop-btn.send:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .send-stop-btn.send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .send-stop-btn.stop {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #f48771);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .send-stop-btn.stop:hover {
      opacity: 0.9;
    }

    /* Slash command autocomplete popup */
    .slash-popup {
      display: none;
      position: absolute;
      bottom: 100%;
      left: var(--container-padding);
      right: var(--container-padding);
      max-height: 200px;
      overflow-y: auto;
      background: var(--vscode-editorSuggestWidget-background, var(--vscode-dropdown-background));
      border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-dropdown-border));
      border-radius: 6px;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.25);
      z-index: 200;
      margin-bottom: 4px;
    }
    .slash-popup.open { display: block; }
    .slash-popup-header {
      padding: 6px 10px 4px;
      font-size: 0.8em;
      opacity: 0.5;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .slash-popup-item {
      padding: 6px 10px;
      cursor: pointer;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .slash-popup-item:hover,
    .slash-popup-item.active {
      background: var(--vscode-list-hoverBackground);
    }
    .slash-popup-item .cmd-name {
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
    }
    .slash-popup-item .cmd-desc {
      font-size: 0.9em;
      opacity: 0.7;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      opacity: 0.6;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Full-area overlay shown while a session is being loaded via session/load */
    .load-overlay {
      display: none;
      position: fixed;
      inset: 0;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent);
      backdrop-filter: blur(2px);
      z-index: 400;
      font-size: 0.9em;
      color: var(--vscode-foreground);
      pointer-events: all;
    }
    .load-overlay.visible { display: flex; }
    .load-overlay .spinner {
      width: 22px;
      height: 22px;
      border-width: 3px;
      opacity: 0.9;
    }
    .load-overlay .label { opacity: 0.85; }

    /* ---- Copilot Chat look and feel (overrides the base styles above) ---- */
    body {
      font-family: var(--vscode-chat-font-family, var(--vscode-font-family));
      font-size: var(--vscode-chat-font-size, var(--vscode-font-size));
      background: var(--vscode-sideBar-background);
    }
    .codicon { font-size: 16px; line-height: 16px; vertical-align: middle; }
    .session-banner, .session-banner.visible { display: none; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }

    .messages { padding: 12px 16px 4px; gap: 16px; }
    .message { padding: 0; border-radius: 0; max-width: 100%; line-height: 1.6; background: none; border: none; }
    .message.user {
      align-self: flex-end;
      max-width: 85%;
      padding: 6px 12px;
      border-radius: 10px;
      background: var(--vscode-chat-requestBubbleBackground, var(--vscode-chat-requestBackground, var(--vscode-editorWidget-background)));
      border: 1px solid var(--vscode-chat-requestBorder, transparent);
      color: var(--vscode-foreground);
    }
    .message.assistant { align-self: stretch; background: none; color: var(--vscode-foreground); }
    .message.notice {
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 4px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
    }
    .message.error {
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 4px;
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground, transparent);
      border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
    }
    .message.assistant.md-rendered pre {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, transparent));
      border-radius: 6px;
      padding: 8px 12px;
    }
    .message.assistant.md-rendered code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-textPreformat-background);
      color: var(--vscode-textPreformat-foreground);
      border-radius: 3px;
      padding: 1px 4px;
    }
    .message.assistant.md-rendered pre code { background: none; color: inherit; padding: 0; }
    .message.assistant.md-rendered a { color: var(--vscode-textLink-foreground); }
    .message.assistant.md-rendered a:hover { color: var(--vscode-textLink-activeForeground); }

    .turn { gap: 6px; padding: 0; border: none; background: none; }
    .turn-tools { margin: 0; padding: 0; border: none; background: none; }
    .turn-tools-summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      opacity: 1;
      padding: 2px 4px 2px 0;
      border-radius: 4px;
    }
    .turn-tools-summary:hover { color: var(--vscode-foreground); }
    .turn-tools-summary .codicon { font-size: 14px; }
    .turn-tools-list { margin: 2px 0 0 6px; padding-left: 10px; border-left: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, var(--vscode-panel-border))); }
    .tool-call-inline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      background: none;
      border: none;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .tool-call-inline .tc-icon { font-size: 14px; width: 14px; }
    .tool-call-inline .tc-icon.completed { color: var(--vscode-charts-green, var(--vscode-testing-iconPassed)); }
    .tool-call-inline .tc-icon.failed { color: var(--vscode-errorForeground); }
    .tool-call-inline .tc-icon.running { color: var(--vscode-descriptionForeground); }
    .tool-call-inline .tc-title { flex: 1; min-width: 0; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-call-inline .tc-title:hover { color: var(--vscode-foreground); }
    .tool-call-inline .tc-toggle {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      font-size: 14px;
    }
    .tool-call-inline .tc-toggle:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .tool-call-inline .tc-output {
      flex-basis: 100%;
      margin: 4px 0 2px 20px;
      padding: 8px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, transparent));
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }

    .thought-block { border: none; background: none; padding: 0; margin: 0; }
    .thought-block summary { font-size: 12px; color: var(--vscode-descriptionForeground); opacity: 1; gap: 4px; }
    .thought-block summary:hover { color: var(--vscode-foreground); }
    .thought-block summary::before { font-family: codicon; content: '\\eab6'; font-size: 14px; }
    .thought-block[open] summary::before { content: '\\eab4'; }
    .thought-block .thought-content {
      margin: 4px 0 0 6px;
      padding-left: 10px;
      border-left: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, var(--vscode-panel-border)));
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      background: none;
    }

    .plan {
      padding: 8px 10px;
      border-radius: 6px;
      background: none;
      border: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, var(--vscode-panel-border)));
      font-size: 12px;
    }
    .subagent-card { border-radius: 6px; border: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, var(--vscode-panel-border))); background: none; }

    .progress-row {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 4px 16px 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    body.processing .progress-row { display: flex; }

    .empty-state { gap: 8px; padding: 24px 20px; }
    .empty-state .icon { font-size: 48px; line-height: 48px; opacity: 0.9; margin-bottom: 8px; }
    .empty-state .title { font-size: 20px; font-weight: 600; }
    .empty-state .subtitle { font-size: 13px; color: var(--vscode-descriptionForeground); max-width: 340px; line-height: 1.5; }
    .empty-state .actions { margin-top: 8px; gap: 8px; }
    .empty-state .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 2px;
      font-size: 13px;
      border: 1px solid var(--vscode-button-border, transparent);
    }
    .empty-state .action-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .empty-state .action-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
    .empty-state .action-btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .empty-state .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .empty-state .action-btn .codicon { font-size: 14px; }
    .empty-state .hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 12px; }

    .input-area {
      height: auto !important;
      margin: 4px 8px 8px;
      padding: 6px 6px 4px;
      gap: 2px;
      border-radius: 6px;
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, var(--vscode-panel-border)));
      background: var(--vscode-input-background);
    }
    .input-area:focus-within { border-color: var(--vscode-focusBorder); }
    .input-editor-wrap textarea {
      border: none;
      outline: none;
      background: transparent;
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: inherit;
      padding: 4px 6px;
      line-height: 20px;
      min-height: 56px;
      max-height: 240px;
      overflow-y: auto;
    }
    .input-editor-wrap textarea:focus { border: none; outline: none; }
    .input-editor-wrap textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .input-toolbar { gap: 2px; min-height: 26px; padding: 0; flex-wrap: nowrap; }
    .composer-icon-button, .send-stop-btn {
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .composer-icon-button:hover, .send-stop-btn:hover,
    .send-stop-btn.send:hover, .send-stop-btn.stop:hover { background: var(--vscode-toolbar-hoverBackground); }
    .send-stop-btn.send, .send-stop-btn.stop { background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
    .send-stop-btn.send:disabled { opacity: 0.4; }
    .picker-row { gap: 2px; flex-wrap: nowrap; min-width: 0; overflow: hidden; }
    .picker-btn {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      height: 24px;
      padding: 0 4px 0 6px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      max-width: 160px;
    }
    .picker-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .picker-btn .picker-icon { display: none; }
    .picker-btn .picker-chevron { font-size: 12px; opacity: 1; }
    .picker-dropdown {
      background: var(--vscode-menu-background, var(--vscode-quickInput-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
      border-radius: 6px;
      box-shadow: 0 2px 8px var(--vscode-widget-shadow);
      padding: 4px;
    }
    .picker-dropdown-item { border-radius: 4px; font-size: 12px; }
    .picker-dropdown-item:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
    .picker-dropdown-item.selected { background: none; font-weight: normal; }
    .picker-dropdown-item .check { font-size: 14px; width: 16px; }
    .attachment-list { gap: 4px; padding: 0 2px 4px; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 22px;
      padding: 0 4px 0 6px;
      border-radius: 4px;
      font-size: 12px;
      background: transparent;
      border: 1px solid var(--vscode-chat-requestBorder, var(--vscode-widget-border, var(--vscode-panel-border)));
    }
    .attachment-chip .codicon { font-size: 14px; }
    .attachment-chip.suggested {
      border-style: dashed;
      color: var(--vscode-descriptionForeground);
      opacity: 0.8;
      cursor: pointer;
      font-family: inherit;
    }
    .attachment-chip.suggested:hover { opacity: 1; color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .attachment-chip-hint { font-style: italic; opacity: 0.8; }
    .attachment-chip.selection { border-color: var(--vscode-focusBorder); }
    .attachment-chip-remove { background: none; border: none; color: inherit; cursor: pointer; font-size: 12px; border-radius: 3px; }
    .attachment-chip-remove:hover { background: var(--vscode-toolbar-hoverBackground); }
    .input-toolbar .status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-right: 4px; white-space: nowrap; }
    .slash-popup {
      background: var(--vscode-quickInput-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 6px;
      box-shadow: 0 2px 8px var(--vscode-widget-shadow);
    }
    .slash-popup-item.active { background: var(--vscode-quickInputList-focusBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-quickInputList-focusForeground, var(--vscode-list-activeSelectionForeground)); }
  </style>
</head>
<body>
  <div class="session-banner" id="sessionBanner">
    <span class="dot"></span>
    <div class="info">
      <div class="agent" id="bannerAgent"></div>
      <div class="cwd" id="bannerCwd"></div>
    </div>
    <span class="status" id="status"></span>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <div class="icon codicon codicon-hubot"></div>
      <div class="title">Ask an agent</div>
      <div class="subtitle">Chat with Claude Code, Codex, Gemini CLI or any ACP agent. It can read and edit your SAP objects through ABAP FS and use the ABAP FS tools.</div>
      <div class="actions">
        <button class="action-btn primary" id="welcomeConnectAgent">
          <span class="codicon codicon-plug"></span> Connect to Agent
        </button>
        <button class="action-btn secondary" id="welcomeAddAgent">
          <span class="codicon codicon-add"></span> Add Agent
        </button>
      </div>
      <div class="hint">AI responses may be inaccurate. Agents are configured in <code>abapfs.acp.agents</code>.</div>
    </div>
  </div>
  <div class="progress-row" id="progressRow">
    <span class="codicon codicon-loading codicon-modifier-spin"></span>
    <span>Working…</span>
  </div>

  <div class="input-area" id="inputArea">
    <div class="slash-popup" id="slashPopup">
      <div class="slash-popup-header">Commands</div>
    </div>
    <div class="input-resize-handle" id="resizeHandle"></div>
    <div class="input-editor-wrap">
      <div class="attachment-list" id="attachmentList"></div>
      <textarea
        id="promptInput"
        placeholder="Ask the agent"
        rows="1"
      ></textarea>
    </div>
    <div class="input-toolbar">
      <button class="composer-icon-button" id="attachButton" type="button" title="Add Context..." aria-label="Add Context...">
        <span class="codicon codicon-attach"></span>
      </button>
      <div class="picker-row" id="configOptionsContainer"></div>
      <div class="picker-wrap hidden" id="modePickerWrap">
        <button class="picker-btn" id="modePickerBtn" title="Set Mode">
          <span class="picker-label" id="modePickerLabel">Mode</span>
          <span class="picker-chevron codicon codicon-chevron-down"></span>
        </button>
        <div class="picker-dropdown" id="modeDropdown"></div>
      </div>
      <div class="picker-wrap hidden" id="modelPickerWrap">
        <button class="picker-btn" id="modelPickerBtn" title="Pick Model">
          <span class="picker-label" id="modelPickerLabel">Model</span>
          <span class="picker-chevron codicon codicon-chevron-down"></span>
        </button>
        <div class="picker-dropdown" id="modelDropdown"></div>
      </div>
      <span class="toolbar-spacer"></span>
      <span class="status" id="toolbarStatus"></span>
      <button class="send-stop-btn send" id="sendStopBtn" title="Send (Enter)" aria-label="Send">
        <span class="codicon codicon-send"></span>
      </button>
    </div>
  </div>

  <!-- Shared hover tooltip for picker dropdown items -->
  <div class="picker-tooltip" id="pickerTooltip" role="tooltip"></div>

  <!-- Overlay shown during session/load history replay -->
  <div class="load-overlay" id="loadOverlay" role="status" aria-live="polite">
    <div class="spinner"></div>
    <div class="label">Loading conversation history…</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');
    const promptInput = document.getElementById('promptInput');
    const sendStopBtn = document.getElementById('sendStopBtn');
    const statusEl = document.getElementById('toolbarStatus');
    const sessionBanner = document.getElementById('sessionBanner');
    const bannerAgent = document.getElementById('bannerAgent');
    const bannerCwd = document.getElementById('bannerCwd');
    const inputArea = document.getElementById('inputArea');
    const resizeHandle = document.getElementById('resizeHandle');
    const slashPopup = document.getElementById('slashPopup');
    const attachmentList = document.getElementById('attachmentList');
    const attachButton = document.getElementById('attachButton');

    // Picker elements
    const modePickerWrap = document.getElementById('modePickerWrap');
    const modePickerBtn = document.getElementById('modePickerBtn');
    const modePickerLabel = document.getElementById('modePickerLabel');
    const modeDropdown = document.getElementById('modeDropdown');
    const modelPickerWrap = document.getElementById('modelPickerWrap');
    const modelPickerBtn = document.getElementById('modelPickerBtn');
    const modelPickerLabel = document.getElementById('modelPickerLabel');
    const modelDropdown = document.getElementById('modelDropdown');
    const configOptionsContainer = document.getElementById('configOptionsContainer');

    let hasActiveSession = false;
    let isProcessing = false;

    // Modes / models state (legacy fallback path)
    let availableModes = [];
    let currentModeId = null;
    let availableModels = [];
    let currentModelId = null;
    let pendingAttachments = [];
    let suggestedFile = null;
    let editorSelection = null;
    const planElements = Object.create(null);
    const compactionElements = Object.create(null);
    const subagentElements = Object.create(null);
    let latestUsage = null;

    // ACP Session Config Options state (preferred path)
    let configOptions = [];        // SessionConfigOption[]
    let useConfigOptions = false;  // true when the agent provided configOptions

    // Thinking state
    let currentThoughtEl = null;
    let currentThoughtTextEl = null;
    let currentThoughtText = '';
    let thoughtStartTime = null;
    let thoughtEndTime = null;

    // Slash commands state
    let availableCommands = [];
    let slashPopupSelectedIdx = -1;
    let slashFilteredCommands = [];
    let savedPlaceholder = 'Ask the agent';
    let currentAgentName = '';

    function updatePlaceholder() {
      const base = 'Ask ' + (currentAgentName || 'the agent');
      savedPlaceholder = availableCommands.length > 0 ? base + ', / for commands' : base;
      if (!promptInput.value.startsWith('/')) {
        promptInput.placeholder = savedPlaceholder;
      }
    }

    // --- State persistence ---
    let chatHistory = [];
    let sessionState = null;

    function saveState() {
      vscode.setState({ chatHistory, sessionState, hasActiveSession });
    }

    function restoreState() {
      const saved = vscode.getState();
      if (!saved) return;

      chatHistory = saved.chatHistory || [];
      sessionState = saved.sessionState || null;
      hasActiveSession = saved.hasActiveSession || false;

      if (hasActiveSession && sessionState) {
        showSessionConnectedFromState(sessionState);
      }

      const assistantItems = [];
      for (let i = 0; i < chatHistory.length; i++) {
        const item = chatHistory[i];
        switch (item.kind) {
          case 'message':
            addMessageDOM(item.role, item.text);
            if (item.role === 'assistant') {
              assistantItems.push({ index: i, text: item.text });
            }
            break;
          case 'media':
            addMediaDOM(item);
            break;
          case 'thought':
            addThoughtDOM(item.text, item.durationSec || 0);
            break;
          case 'toolCall':
            addToolCallDOM(item.toolCallId, item.title, item.status, item.content);
            break;
          case 'plan':
            addPlanDOM(item.plan, item.planId);
            break;
        }
      }

      // Request markdown rendering for all restored assistant messages
      if (assistantItems.length > 0) {
        vscode.postMessage({ type: 'renderMarkdown', items: assistantItems });
      }
    }

    // Start with input disabled
    if (inputArea) inputArea.classList.add('disabled');
    let currentAssistantEl = null;
    let currentAssistantText = '';
    let currentTurnEl = null;       // .turn container for current response
    let currentToolsListEl = null;  // .turn-tools-list inside current turn
    let currentToolsCountEl = null; // .turn-tools-summary counter
    let currentToolCount = 0;
    let toolCalls = {};

    // --- Resize handle ---
    let inputAreaHeight = 140;
    const MIN_INPUT_HEIGHT = 90;
    const MAX_INPUT_HEIGHT = 400;

    function applyInputHeight(h) {
      inputAreaHeight = Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, h));
      inputArea.style.height = inputAreaHeight + 'px';
    }

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = inputArea.offsetHeight;
      function onMove(ev) {
        const delta = startY - ev.clientY;
        applyInputHeight(startHeight + delta);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // --- Auto-resize textarea (within the input area constraints) ---
    function autoGrowInput() {
      promptInput.style.height = 'auto';
      promptInput.style.height = promptInput.scrollHeight + 'px';
    }
    promptInput.addEventListener('input', autoGrowInput);

    promptInput.addEventListener('input', () => {
      // Slash command autocomplete
      const text = promptInput.value;
      if (text.startsWith('/') && availableCommands.length > 0) {
        const firstSpace = text.indexOf(' ');
        const query = (firstSpace > 0 ? text.slice(1, firstSpace) : text.slice(1)).toLowerCase();
        if (firstSpace < 0) {
          // Still typing command name — show filtered popup
          slashFilteredCommands = availableCommands.filter(c =>
            c.name.toLowerCase().startsWith(query)
          );
          if (slashFilteredCommands.length > 0) {
            renderSlashPopup(slashFilteredCommands);
            slashPopup.classList.add('open');
            slashPopupSelectedIdx = 0;
            highlightSlashItem(0);
          } else {
            slashPopup.classList.remove('open');
          }
        } else {
          slashPopup.classList.remove('open');
        }
      } else {
        slashPopup.classList.remove('open');
        if (!text.startsWith('/')) {
          promptInput.placeholder = savedPlaceholder;
        }
      }
    });

    // Send on Enter (Shift+Enter for newline)
    promptInput.addEventListener('keydown', (e) => {
      // Slash popup navigation
      if (slashPopup.classList.contains('open')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          slashPopupSelectedIdx = Math.min(slashPopupSelectedIdx + 1, slashFilteredCommands.length - 1);
          highlightSlashItem(slashPopupSelectedIdx);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          slashPopupSelectedIdx = Math.max(slashPopupSelectedIdx - 1, 0);
          highlightSlashItem(slashPopupSelectedIdx);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          selectSlashCommand(slashFilteredCommands[slashPopupSelectedIdx]);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          selectSlashCommand(slashFilteredCommands[slashPopupSelectedIdx]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          slashPopup.classList.remove('open');
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isProcessing) {
          handleCancel();
        } else {
          handleSend();
        }
      }
    });

    function handleSend() {
      const text = promptInput.value.trim();
      if ((!text && pendingAttachments.length === 0 && !editorSelection) || isProcessing) return;

      const displayText = [
        text,
        ...(editorSelection ? ['[Selection: ' + editorSelection.name + ']'] : []),
        ...pendingAttachments.map(item => '[Attached: ' + item.name + ']'),
      ]
        .filter(Boolean)
        .join('\\n');
      addMessage('user', displayText);
      promptInput.value = '';
      autoGrowInput();
      vscode.postMessage({
        type: 'sendPrompt',
        text,
        attachmentIds: pendingAttachments.map(item => item.id),
      });
    }

    function renderSuggestedFile() {
      if (!suggestedFile) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'attachment-chip suggested';
      chip.title = 'Current file: click to add it to the chat';
      const fileIcon = document.createElement('span');
      fileIcon.className = 'codicon codicon-file';
      const name = document.createElement('span');
      name.className = 'attachment-chip-name';
      name.textContent = suggestedFile.name;
      const hint = document.createElement('span');
      hint.className = 'attachment-chip-hint';
      hint.textContent = 'Current file';
      const add = document.createElement('span');
      add.className = 'codicon codicon-add';
      chip.append(fileIcon, name, hint, add);
      chip.addEventListener('click', () => vscode.postMessage({ type: 'attachCurrentFile' }));
      attachmentList.appendChild(chip);
    }

    function renderEditorSelection() {
      if (!editorSelection) return;
      const chip = document.createElement('span');
      chip.className = 'attachment-chip selection';
      chip.title = 'The current editor selection is sent with your prompt';
      const fileIcon = document.createElement('span');
      fileIcon.className = 'codicon codicon-file';
      const name = document.createElement('span');
      name.className = 'attachment-chip-name';
      name.textContent = editorSelection.name;
      const remove = document.createElement('button');
      remove.className = 'attachment-chip-remove codicon codicon-close';
      remove.type = 'button';
      remove.title = 'Do not send this selection';
      remove.setAttribute('aria-label', 'Remove selection ' + editorSelection.name);
      remove.addEventListener('click', () => vscode.postMessage({ type: 'dismissSelection' }));
      chip.append(fileIcon, name, remove);
      attachmentList.appendChild(chip);
    }

    function renderAttachments() {
      attachmentList.replaceChildren();
      renderEditorSelection();
      renderSuggestedFile();
      for (const attachment of pendingAttachments) {
        const chip = document.createElement('span');
        chip.className = 'attachment-chip';
        chip.title = attachment.name;
        const fileIcon = document.createElement('span');
        fileIcon.className = 'codicon codicon-file';
        const name = document.createElement('span');
        name.className = 'attachment-chip-name';
        name.textContent = attachment.name;
        chip.appendChild(fileIcon);
        const remove = document.createElement('button');
        remove.className = 'attachment-chip-remove codicon codicon-close';
        remove.type = 'button';
        remove.title = 'Remove attachment';
        remove.setAttribute('aria-label', 'Remove ' + attachment.name);
        remove.addEventListener('click', () => {
          vscode.postMessage({ type: 'removeAttachment', id: attachment.id });
        });
        chip.append(name, remove);
        attachmentList.appendChild(chip);
      }
    }

    function handleCancel() {
      vscode.postMessage({ type: 'cancelTurn' });
    }

    function execCmd(command) {
      vscode.postMessage({ type: 'executeCommand', command });
    }

    // Wire up buttons
    sendStopBtn.addEventListener('click', () => {
      if (isProcessing) {
        handleCancel();
      } else {
        handleSend();
      }
    });

    const welcomeConnectAgent = document.getElementById('welcomeConnectAgent');
    if (welcomeConnectAgent) welcomeConnectAgent.addEventListener('click', () => execCmd('abapfs.acp.connectAgent'));
    const welcomeAddAgent = document.getElementById('welcomeAddAgent');
    if (welcomeAddAgent) welcomeAddAgent.addEventListener('click', () => execCmd('abapfs.acp.addAgent'));
    if (attachButton) attachButton.addEventListener('click', () => execCmd('abapfs.acp.attachFile'));

    // --- Send/Stop toggle ---
    function setProcessing(processing) {
      isProcessing = processing;
      if (processing) {
        sendStopBtn.className = 'send-stop-btn stop';
        sendStopBtn.innerHTML = '<span class="codicon codicon-debug-stop"></span>';
        sendStopBtn.title = 'Cancel (Escape)';
        sendStopBtn.setAttribute('aria-label', 'Cancel');
        sendStopBtn.disabled = false;
        promptInput.disabled = true;
        document.body.classList.add('processing');
        statusEl.textContent = '';
      } else {
        sendStopBtn.className = 'send-stop-btn send';
        sendStopBtn.innerHTML = '<span class="codicon codicon-send"></span>';
        sendStopBtn.title = 'Send (Enter)';
        sendStopBtn.setAttribute('aria-label', 'Send');
        document.body.classList.remove('processing');
        sendStopBtn.disabled = false;
        promptInput.disabled = false;
        renderUsage();
        if (!latestUsage) statusEl.textContent = '';
      }
    }

    // --- Session/load overlay ---
    const loadOverlay = document.getElementById('loadOverlay');
    // True while a session/load replay is in progress. Used to suppress
    // per-chunk markdown rendering until the replay finishes.
    let isLoadingSession = false;

    function handleLoadSessionStart() {
      isLoadingSession = true;
      // Reset all chat state; behaves like clearChat but keeps the session
      // banner / input area structure intact.
      chatHistory = [];
      saveState();
      currentAssistantEl = null;
      currentAssistantText = '';
      toolCalls = {};
      currentTurnEl = null;
      currentToolsListEl = null;
      currentToolsCountEl = null;
      currentToolCount = 0;
      currentThoughtEl = null;
      currentThoughtTextEl = null;
      currentThoughtText = '';
      thoughtStartTime = null;
      thoughtEndTime = null;
      messagesEl.innerHTML = '';
      if (emptyState) {
        messagesEl.appendChild(emptyState);
        emptyState.style.display = 'none';
      }
      if (loadOverlay) loadOverlay.classList.add('visible');
      if (inputArea) inputArea.classList.add('disabled');
      setProcessing(false);
    }

    function handleLoadSessionEnd(ok) {
      isLoadingSession = false;
      // Commit any trailing assistant turn captured during the replay.
      finalizeCurrentAssistantTurn();
      if (loadOverlay) loadOverlay.classList.remove('visible');
      if (inputArea) inputArea.classList.remove('disabled');
      // Batch-render markdown for every assistant message captured during
      // the replay (avoids per-chunk render storms).
      const items = [];
      for (let i = 0; i < chatHistory.length; i++) {
        const item = chatHistory[i];
        if (item.kind === 'message' && item.role === 'assistant') {
          items.push({ index: i, text: item.text });
        }
      }
      if (items.length > 0) {
        vscode.postMessage({ type: 'renderMarkdown', items });
      }
      scrollToBottom();
      if (!ok) {
        addMessage('error', 'Failed to load session history.');
      }
    }

    function handleSessionInfoUpdate(title) {
      if (!sessionState) return;
      if (typeof title === 'string') {
        sessionState.title = title;
      } else if (title === null) {
        delete sessionState.title;
      }
      saveState();
      if (bannerAgent) {
        bannerAgent.textContent = sessionState.title || sessionState.agentName || 'Agent';
      }
    }

    // --- Mode / Model pickers ---

    // --- Slash command helpers ---
    function renderSlashPopup(commands) {
      slashPopup.innerHTML = '<div class="slash-popup-header">Commands</div>';
      commands.forEach((cmd, i) => {
        const item = document.createElement('div');
        item.className = 'slash-popup-item' + (i === 0 ? ' active' : '');
        item.dataset.index = String(i);
        item.innerHTML =
          '<span class="cmd-name">/' + escapeHtml(cmd.name) + '</span>' +
          '<span class="cmd-desc">' + escapeHtml(cmd.description) + '</span>';
        item.addEventListener('click', () => selectSlashCommand(cmd));
        item.addEventListener('mouseenter', () => {
          slashPopupSelectedIdx = i;
          highlightSlashItem(i);
        });
        slashPopup.appendChild(item);
      });
    }

    function highlightSlashItem(idx) {
      const items = slashPopup.querySelectorAll('.slash-popup-item');
      items.forEach((el, i) => el.classList.toggle('active', i === idx));
      if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    }

    function selectSlashCommand(cmd) {
      slashPopup.classList.remove('open');
      if (!cmd) return;

      if (cmd.input) {
        // Command expects input — insert "/name " and set placeholder to hint
        promptInput.value = '/' + cmd.name + ' ';
        promptInput.placeholder = cmd.input.hint || 'Type input...';
        promptInput.focus();
      } else {
        // No input required — send immediately
        promptInput.value = '/' + cmd.name;
        handleSend();
      }
    }

    // --- Mode / Model pickers (cont.) ---
    function updateModePicker(modes) {
      if (!modes || !modes.availableModes || modes.availableModes.length === 0) {
        modePickerWrap.classList.add('hidden');
        availableModes = [];
        currentModeId = null;
        return;
      }
      availableModes = modes.availableModes;
      currentModeId = modes.currentModeId || null;
      modePickerWrap.classList.remove('hidden');
      const current = availableModes.find(m => m.id === currentModeId);
      modePickerLabel.textContent = current ? current.name : 'Mode';
      modePickerLabel.title = current && current.description ? current.description : '';
      renderModeDropdown();
    }

    function renderModeDropdown() {
      modeDropdown.innerHTML = '';
      for (const mode of availableModes) {
        const item = document.createElement('div');
        item.className = 'picker-dropdown-item' + (mode.id === currentModeId ? ' selected' : '');
        item.dataset.desc = mode.description || '';
        if (mode.description) item.title = mode.description;
        item.innerHTML =
          '<span class="check codicon' + (mode.id === currentModeId ? ' codicon-check' : '') + '"></span>' +
          '<span class="item-label">' + escapeHtml(mode.name) + '</span>';
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          closePickers();
          if (mode.id !== currentModeId) {
            currentModeId = mode.id;
            const current = availableModes.find(m => m.id === currentModeId);
            modePickerLabel.textContent = current ? current.name : 'Mode';
            renderModeDropdown();
            vscode.postMessage({ type: 'setMode', modeId: mode.id });
          }
        });
        modeDropdown.appendChild(item);
      }
    }

    function updateModelPicker(models) {
      if (!models || !models.availableModels || models.availableModels.length === 0) {
        modelPickerWrap.classList.add('hidden');
        availableModels = [];
        currentModelId = null;
        return;
      }
      availableModels = models.availableModels;
      currentModelId = models.currentModelId || null;
      modelPickerWrap.classList.remove('hidden');
      const current = availableModels.find(m => m.modelId === currentModelId);
      modelPickerLabel.textContent = current ? current.name : 'Model';
      modelPickerLabel.title = current && current.description ? current.description : '';
      renderModelDropdown();
    }

    function renderModelDropdown() {
      modelDropdown.innerHTML = '';
      for (const model of availableModels) {
        const item = document.createElement('div');
        item.className = 'picker-dropdown-item' + (model.modelId === currentModelId ? ' selected' : '');
        item.dataset.desc = model.description || '';
        if (model.description) item.title = model.description;
        item.innerHTML =
          '<span class="check codicon' + (model.modelId === currentModelId ? ' codicon-check' : '') + '"></span>' +
          '<span class="item-label">' + escapeHtml(model.name) + '</span>';
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          closePickers();
          if (model.modelId !== currentModelId) {
            currentModelId = model.modelId;
            const current = availableModels.find(m => m.modelId === currentModelId);
            modelPickerLabel.textContent = current ? current.name : 'Model';
            renderModelDropdown();
            vscode.postMessage({ type: 'setModel', modelId: model.modelId });
          }
        });
        modelDropdown.appendChild(item);
      }
    }

    // --- ACP Session Config Options ---

    function iconForCategory(cat) {
      switch (cat) {
        case 'mode': return 'codicon-hubot';
        case 'model': return 'codicon-sparkle';
        case 'thought_level': return 'codicon-lightbulb';
        default: return 'codicon-settings-gear';
      }
    }

    function isGroupedOptions(opt) {
      const arr = opt && opt.options;
      if (!Array.isArray(arr) || arr.length === 0) return false;
      const first = arr[0];
      return !!(first && typeof first.group === 'string' && Array.isArray(first.options));
    }

    function findOptionValue(opt, value) {
      if (!opt || !Array.isArray(opt.options)) return null;
      if (isGroupedOptions(opt)) {
        for (const group of opt.options) {
          if (!group || !Array.isArray(group.options)) continue;
          const hit = group.options.find(v => v && v.value === value);
          if (hit) return hit;
        }
        return null;
      }
      return opt.options.find(v => v && v.value === value) || null;
    }

    function pickerLabelFor(opt) {
      const v = findOptionValue(opt, opt.currentValue);
      return v && v.name ? v.name : (opt.name || 'Option');
    }

    function pickerTooltipFor(opt) {
      const v = findOptionValue(opt, opt.currentValue);
      return (v && v.description) || opt.description || opt.name || '';
    }

    function renderConfigPickers(opts) {
      configOptionsContainer.innerHTML = '';
      if (!Array.isArray(opts)) return;

      for (const opt of opts) {
        if (!opt || !opt.id) continue;

        if (opt.type === 'boolean') {
          const wrap = document.createElement('div');
          wrap.className = 'picker-wrap';
          const label = document.createElement('label');
          label.className = 'config-boolean-label';
          label.title = opt.description || opt.name || '';
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = !!opt.currentValue;
          toggle.dataset.configId = opt.id;
          label.append(toggle, document.createTextNode(opt.name || 'Option'));
          wrap.appendChild(label);
          configOptionsContainer.appendChild(wrap);
          continue;
        }

        // Ignore unknown types and select options without values.
        if (opt.type !== 'select') continue;
        if (!Array.isArray(opt.options) || opt.options.length === 0) continue;

        const wrap = document.createElement('div');
        wrap.className = 'picker-wrap';
        wrap.dataset.configId = opt.id;

        const btn = document.createElement('button');
        btn.className = 'picker-btn';
        btn.title = pickerTooltipFor(opt);
        btn.innerHTML =
          '<span class="picker-icon codicon ' + iconForCategory(opt.category) + '"></span>' +
          '<span class="picker-label"></span>' +
          '<span class="picker-chevron codicon codicon-chevron-down"></span>';
        btn.querySelector('.picker-label').textContent = pickerLabelFor(opt);
        wrap.appendChild(btn);

        const dropdown = document.createElement('div');
        dropdown.className = 'picker-dropdown';
        renderConfigDropdown(dropdown, opt);
        wrap.appendChild(dropdown);

        configOptionsContainer.appendChild(wrap);
      }
    }

    function renderConfigDropdown(dropdown, opt) {
      dropdown.innerHTML = '';
      if (isGroupedOptions(opt)) {
        for (const group of opt.options) {
          if (!group || !Array.isArray(group.options)) continue;
          const header = document.createElement('div');
          header.className = 'picker-dropdown-group-header';
          header.textContent = group.name || group.group || '';
          dropdown.appendChild(header);
          for (const v of group.options) {
            dropdown.appendChild(buildConfigItem(opt, v));
          }
        }
      } else {
        for (const v of opt.options) {
          dropdown.appendChild(buildConfigItem(opt, v));
        }
      }
    }

    function buildConfigItem(opt, v) {
      const selected = v.value === opt.currentValue;
      const item = document.createElement('div');
      item.className = 'picker-dropdown-item' + (selected ? ' selected' : '');
      item.dataset.value = v.value;
      item.dataset.desc = v.description || '';
      if (v.description) item.title = v.description;
      item.innerHTML =
        '<span class="check codicon' + (selected ? ' codicon-check' : '') + '"></span>' +
        '<span class="item-label"></span>';
      item.querySelector('.item-label').textContent = v.name || v.value;
      return item;
    }

    configOptionsContainer.addEventListener('change', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
      const configId = target.dataset.configId;
      if (!configId) return;
      const opt = configOptions.find(option => option && option.id === configId);
      if (!opt || opt.type !== 'boolean') return;
      opt.currentValue = target.checked;
      vscode.postMessage({ type: 'setConfigOption', configId, value: target.checked });
    });

    // Event delegation: handle clicks on dynamically-rendered config pickers
    configOptionsContainer.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const item = target.closest('.picker-dropdown-item');
      if (item) {
        e.stopPropagation();
        const wrap = item.closest('.picker-wrap');
        const dropdown = item.closest('.picker-dropdown');
        if (!wrap || !dropdown) return;
        const configId = wrap.dataset.configId;
        const value = item.dataset.value;
        if (!configId || value == null) return;

        // Find option in current state
        const opt = configOptions.find(o => o && o.id === configId);
        if (!opt || value === opt.currentValue) {
          dropdown.classList.remove('open');
          return;
        }

        // Optimistic update — agent's response will replace with authoritative state
        opt.currentValue = value;
        const labelEl = wrap.querySelector('.picker-btn .picker-label');
        const btn = wrap.querySelector('.picker-btn');
        if (labelEl) labelEl.textContent = pickerLabelFor(opt);
        if (btn) btn.title = pickerTooltipFor(opt);
        renderConfigDropdown(dropdown, opt);

        dropdown.classList.remove('open');
        vscode.postMessage({ type: 'setConfigOption', configId, value });
        return;
      }

      const btn = target.closest('.picker-btn');
      if (btn) {
        e.stopPropagation();
        const wrap = btn.closest('.picker-wrap');
        if (!wrap) return;
        const dropdown = wrap.querySelector('.picker-dropdown');
        if (!dropdown) return;
        const wasOpen = dropdown.classList.contains('open');
        closePickers();
        if (!wasOpen) dropdown.classList.add('open');
      }
    });

    function setConfigOptionsState(opts) {
      configOptions = Array.isArray(opts) ? opts : [];
      useConfigOptions = configOptions.length > 0;

      if (useConfigOptions) {
        // Hide legacy pickers — spec requires configOptions to be used exclusively
        modePickerWrap.classList.add('hidden');
        modelPickerWrap.classList.add('hidden');
        renderConfigPickers(configOptions);
      } else {
        configOptionsContainer.innerHTML = '';
      }
    }

    // Toggle picker dropdowns
    modePickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = modeDropdown.classList.contains('open');
      closePickers();
      if (!wasOpen) modeDropdown.classList.add('open');
    });

    modelPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = modelDropdown.classList.contains('open');
      closePickers();
      if (!wasOpen) modelDropdown.classList.add('open');
    });

    function closePickers() {
      modeDropdown.classList.remove('open');
      modelDropdown.classList.remove('open');
      // Close any dynamic config-option dropdowns
      const open = configOptionsContainer.querySelectorAll('.picker-dropdown.open');
      open.forEach(el => el.classList.remove('open'));
      hidePickerTooltip();
    }

    // --- Picker hover tooltip (shared by all picker dropdowns) ---
    const pickerTooltip = document.getElementById('pickerTooltip');

    function hidePickerTooltip() {
      if (pickerTooltip) pickerTooltip.classList.remove('visible');
    }

    function showPickerTooltip(itemEl) {
      if (!pickerTooltip || !itemEl) return;
      const desc = itemEl.dataset && itemEl.dataset.desc;
      if (!desc) { hidePickerTooltip(); return; }

      pickerTooltip.textContent = desc;
      // Make it measurable while invisible to the user.
      pickerTooltip.style.left = '-9999px';
      pickerTooltip.style.top = '-9999px';
      pickerTooltip.classList.add('visible');

      const dropdown = itemEl.closest('.picker-dropdown');
      if (!dropdown) { hidePickerTooltip(); return; }
      const dropRect = dropdown.getBoundingClientRect();
      const itemRect = itemEl.getBoundingClientRect();
      const tipRect = pickerTooltip.getBoundingClientRect();
      const gap = 6;

      // Prefer left side; flip to right if not enough room.
      let left = dropRect.left - tipRect.width - gap;
      if (left < 4) left = dropRect.right + gap;
      // Clamp horizontally inside the viewport.
      const maxLeft = window.innerWidth - tipRect.width - 4;
      if (left > maxLeft) left = Math.max(4, maxLeft);

      // Vertically align with the hovered item, clamped inside the viewport.
      let top = itemRect.top;
      const maxTop = window.innerHeight - tipRect.height - 4;
      if (top > maxTop) top = Math.max(4, maxTop);

      pickerTooltip.style.left = left + 'px';
      pickerTooltip.style.top = top + 'px';
    }

    // Delegated hover handling — one listener handles every picker dropdown.
    document.addEventListener('mouseover', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const item = target.closest('.picker-dropdown-item');
      if (!item) return;
      // Only consider items inside an open dropdown.
      const dropdown = item.closest('.picker-dropdown');
      if (!dropdown || !dropdown.classList.contains('open')) return;
      showPickerTooltip(item);
    });

    document.addEventListener('mouseout', (e) => {
      const target = e.target;
      const related = e.relatedTarget;
      if (!(target instanceof Element)) return;
      const item = target.closest('.picker-dropdown-item');
      if (!item) return;
      // Stay visible if the mouse moved to another item inside the same dropdown.
      if (related instanceof Element) {
        const nextItem = related.closest('.picker-dropdown-item');
        if (nextItem && nextItem !== item) return;
      }
      hidePickerTooltip();
    });

    // Hide the tooltip when the user scrolls a dropdown so it doesn't drift.
    function attachScrollHide(dropdownEl) {
      if (!dropdownEl || dropdownEl._tooltipScrollAttached) return;
      dropdownEl._tooltipScrollAttached = true;
      dropdownEl.addEventListener('scroll', hidePickerTooltip);
    }
    attachScrollHide(modeDropdown);
    attachScrollHide(modelDropdown);
    // Dynamic configOption dropdowns: rely on the same handler via event-delegation
    // (they exist inside #configOptionsContainer); attach once per dropdown when created.
    if (configOptionsContainer) {
      const mo = new MutationObserver(() => {
        configOptionsContainer.querySelectorAll('.picker-dropdown').forEach(attachScrollHide);
      });
      mo.observe(configOptionsContainer, { childList: true, subtree: true });
    }

    // Close pickers when clicking outside
    document.addEventListener('click', () => closePickers());

    // --- Messages ---
    function addMessage(role, text) {
      chatHistory.push({ kind: 'message', role, text });
      saveState();
      return addMessageDOM(role, text);
    }

    function addMessageDOM(role, text) {
      hideEmpty();
      const el = document.createElement('div');
      el.className = 'message ' + role;
      el.textContent = text;
      messagesEl.appendChild(el);
      scrollToBottom();
      return el;
    }

    function addContentBlock(role, block) {
      if (!block) return;
      if (block.type === 'text') {
        if (typeof block.text === 'string' && block.text) addMessage(role, block.text);
        return;
      }
      if (block.type === 'resource' && block.resource) {
        if (typeof block.resource.text === 'string') {
          addMessage(role, block.resource.text);
        } else {
          addMessage(role, '[Embedded binary resource: ' + (block.resource.uri || 'unknown') + ']');
        }
        return;
      }
      if (block.type === 'resource_link') {
        addMessage(role, '[Referenced resource: ' + (block.name || block.uri || 'unknown') + ']');
        return;
      }
      if (block.type !== 'image' && block.type !== 'audio') return;

      const mimeType = typeof block.mimeType === 'string' ? block.mimeType : '';
      const data = typeof block.data === 'string' ? block.data : '';
      const validMime = block.type === 'image'
        ? /^image\\/[a-z0-9.+-]+$/i.test(mimeType)
        : /^audio\\/[a-z0-9.+-]+$/i.test(mimeType);
      if (!data || !validMime || data.length > 7 * 1024 * 1024) {
        addMessage(role, '[' + (block.type === 'image' ? 'Image' : 'Audio') + ' attachment: ' + (mimeType || 'unsupported format') + ']');
        return;
      }

      const item = { kind: 'media', role, mediaType: block.type, mimeType, data };
      chatHistory.push(item);
      saveState();
      addMediaDOM(item);
    }

    function addMediaDOM(item) {
      hideEmpty();
      const el = document.createElement('div');
      el.className = 'message media ' + item.role;
      if (item.mediaType === 'image') {
        const image = document.createElement('img');
        image.alt = 'Agent-provided image';
        image.src = 'data:' + item.mimeType + ';base64,' + item.data;
        el.appendChild(image);
      } else if (item.mediaType === 'audio') {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = 'data:' + item.mimeType + ';base64,' + item.data;
        el.appendChild(audio);
      }
      messagesEl.appendChild(el);
      scrollToBottom();
    }

    function hideEmpty() {
      if (emptyState) emptyState.style.display = 'none';
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function getStatusIcon(status) {
      switch (status) {
        case 'running': return 'codicon-loading codicon-modifier-spin';
        case 'in_progress': return 'codicon-loading codicon-modifier-spin';
        case 'completed': return 'codicon-check';
        case 'failed': return 'codicon-error';
        default: return 'codicon-circle-outline';
      }
    }

    function setStatusIcon(iconEl, status) {
      iconEl.className = 'tc-icon codicon ' + getStatusIcon(status) + ' ' + status;
      iconEl.textContent = '';
    }

    function setToolsSummary(summary, count, collapsed) {
      summary.innerHTML = '<span class="codicon ' + (collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down') + '"></span>';
      summary.appendChild(document.createTextNode('Used ' + count + ' tool' + (count !== 1 ? 's' : '')));
    }

    function normalizeToolStatus(status) {
      return status === 'in_progress' ? 'running' : status;
    }

    // Ensure the current turn has a tools container
    function ensureTurnTools() {
      if (!currentTurnEl) {
        // Create turn container if none (e.g., tool call before first text)
        currentTurnEl = document.createElement('div');
        currentTurnEl.className = 'turn';
        messagesEl.appendChild(currentTurnEl);
      }
      if (!currentToolsListEl) {
        const toolsWrap = document.createElement('div');
        toolsWrap.className = 'turn-tools';

        currentToolCount = 0;
        const summary = document.createElement('div');
        summary.className = 'turn-tools-summary';
        setToolsSummary(summary, 0, true);
        currentToolsCountEl = summary;
        summary.addEventListener('click', () => {
          const list = summary.nextElementSibling;
          if (list) {
            const count = parseInt(summary.dataset.count || '0', 10);
            const collapsed = list.classList.toggle('collapsed');
            setToolsSummary(summary, count, collapsed);
          }
        });
        toolsWrap.appendChild(summary);

        const list = document.createElement('div');
        list.className = 'turn-tools-list';
        toolsWrap.appendChild(list);
        currentToolsListEl = list;

        currentTurnEl.appendChild(toolsWrap);
      }
    }

    function addToolCall(toolCallId, title, status, content, rawInput, rawOutput) {
      status = normalizeToolStatus(status);
      chatHistory.push({ kind: 'toolCall', toolCallId, title, status, content, rawInput, rawOutput });
      saveState();
      addToolCallInline(toolCallId, title, status, content, rawInput, rawOutput);
    }

    function addToolCallInline(toolCallId, title, status, content, rawInput, rawOutput) {
      hideEmpty();
      ensureTurnTools();
      currentToolCount++;
      if (currentToolsCountEl) {
        currentToolsCountEl.dataset.count = String(currentToolCount);
        setToolsSummary(currentToolsCountEl, currentToolCount, false);
      }

      const el = document.createElement('div');
      el.className = 'tool-call-inline';
      el.id = 'tc-' + toolCallId;
      const icon = document.createElement('span');
      setStatusIcon(icon, status);
      const titleElement = document.createElement('span');
      titleElement.className = 'tc-title';
      titleElement.textContent = title || 'Tool Call';
      const toggle = document.createElement('button');
      toggle.className = 'tc-toggle codicon codicon-chevron-right';
      toggle.type = 'button';
      toggle.title = 'Show details';
      toggle.setAttribute('aria-expanded', 'false');
      const output = document.createElement('pre');
      output.className = 'tc-output';
      output.hidden = true;
      const toggleOutput = (event) => {
        event.stopPropagation();
        output.hidden = !output.hidden;
        toggle.setAttribute('aria-expanded', String(!output.hidden));
        toggle.className = 'tc-toggle codicon ' + (output.hidden ? 'codicon-chevron-right' : 'codicon-chevron-down');
      };
      toggle.addEventListener('click', toggleOutput);
      titleElement.addEventListener('click', toggleOutput);
      el.append(icon, titleElement, toggle, output);
      renderToolContent(el, content, rawInput, rawOutput);
      currentToolsListEl.appendChild(el);
      toolCalls[toolCallId] = el;
      scrollToBottom();
    }

    // Fallback DOM builder for history restore (standalone card)
    function addToolCallDOM(toolCallId, title, status, content) {
      const historyItem = chatHistory.find(item => item.kind === 'toolCall' && item.toolCallId === toolCallId);
      addToolCallInline(toolCallId, title, status, content, historyItem && historyItem.rawInput, historyItem && historyItem.rawOutput);
    }

    function updateToolCall(toolCallId, status, title, content, rawInput, rawOutput) {
      status = normalizeToolStatus(status);
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].kind === 'toolCall' && chatHistory[i].toolCallId === toolCallId) {
          chatHistory[i].status = status;
          if (title) chatHistory[i].title = title;
          if (content !== undefined) chatHistory[i].content = content;
          if (rawInput !== undefined) chatHistory[i].rawInput = rawInput;
          if (rawOutput !== undefined) chatHistory[i].rawOutput = rawOutput;
          break;
        }
      }
      saveState();

      const el = toolCalls[toolCallId] || document.getElementById('tc-' + toolCallId);
      if (!el) return;

      // Inline style (turn-based)
      const iconEl = el.querySelector('.tc-icon');
      if (iconEl) {
        setStatusIcon(iconEl, status);
        if (title) {
          const titleEl = el.querySelector('.tc-title');
          if (titleEl) titleEl.textContent = title;
        }
      }
      // Legacy card style fallback
      const badge = el.querySelector('.status-badge');
      if (badge) {
        badge.className = 'status-badge ' + status;
        badge.textContent = status;
      }
      if (title) {
        const titleEl = el.querySelector('.title');
        if (titleEl) titleEl.textContent = title;
      }
      if (content !== undefined || rawInput !== undefined || rawOutput !== undefined) {
        const historyItem = chatHistory.find(item => item.kind === 'toolCall' && item.toolCallId === toolCallId);
        renderToolContent(
          el,
          content !== undefined ? content : historyItem && historyItem.content,
          rawInput !== undefined ? rawInput : historyItem && historyItem.rawInput,
          rawOutput !== undefined ? rawOutput : historyItem && historyItem.rawOutput,
        );
      }
    }

    function formatToolValue(value) {
      let rendered;
      try {
        rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      } catch {
        rendered = String(value);
      }
      return String(rendered === undefined ? value : rendered).slice(0, 12000);
    }

    function renderToolContent(el, content, rawInput, rawOutput) {
      const output = el.querySelector('.tc-output');
      const toggle = el.querySelector('.tc-toggle');
      if (!output || !toggle) return;

      const outputParts = [];
      for (const item of Array.isArray(content) ? content : []) {
        if (item && item.type === 'diff') {
          outputParts.push('File: ' + (item.path || 'unknown') + '\\n--- before\\n'
            + (item.oldText || '') + '\\n+++ after\\n' + (item.newText || ''));
        } else if (item && item.type === 'terminal') {
          outputParts.push('Terminal: ' + (item.terminalId || 'unknown'));
        } else if (item && item.type === 'content') {
          const block = item.content;
          if (block && block.type === 'text' && block.text) outputParts.push(block.text);
          else if (block && block.type === 'resource' && block.resource && block.resource.text) {
            outputParts.push(block.resource.text);
          } else if (block && block.type === 'resource_link') {
            outputParts.push((block.name || 'Resource') + ': ' + (block.uri || ''));
          } else if (block && block.type === 'image') {
            outputParts.push('[Image: ' + (block.mimeType || 'image') + ']');
          }
        }
      }

      if (rawOutput !== undefined) outputParts.push(formatToolValue(rawOutput));
      const sections = [];
      if (rawInput !== undefined) sections.push('INPUT\\n' + formatToolValue(rawInput));
      if (outputParts.length) sections.push('OUTPUT\\n' + outputParts.join('\\n\\n'));
      const rendered = sections.join('\\n\\n').slice(0, 24000);
      output.textContent = rendered;
      toggle.hidden = !rendered;
      output.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    function addPlan(plan, planId) {
      const existingIndex = planId
        ? chatHistory.findIndex(item => item.kind === 'plan' && item.planId === planId)
        : -1;
      if (existingIndex >= 0) {
        chatHistory[existingIndex].plan = plan;
      } else {
        chatHistory.push({ kind: 'plan', plan: plan, planId: planId || null });
      }
      saveState();
      addPlanDOM(plan, planId);
    }

    function addPlanDOM(plan, planId) {
      hideEmpty();
      const el = document.createElement('div');
      el.className = 'plan';
      const heading = document.createElement('div');
      heading.className = 'plan-title';
      heading.textContent = 'Plan';
      el.appendChild(heading);
      const content = plan && plan.type ? plan : { type: 'items', entries: plan.entries || [] };
      if (content.type === 'items' && Array.isArray(content.entries)) {
        for (const entry of content.entries) {
          const icon = entry.status === 'completed' ? '✅'
            : entry.status === 'in_progress' ? '🔄' : '⬜';
          const row = document.createElement('div');
          row.className = 'plan-entry' + (entry.status === 'completed' ? ' completed' : '');
          row.textContent = icon + ' ' + (entry.content || '');
          row.title = entry.priority ? 'Priority: ' + entry.priority : '';
          el.appendChild(row);
        }
      } else if (content.type === 'markdown') {
        const body = document.createElement('div');
        body.className = 'plan-entry';
        body.textContent = content.content || '';
        el.appendChild(body);
      } else if (content.type === 'file') {
        const body = document.createElement('div');
        body.className = 'plan-entry';
        body.textContent = 'Plan file: ' + (content.uri || '');
        el.appendChild(body);
      }
      const previous = planId && planElements[planId];
      if (previous?.isConnected) {
        previous.replaceWith(el);
      } else {
        messagesEl.appendChild(el);
      }
      if (planId) planElements[planId] = el;
      scrollToBottom();
    }

    function updatePlan(plan) {
      if (!plan || !plan.planId) return;
      addPlan(plan, plan.planId);
    }

    function removePlan(planId) {
      if (!planId) return;
      const element = planElements[planId];
      if (element) element.remove();
      delete planElements[planId];
      chatHistory = chatHistory.filter(item => item.kind !== 'plan' || item.planId !== planId);
      saveState();
    }

    function addNotice(notice) {
      if (!notice || !notice.title) return;
      const el = document.createElement('div');
      el.className = 'message notice ' + (notice.severity || 'info');
      el.textContent = notice.description
        ? notice.title + '\\n' + notice.description
        : notice.title;
      messagesEl.appendChild(el);
      hideEmpty();
      scrollToBottom();
    }

    function renderUsage() {
      if (!latestUsage) return;
      const used = Number(latestUsage.used);
      const size = Number(latestUsage.size);
      if (!Number.isFinite(used) || !Number.isFinite(size) || size <= 0) return;
      const percent = Math.min(100, Math.max(0, Math.round((used / size) * 100)));
      const cost = latestUsage.cost;
      const costText = cost && Number.isFinite(cost.amount)
        ? ' · ' + cost.amount.toFixed(2) + ' ' + cost.currency
        : '';
      statusEl.title = used.toLocaleString() + ' / ' + size.toLocaleString() + ' tokens';
      if (!isProcessing) statusEl.textContent = percent + '% context' + costText;
    }

    function ensureSubagentCard(sessionId, metadata) {
      let child = subagentElements[sessionId];
      if (child) return child;

      const card = document.createElement('section');
      card.className = 'subagent-card';
      const heading = document.createElement('div');
      heading.className = 'subagent-heading';
      const title = document.createElement('span');
      title.className = 'subagent-title';
      title.textContent = 'Subagent';
      const state = document.createElement('span');
      state.className = 'subagent-state';
      const cancel = document.createElement('button');
      cancel.className = 'subagent-cancel';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.hidden = true;
      cancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelSubagent', sessionId });
      });
      heading.append(title, state, cancel);

      const description = document.createElement('div');
      description.className = 'subagent-description';
      const body = document.createElement('div');
      body.className = 'subagent-body';
      card.append(heading, description, body);
      messagesEl.appendChild(card);

      child = { card, title, state, cancel, description, body, messageEl: null, tools: Object.create(null) };
      subagentElements[sessionId] = child;
      hideEmpty();
      return child;
    }

    function updateSubagentCard(sessionId, update) {
      const child = ensureSubagentCard(sessionId);
      if (update.title !== undefined) child.title.textContent = update.title || 'Subagent';
      else if (!child.title.textContent) child.title.textContent = 'Subagent';
      if (update.description !== undefined) {
        child.description.textContent = update.description || '';
        child.description.hidden = !update.description;
      }
      if (update.state !== undefined) {
        const state = update.state && update.state.state;
        child.state.textContent = state === 'running' ? 'Working'
          : state === 'idle' ? 'Ready'
            : state === 'requires_action' ? 'Waiting for you'
              : state === 'unknown' ? 'Status unavailable' : '';
      }
      if (update.capabilities !== undefined) {
        child.cancel.hidden = !update.capabilities || !update.capabilities.cancel;
      }
      scrollToBottom();
      return child;
    }

    function appendSubagentMessage(sessionId, text, role) {
      const child = ensureSubagentCard(sessionId);
      if (role === 'assistant' && child.messageEl) {
        child.messageEl.textContent += text;
      } else {
        const message = document.createElement('div');
        message.className = 'subagent-message';
        message.textContent = text;
        child.body.appendChild(message);
        child.messageEl = role === 'assistant' ? message : null;
      }
      scrollToBottom();
    }

    function appendSubagentTool(sessionId, update, isUpdate) {
      const child = ensureSubagentCard(sessionId);
      const toolId = update.toolCallId || 'unknown';
      let tool = child.tools[toolId];
      if (!tool) {
        tool = document.createElement('details');
        tool.className = 'subagent-tool';
        const summary = document.createElement('summary');
        tool.output = document.createElement('pre');
        tool.append(summary, tool.output);
        child.tools[toolId] = tool;
        child.body.appendChild(tool);
      }
      if (update.title || update.name || !isUpdate) {
        tool.querySelector('summary').textContent = (update.title || update.name || 'Tool call')
          + (update.status ? ' · ' + update.status : '');
      }
      const details = [];
      if (update.rawInput !== undefined) details.push('INPUT\\n' + formatToolValue(update.rawInput));
      for (const item of Array.isArray(update.content) ? update.content : []) {
        if (item && item.type === 'diff') {
          details.push('File: ' + (item.path || 'unknown') + '\\n--- before\\n'
            + (item.oldText || '') + '\\n+++ after\\n' + (item.newText || ''));
        } else if (item && item.type === 'content') {
          details.push(contentBlockText(item.content));
        } else if (item && item.type === 'terminal') {
          details.push('Terminal: ' + (item.terminalId || 'unknown'));
        }
      }
      if (update.rawOutput !== undefined) details.push('OUTPUT\\n' + formatToolValue(update.rawOutput));
      if (details.length) tool.output.textContent = details.join('\\n\\n').slice(0, 12000);
      child.messageEl = null;
      scrollToBottom();
    }

    function handleSubagentUpdate(sessionId, update) {
      const type = update && update.sessionUpdate;
      if (type === 'subagent_update') {
        updateSubagentCard(update.sessionId, update);
      } else if (type === 'agent_message_chunk' || type === 'agent_thought_chunk') {
        const text = contentBlockText(update.content);
        if (text) appendSubagentMessage(sessionId, text, 'assistant');
      } else if (type === 'user_message_chunk') {
        const text = contentBlockText(update.content);
        if (text) appendSubagentMessage(sessionId, text, 'user');
      } else if (type === 'tool_call') {
        appendSubagentTool(sessionId, update, false);
      } else if (type === 'tool_call_update') {
        appendSubagentTool(sessionId, update, true);
      }
    }

    function handleSessionMessage(update) {
      const sender = update.senderSessionId || 'Agent';
      const recipient = update.recipientSessionId || 'parent session';
      const sessionId = update.senderSessionId || update.recipientSessionId;
      const text = (update.content || []).map(contentBlockText).filter(Boolean).join('\\n');
      if (sessionId && subagentElements[sessionId]) {
        appendSubagentMessage(sessionId, sender + ' → ' + recipient + (text ? '\\n' + text : ''), 'user');
      }
    }

    function contentBlockText(block) {
      if (!block) return '';
      if (block.type === 'text') return block.text || '';
      if (block.type === 'resource' && block.resource) return block.resource.text || '[Embedded resource]';
      if (block.type === 'resource_link') return (block.name || 'Resource') + ': ' + (block.uri || '');
      if (block.type === 'image') return '[Image: ' + (block.mimeType || 'image') + ']';
      if (block.type === 'audio') return '[Audio: ' + (block.mimeType || 'audio') + ']';
      return '';
    }

    function updateCompaction(update) {
      if (!update || !update.compactionId) return;
      const id = update.compactionId;
      let element = compactionElements[id];
      if (!element) {
        element = document.createElement('div');
        element.className = 'message compaction';
        compactionElements[id] = element;
        messagesEl.appendChild(element);
      }
      element.className = 'message compaction' + (update.status === 'failed' ? ' failed' : '');
      const status = update.status || 'in_progress';
      if (Array.isArray(update.summary)) {
        element.dataset.summary = update.summary.map(contentBlockText).filter(Boolean).join('\\n');
      }
      const summary = element.dataset.summary || '';
      element.textContent = 'Context compaction ' + status
        + (summary ? '\\n' + summary : '')
        + (update.error ? '\\n' + update.error : '');
      hideEmpty();
      scrollToBottom();
    }

    function appendCompactionSummary(update) {
      if (!update || !update.compactionId) return;
      let element = compactionElements[update.compactionId];
      if (!element) {
        updateCompaction({ compactionId: update.compactionId, status: 'in_progress' });
        element = compactionElements[update.compactionId];
      }
      const chunk = contentBlockText(update.content);
      if (!chunk || !element) return;
      element.dataset.summary = (element.dataset.summary || '') + chunk;
      element.textContent = 'Context compaction in progress\\n' + element.dataset.summary;
      scrollToBottom();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function finalizeThought() {
      if (!currentThoughtEl) return;
      if (thoughtEndTime) return; // already finalized
      thoughtEndTime = Date.now();
      currentThoughtEl.classList.remove('streaming');
      const elapsed = thoughtStartTime ? Math.round((thoughtEndTime - thoughtStartTime) / 1000) : 0;
      const summary = currentThoughtEl.querySelector('summary');
      if (summary) {
        summary.innerHTML = elapsed > 0
          ? 'Thought for ' + elapsed + 's'
          : 'Thought';
      }
    }

    /**
     * Commit the in-progress assistant turn to chatHistory (without firing
     * the live promptEnd markdown-render request — replay does that
     * batched at loadSessionEnd). Resets all per-turn DOM/state pointers so
     * the next turn starts fresh.
     */
    function finalizeCurrentAssistantTurn() {
      if (currentThoughtText) {
        finalizeThought();
        const tEnd = thoughtEndTime || Date.now();
        chatHistory.push({
          kind: 'thought',
          text: currentThoughtText,
          durationSec: thoughtStartTime ? Math.round((tEnd - thoughtStartTime) / 1000) : 0,
        });
      }
      if (currentAssistantText) {
        chatHistory.push({ kind: 'message', role: 'assistant', text: currentAssistantText });
        saveState();
      }
      currentAssistantEl = null;
      currentAssistantText = '';
      currentTurnEl = null;
      currentToolsListEl = null;
      currentToolsCountEl = null;
      currentToolCount = 0;
      currentThoughtEl = null;
      currentThoughtTextEl = null;
      currentThoughtText = '';
      thoughtStartTime = null;
      thoughtEndTime = null;
    }

    function addThoughtDOM(text, durationSec) {
      hideEmpty();
      const el = document.createElement('details');
      el.className = 'thought-block';
      el.innerHTML =
        '<summary>' + (durationSec > 0 ? 'Thought for ' + durationSec + 's' : 'Thought') + '</summary>' +
        '<div class="thought-content">' + escapeHtml(text) + '</div>';
      messagesEl.appendChild(el);
      scrollToBottom();
    }

    function showSessionConnected(session) {
      hasActiveSession = true;
      sessionState = {
        agentName: session.agentName,
        cwd: session.cwd,
        title: session.title || undefined,
      };
      saveState();
      showSessionConnectedFromState(sessionState);

      // Prefer ACP "Session Config Options" when provided. Spec: clients
      // that support configOptions MUST use them exclusively and ignore
      // the legacy modes field.
      const cfg = session.configOptions;
      if (Array.isArray(cfg) && cfg.length > 0) {
        setConfigOptionsState(cfg);
      } else {
        setConfigOptionsState([]);
        if (session.modes) updateModePicker(session.modes);
        if (session.models) updateModelPicker(session.models);
      }
      // Restore available commands
      if (session.availableCommands) {
        availableCommands = session.availableCommands;
      }
      updatePlaceholder();
    }

    function showSessionConnectedFromState(ss) {
      hasActiveSession = true;
      hideEmpty();
      if (bannerAgent) bannerAgent.textContent = ss.title || ss.agentName || 'Agent';
      if (bannerCwd) bannerCwd.textContent = ss.cwd || '';
      currentAgentName = ss.agentName || '';
      updatePlaceholder();
      if (sessionBanner) sessionBanner.classList.add('visible');
      if (inputArea) inputArea.classList.remove('disabled');
      promptInput.disabled = false;
    }

    function showNoSession() {
      hasActiveSession = false;
      sessionState = null;
      saveState();
      if (sessionBanner) sessionBanner.classList.remove('visible');
      if (emptyState) emptyState.style.display = '';
      if (inputArea) inputArea.classList.add('disabled');
      // Hide pickers when disconnected
      modePickerWrap.classList.add('hidden');
      modelPickerWrap.classList.add('hidden');
      setConfigOptionsState([]);
    }

    // Handle messages from the extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'state':
          if (msg.session) {
            showSessionConnected(msg.session);
          } else {
            showNoSession();
          }
          break;

        case 'attachmentsUpdate':
          pendingAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
          suggestedFile = msg.currentFile || null;
          editorSelection = msg.selection || null;
          renderAttachments();
          break;

        case 'promptStart':
          setProcessing(true);
          currentAssistantEl = null;
          currentAssistantText = '';
          currentTurnEl = null;
          currentToolsListEl = null;
          currentToolsCountEl = null;
          currentToolCount = 0;
          currentThoughtEl = null;
          currentThoughtTextEl = null;
          currentThoughtText = '';
          thoughtStartTime = null;
          thoughtEndTime = null;
          break;

        case 'promptEnd':
          // Finalize thought block if present
          if (currentThoughtText) {
            finalizeThought();
            const tEnd = thoughtEndTime || Date.now();
            chatHistory.push({
              kind: 'thought',
              text: currentThoughtText,
              durationSec: thoughtStartTime ? Math.round((tEnd - thoughtStartTime) / 1000) : 0,
            });
          }
          if (currentAssistantText) {
            chatHistory.push({ kind: 'message', role: 'assistant', text: currentAssistantText });
            saveState();
            // Request markdown rendering from extension host
            if (currentAssistantEl) {
              vscode.postMessage({
                type: 'renderMarkdown',
                items: [{ index: chatHistory.length - 1, text: currentAssistantText }]
              });
            }
          }
          setProcessing(false);
          currentAssistantEl = null;
          currentAssistantText = '';
          // Auto-collapse tool calls in completed turns
          if (currentToolsListEl && currentToolCount > 3) {
            currentToolsListEl.classList.add('collapsed');
            if (currentToolsCountEl) {
              currentToolsCountEl.dataset.count = String(currentToolCount);
              setToolsSummary(currentToolsCountEl, currentToolCount, true);
            }
          }
          currentTurnEl = null;
          currentToolsListEl = null;
          currentToolsCountEl = null;
          currentToolCount = 0;
          currentThoughtEl = null;
          currentThoughtTextEl = null;
          currentThoughtText = '';
          thoughtStartTime = null;
          thoughtEndTime = null;
          break;

        case 'clearChat':
          chatHistory = [];
          sessionState = null;
          latestUsage = null;
          Object.keys(planElements).forEach(id => delete planElements[id]);
          Object.keys(compactionElements).forEach(id => delete compactionElements[id]);
          Object.keys(subagentElements).forEach(id => delete subagentElements[id]);
          saveState();
          currentAssistantEl = null;
          currentAssistantText = '';
          toolCalls = {};
          currentTurnEl = null;
          currentToolsListEl = null;
          currentToolsCountEl = null;
          currentToolCount = 0;
          currentThoughtEl = null;
          currentThoughtTextEl = null;
          currentThoughtText = '';
          thoughtStartTime = null;
          thoughtEndTime = null;
          availableCommands = [];
          slashPopup.classList.remove('open');
          messagesEl.innerHTML = '';
          messagesEl.appendChild(emptyState);
          if (emptyState) emptyState.style.display = '';
          if (sessionBanner) sessionBanner.classList.remove('visible');
          if (inputArea) inputArea.classList.add('disabled');
          modePickerWrap.classList.add('hidden');
          modelPickerWrap.classList.add('hidden');
          setConfigOptionsState([]);
          setProcessing(false);
          break;

        case 'subagentsReset':
          Object.keys(subagentElements).forEach(id => delete subagentElements[id]);
          messagesEl.querySelectorAll('.subagent-card').forEach(element => element.remove());
          break;

        case 'error':
          addMessage('error', msg.message || 'An error occurred');
          break;

        case 'sessionUpdate':
          handleUpdate(msg.update, msg.sessionId, !!msg.isSubagent);
          break;

        case 'modesUpdate':
          updateModePicker(msg.modes);
          break;

        case 'modelsUpdate':
          updateModelPicker(msg.models);
          break;

        case 'configOptionsUpdate':
          setConfigOptionsState(msg.configOptions || []);
          break;

        case 'loadSessionStart':
          handleLoadSessionStart();
          break;

        case 'loadSessionEnd':
          handleLoadSessionEnd(!!msg.ok);
          break;

        case 'sessionInfoUpdate':
          handleSessionInfoUpdate(msg.title);
          break;

        case 'markdownRendered': {
          // Extension sent back rendered HTML for messages
          const rendered = msg.items || [];
          for (const item of rendered) {
            // Find the DOM element for this history item
            // For the just-completed streaming message, update the last assistant el
            const historyItem = chatHistory[item.index];
            if (!historyItem || historyItem.role !== 'assistant') continue;

            // Find the element — walk all .message.assistant elements
            const allAssistant = messagesEl.querySelectorAll('.message.assistant');
            // The item.index tracks position in chatHistory; count only assistant messages up to this index
            let assistantIdx = 0;
            for (let i = 0; i < chatHistory.length; i++) {
              if (i === item.index) break;
              if (chatHistory[i].kind === 'message' && chatHistory[i].role === 'assistant') assistantIdx++;
            }
            const el = allAssistant[assistantIdx];
            if (el) {
              el.classList.add('md-rendered');
              el.innerHTML = item.html;
            }
          }
          scrollToBottom();
          break;
        }
      }
    });

    function handleUpdate(update, sessionId, isSubagent) {
      if (!update) return;
      if (isSubagent) {
        handleSubagentUpdate(sessionId, update);
        return;
      }
      const type = update.sessionUpdate;

      switch (type) {
        case 'agent_message_chunk': {
          const content = update.content;
          if (content && content.type === 'text' && content.text) {
            currentAssistantText += content.text;
            // Don't create visible element until there's non-whitespace content
            if (!currentAssistantEl && !currentAssistantText.trim()) {
              break;
            }
            // Auto-collapse thought when assistant text starts
            if (currentThoughtEl && currentThoughtEl.open) {
              finalizeThought();
              currentThoughtEl.open = false;
            }
            if (!currentAssistantEl) {
              // Create a turn container, assistant text goes inside it
              if (!currentTurnEl) {
                currentTurnEl = document.createElement('div');
                currentTurnEl.className = 'turn';
                messagesEl.appendChild(currentTurnEl);
                hideEmpty();
              }
              currentAssistantEl = document.createElement('div');
              currentAssistantEl.className = 'message assistant';
              currentTurnEl.insertBefore(currentAssistantEl, currentTurnEl.querySelector('.turn-tools'));
            }
            currentAssistantEl.textContent = currentAssistantText;
            scrollToBottom();
          } else if (content) {
            addContentBlock('assistant', content);
          }
          break;
        }

        case 'user_message_chunk': {
          // Only the session/load replay path emits this; live prompts
          // never echo the user's message. Use it to break apart historical
          // turns: finalize any pending assistant turn first, then append
          // the historical user message.
          const content = update.content;
          if (content && content.type === 'text' && typeof content.text === 'string') {
            finalizeCurrentAssistantTurn();
            // Coalesce consecutive user chunks into one message.
            const last = chatHistory[chatHistory.length - 1];
            if (last && last.kind === 'message' && last.role === 'user') {
              last.text += content.text;
              const allUser = messagesEl.querySelectorAll('.message.user');
              const el = allUser[allUser.length - 1];
              if (el) el.textContent = last.text;
            } else {
              addMessage('user', content.text);
            }
          } else if (content) {
            finalizeCurrentAssistantTurn();
            addContentBlock('user', content);
          }
          break;
        }

        case 'agent_thought_chunk': {
          const content = update.content;
          if (content && content.type === 'text') {
            if (!currentThoughtEl) {
              // Create thought block inside turn
              if (!currentTurnEl) {
                currentTurnEl = document.createElement('div');
                currentTurnEl.className = 'turn';
                messagesEl.appendChild(currentTurnEl);
                hideEmpty();
              }
              currentThoughtEl = document.createElement('details');
              currentThoughtEl.className = 'thought-block streaming';
              currentThoughtEl.open = true;
              currentThoughtEl.innerHTML =
                '<summary><span class="thought-indicator"></span> Thinking\u2026</summary>' +
                '<div class="thought-content"></div>';
              currentThoughtTextEl = currentThoughtEl.querySelector('.thought-content');
              currentTurnEl.insertBefore(currentThoughtEl, currentTurnEl.firstChild);
              thoughtStartTime = Date.now();
              currentThoughtText = '';
            }
            currentThoughtText += content.text;
            currentThoughtTextEl.textContent = currentThoughtText;
            scrollToBottom();
          }
          break;
        }

        case 'tool_call': {
          const tc = update;
          addToolCall(
            tc.toolCallId || 'unknown',
            tc.title || 'Tool Call',
            tc.status || 'pending',
            tc.content,
            tc.rawInput,
            tc.rawOutput,
          );
          break;
        }

        case 'tool_call_update': {
          updateToolCall(
            update.toolCallId || 'unknown',
            update.status || 'completed',
            update.title,
            update.content,
            update.rawInput,
            update.rawOutput,
          );
          break;
        }

        case 'plan': {
          addPlan(update);
          break;
        }

        case 'plan_update': {
          updatePlan(update.plan);
          break;
        }

        case 'plan_removed': {
          removePlan(update.planId);
          break;
        }

        case 'usage_update': {
          latestUsage = update;
          renderUsage();
          break;
        }

        case 'compaction_update': {
          updateCompaction(update);
          break;
        }

        case 'compaction_summary_chunk': {
          appendCompactionSummary(update);
          break;
        }

        case 'notice': {
          addNotice(update);
          break;
        }

        case 'subagent_update': {
          updateSubagentCard(update.sessionId, update);
          break;
        }

        case 'session_message': {
          handleSessionMessage(update);
          break;
        }

        case 'session_message_chunk': {
          const text = contentBlockText(update.content);
          const sender = update.senderSessionId || 'Agent';
          const recipient = update.recipientSessionId || 'parent session';
          const childSessionId = update.senderSessionId || update.recipientSessionId;
          if (childSessionId && subagentElements[childSessionId] && text) {
            appendSubagentMessage(childSessionId, sender + ' → ' + recipient + '\\n' + text, 'user');
          }
          break;
        }

        case 'current_mode_update': {
          // Server pushed a mode change
          currentModeId = update.currentModeId || update.modeId || null;
          const current = availableModes.find(m => m.id === currentModeId);
          if (current) {
            modePickerLabel.textContent = current.name;
            renderModeDropdown();
          }
          break;
        }

        case 'config_option_update': {
          // Server pushed a full configOptions replacement
          setConfigOptionsState(update.configOptions || []);
          break;
        }

        case 'available_commands_update':
          availableCommands = update.availableCommands || [];
          updatePlaceholder();
          break;
      }
    }

    // Restore previous state before telling extension we're ready
    restoreState();

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
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
