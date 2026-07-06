import {
  CancellationToken,
  commands,
  env,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window
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
import { logTelemetry } from "../services/telemetry"

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
  private static statusListeners = new Set<() => void>()
  private serveractive = false
  entries: AdtLogEntry[] = []

  public static onStatusChange(fn: () => void) {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private static notifyStatus() {
    for (const fn of this.statusListeners) fn()
  }

  public static getActiveConnIds(): string[] {
    return Array.from(this.instances.keys())
  }

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
    this.notifyStatus()
    return logger
  }
  @command(AbapFsCommands.activateCommLog)
  public static async activateLogging() {
    logTelemetry("command_activate_comm_log_called")
    const folder = await pickAdtRoot()
    if (!folder || folder.uri.scheme !== ADTSCHEME) return
    const connId = folder.uri.authority
    this.getOrCreate(connId)
    commands.executeCommand("abapfs.views.commLog.focus")
  }
  @command(AbapFsCommands.deactivateCommLog)
  public static async deactivateLogging() {
    logTelemetry("command_deactivate_comm_log_called")
    const folder = await pickAdtRoot()
    if (!folder || folder.uri.scheme !== ADTSCHEME) return
    const connId = folder.uri.authority
    const logger = this.instances.get(connId)
    if (!logger) return
    logger.activateServer(false)
    this.instances.delete(connId)
    this.notifyStatus()
  }
  public static stopLogging() {
    for (const logger of this.instances.values()) logger.activateServer(false)
    this.instances.clear()
    this.notifyStatus()
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

    const sendStatus = () => {
      if (!this.view) return
      try {
        this.view.webview.postMessage({
          type: "status",
          active: CallLogger.getActiveConnIds()
        })
      } catch {
        /* panel not ready */
      }
    }

    this.unsub = subscribe(sendSnapshot)
    const unsubStatus = CallLogger.onStatusChange(sendStatus)

    panel.webview.onDidReceiveMessage(msg => {
      switch (msg.command) {
        case "ready":
          sendSnapshot()
          sendStatus()
          break
        case "clear":
          entries.length = 0
          nextId = 1
          sendSnapshot() // send empty snapshot to win any race with in-flight entries
          break
        case "toggle":
          if (CallLogger.getActiveConnIds().length > 0)
            commands.executeCommand(AbapFsCommands.deactivateCommLog)
          else commands.executeCommand(AbapFsCommands.activateCommLog)
          break
        case "copy":
          {
            const entry = entries.find(e => e.id === msg.id)
            if (!entry) return
            let text = ""
            let message = ""
            if (msg.format === "json") {
              text = JSON.stringify(entry, null, 2)
              message = "Copied as JSON"
            } else if (msg.format === "http") {
              let url = entry.url
              if (entry.params && Object.keys(entry.params).length) {
                const searchParams = new URLSearchParams()
                for (const [k, v] of Object.entries(entry.params)) searchParams.append(k, v)
                url += (url.includes("?") ? "&" : "?") + searchParams.toString()
              }
              text = `${entry.method} {{baseUrl}}${url}\n`
              if (entry.requestHeaders) {
                for (const [k, v] of Object.entries(entry.requestHeaders)) {
                  const lowerK = k.toLowerCase()
                  if (lowerK === "cookie") continue
                  let val = v
                  if (lowerK === "x-csrf-token" && v.toUpperCase() !== "FETCH")
                    if (entry.method === "GET") continue
                    else val = "{{login_csrf_token}}"
                  text += `${k}: ${val}\n`
                }
              }
              message = "Copied HTTP request"
            }
            if (text) {
              env.clipboard.writeText(text).then(() => {
                window.showInformationMessage(message)
              }, ignore)
            }
          }
          break
      }
    })

    panel.onDidDispose(() => {
      unsubStatus()
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
