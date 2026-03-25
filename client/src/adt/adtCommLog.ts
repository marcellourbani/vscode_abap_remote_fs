import { CancellationToken, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from "vscode"
import { context } from "../extension"
import { client } from "../langClient"
import { Methods } from "vscode-abap-remote-fs-sharedapi"
import * as path from "path"
import * as fs from "fs"

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

/** Returns true when the comm-log panel is visible (logging is active) */
export function isLogging(): boolean {
  return CommLogPanel.isVisible()
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
      } catch { /* panel not ready */ }
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

    // Toggle server-side logging when panel visibility changes
    panel.onDidChangeVisibility(() => {
      const visible = panel.visible
      try { client?.sendNotification(Methods.commLogToggle, visible) } catch { /* server not ready */ }
      if (visible) sendSnapshot()
    })

    // Notify server on initial show
    try { client?.sendNotification(Methods.commLogToggle, true) } catch { /* server not ready */ }

    panel.onDidDispose(() => {
      if (this.unsub) { this.unsub(); this.unsub = undefined }
      if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = undefined }
      this.view = undefined
      try { client?.sendNotification(Methods.commLogToggle, false) } catch { /* server not ready */ }
      entries.length = 0
    })
  }
}
