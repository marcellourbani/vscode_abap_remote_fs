import {
  CancellationToken,
  commands,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext
} from "vscode"
import { context } from "../extension"
import { client } from "../langClient"
import { Methods } from "vscode-abap-remote-fs-sharedapi"
import * as path from "path"
import * as fs from "fs"
import { LogData } from "abap-adt-api/build/requestLogger"
import { ignore } from "../lib"
import { AbapFsCommands, command } from "../commands"
import { pickAdtRoot } from "../config"
import { ADTSCHEME } from "./conections"

// ── In-memory log store ──────────────────────────────────────────────

export interface AdtLogEntry {
  id: number
  connId: string
  method: string
  url: string
  params: Record<string, string> | undefined
  requestBody: string | undefined
  requestHeaders: Record<string, string> | undefined
  responseHeaders: Record<string, string> | undefined
  status: number | string | undefined
  responseBody: string | undefined
  duration: number | undefined
  startTime: number
  endTime: number | undefined
  error: boolean
}

const MAX_ENTRIES = 2000

export class CallLogger {
  private static instances = new Map<string, CallLogger>()
  private serveractive = false
  entries: AdtLogEntry[] = []
  public static get(connId: string) {
    return this.instances.get(connId)!
  }

  private constructor(private connId: string) {
    this.activateServer(true)
  }
  private activateServer(active: boolean) {
    if (active !== this.serveractive) {
      this.serveractive = active
      client
        ?.sendNotification(Methods.commLogToggle, { active, connId: this.connId })
        .then(() => (this.serveractive = active), ignore)
    }
  }
  public static getOrCreate(connId: string) {
    if (this.instances.has(connId)) return this.instances.get(connId)!
    const logger = new CallLogger(connId)
    this.instances.set(connId, logger)
    logger.activateServer(true)
    return logger
  }
  @command(AbapFsCommands.activateCommLog)
  public static async activateLogging() {
    const folder = await pickAdtRoot()
    if (!folder || folder.uri.scheme !== ADTSCHEME) return
    const connId = folder.uri.authority
    this.getOrCreate(connId)
    commands.executeCommand("abapfs.views.commLog.focus")
  }
  @command(AbapFsCommands.deactivateCommLog)
  public static async deactivateLogging() {
    const folder = await pickAdtRoot()
    if (!folder || folder.uri.scheme !== ADTSCHEME) return
    const connId = folder.uri.authority
    const logger = this.instances.get(connId)
    if (!logger) return
    logger.activateServer(false)
    this.instances.delete(connId)
  }
  public static stopLogging() {
    for (const logger of this.instances.values()) logger.activateServer(false)
    this.instances.clear()
  }
  public add(data: LogData) {
    const rh: Record<string, string> = {}
    if (data.response?.headers) {
      for (const [k, v] of Object.entries(data.response.headers))
        if (v !== undefined && v !== null) rh[k] = `${v}`
    }
    addLogEntry({
      connId: this.connId,
      method: data.request.method,
      url: data.request.uri,
      params: Object.keys(data.request.params || {}).length ? data.request.params : undefined,
      requestBody: capPayload(data.request.body),
      requestHeaders: Object.keys(data.request.headers || {}).length
        ? data.request.headers
        : undefined,
      responseHeaders: Object.keys(rh).length ? rh : undefined,
      status: data.error ? data.response?.statusCode || "ERR" : data.response.statusCode,
      responseBody: capPayload(data.response?.body),
      duration: data.duration,
      startTime: data.startTime.getTime(),
      endTime: data.startTime.getTime() + data.duration,
      error: !!data.error
    })
  }
}

/** Cap payload size for comm log to avoid memory issues */
const MAX_COMM_LOG_PAYLOAD = 2 * 1024 * 1024
function capPayload(body: string | undefined): string | undefined {
  if (!body || body.length <= MAX_COMM_LOG_PAYLOAD) return body
  return (
    body.substring(0, MAX_COMM_LOG_PAYLOAD) + `\n\n--- TRUNCATED (${body.length} chars total) ---`
  )
}

let nextId = 1
const entries: AdtLogEntry[] = []
const listeners: Set<() => void> = new Set()

export function addLogEntry(entry: Omit<AdtLogEntry, "id">): AdtLogEntry {
  const full: AdtLogEntry = { ...entry, id: nextId++ }
  entries.push(full)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  notifyListeners()
  return full
}

export function getLogEntries(): readonly AdtLogEntry[] {
  return entries
}

function notifyListeners() {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined
    for (const fn of listeners) fn()
  }, 50)
}
let notifyTimer: ReturnType<typeof setTimeout> | undefined

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ── Panel (WebviewViewProvider) ──────────────────────────────────────

export class CommLogPanel implements WebviewViewProvider {
  public static readonly viewType = "abapfs.views.commLog"
  private static instance: CommLogPanel | undefined
  private view: WebviewView | undefined
  private unsub: (() => void) | undefined

  public static get() {
    if (!CommLogPanel.instance) CommLogPanel.instance = new CommLogPanel()
    return CommLogPanel.instance
  }

  public static isVisible(): boolean {
    return !!CommLogPanel.instance?.view?.visible
  }

  async resolveWebviewView(
    panel: WebviewView,
    _context: WebviewViewResolveContext<unknown>,
    _token: CancellationToken
  ) {
    this.view = panel

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    }

    // Load HTML from media file
    const htmlPath = path.join(context.extensionPath, "client", "dist", "media", "commLog.html")
    try {
      panel.webview.html = fs.readFileSync(htmlPath, "utf8")
    } catch (err) {
      const safeErr = String(err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      panel.webview.html = `<html><body><h3>Failed to load communication log</h3><pre>${safeErr}</pre></body></html>`
      return
    }

    const sendSnapshot = () => {
      if (!this.view) return
      try {
        this.view.webview.postMessage({ type: "snapshot", entries })
      } catch {
        /* panel not ready */
      }
    }

    this.unsub = subscribe(sendSnapshot)

    panel.webview.onDidReceiveMessage(msg => {
      switch (msg.command) {
        case "ready":
          sendSnapshot()
          break
        case "clear":
          entries.length = 0
          nextId = 1
          sendSnapshot() // send empty snapshot to win any race with in-flight entries
          break
      }
    })

    panel.onDidDispose(() => {
      if (this.unsub) {
        this.unsub()
        this.unsub = undefined
      }
      if (notifyTimer) {
        clearTimeout(notifyTimer)
        notifyTimer = undefined
      }
      this.view = undefined
      CallLogger.stopLogging()
      entries.length = 0
    })
  }
}
