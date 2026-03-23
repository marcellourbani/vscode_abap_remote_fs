import { ViewColumn, WebviewPanel } from "vscode"
import { funWindow as window } from "../services/funMessenger"
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

export function updateLogEntry(id: number, update: Partial<AdtLogEntry>) {
  const entry = entries.find(e => e.id === id)
  if (entry) Object.assign(entry, update)
  notifyListeners()
}

export function getLogEntries(): readonly AdtLogEntry[] {
  return entries
}

function notifyListeners() {
  // Debounce: coalesce rapid-fire updates into a single notification
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

/** Returns true when the comm-log webview is open (logging is active) */
export function isLogging(): boolean {
  return currentPanel !== undefined
}

// ── Webview panel ────────────────────────────────────────────────────

let currentPanel: WebviewPanel | undefined

export function openCommLogCommand() {
  if (currentPanel) {
    try {
      currentPanel.reveal(ViewColumn.Active)
      return
    } catch {
      currentPanel = undefined
    }
  }

  currentPanel = window.createWebviewPanel(
    "adtCommLog",
    "📡 ADT Communication Log",
    ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    }
  )

  // Load HTML from media file
  const htmlPath = path.join(context.extensionPath, "client", "dist", "media", "commLog.html")
  try {
    currentPanel.webview.html = fs.readFileSync(htmlPath, "utf8")
  } catch (err) {
    const safeErr = String(err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    currentPanel.webview.html = `<html><body><h3>Failed to load communication log</h3><pre>${safeErr}</pre></body></html>`
    return
  }

  // Push full snapshot on first load
  const sendSnapshot = () => {
    if (!currentPanel) return
    try {
      currentPanel.webview.postMessage({ type: "snapshot", entries })
    } catch { /* panel disposed */ }
  }

  // Push every change instantly
  const unsub = subscribe(sendSnapshot)

  // Notify language server to start forwarding its ADT calls
  try { client?.sendNotification(Methods.commLogToggle, true) } catch { /* server not ready */ }

  currentPanel.webview.onDidReceiveMessage(msg => {
    switch (msg.command) {
      case "ready":
        sendSnapshot()
        break
      case "clear":
        entries.length = 0
        break
    }
  })

  currentPanel.onDidDispose(() => {
    unsub()
    if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = undefined }
    currentPanel = undefined
    // Notify language server to stop forwarding
    try { client?.sendNotification(Methods.commLogToggle, false) } catch { /* server not ready */ }
    // Clear log entries — no point keeping data nobody can see
    entries.length = 0
  })
}
