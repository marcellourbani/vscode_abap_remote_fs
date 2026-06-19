import {
  CancellationToken,
  QuickPickItem,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
  workspace
} from "vscode"
import { connectedRoots } from "../config"
import { MySearchResult } from "../adt/operations/AdtObjectFinder"
import { getClient } from "../adt/conections"
import { currentUri, openObject } from "../commands/commands"
import { caughtToString } from "../lib"
import { context } from "../extension"
import { OBJECT_TYPE_FILTER_OPTIONS, getObjectTypeLabel } from "./objectTypeLabels"

type SearchResultMessage = {
  uri: string
  type: string
  name: string
  description?: string
  detail?: string
}

type ConnectionOption = {
  id: string
  label: string
}

export class ObjectSearchViewProvider implements WebviewViewProvider {
  public static readonly viewType = "abapfs.views.objectSearch"
  private static instance: ObjectSearchViewProvider | undefined

  public static get() {
    if (!this.instance) this.instance = new ObjectSearchViewProvider()
    return this.instance
  }

  private view: WebviewView | undefined
  private currentConnId: string | undefined
  private searchGeneration = 0

  private constructor() {
    context.subscriptions.push(
      window.onDidChangeActiveTextEditor(() => {
        this.postState().catch(() => undefined)
      }),
      workspace.onDidChangeWorkspaceFolders(() => {
        this.postState().catch(() => undefined)
      })
    )
  }

  public async resolveWebviewView(
    view: WebviewView,
    _context: WebviewViewResolveContext<unknown>,
    _token: CancellationToken
  ) {
    this.view = view
    view.webview.options = {
      enableScripts: true
    }
    view.webview.html = this.getHtml(view.webview)

    view.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case "ready":
          await this.postState()
          break
        case "search":
          await this.search(message.query || "", message.connectionId)
          break
        case "open":
          if (message.connectionId && message.uri) {
            await openObject(message.connectionId, message.uri, message.objectType)
          }
          break
        case "changeTypes":
          await this.changeTypes(message.connectionId, message.query || "")
          break
      }
    })

    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  private getConnections(): ConnectionOption[] {
    return [...connectedRoots().values()].map(root => ({
      id: root.uri.authority,
      label: root.name
    }))
  }

  private resolveConnectionId(requested?: string) {
    const connections = this.getConnections()
    const ids = new Set(connections.map(connection => connection.id))
    const activeConnId = currentUri()?.authority

    if (requested && ids.has(requested)) return requested
    if (this.currentConnId && ids.has(this.currentConnId)) return this.currentConnId
    if (activeConnId && ids.has(activeConnId)) return activeConnId
    return connections[0]?.id
  }

  private async postState() {
    if (!this.view) return

    const connections = this.getConnections()
    const connectionId = this.resolveConnectionId()
    this.currentConnId = connectionId
    const typeFilter = getSavedTypeFilter()

    await this.view.webview.postMessage({
      type: "state",
      connections,
      connectionId,
      typeFilter,
      hasConnections: connections.length > 0
    })
  }

  private async postResults(items: SearchResultMessage[], busy = false, error = "") {
    if (!this.view) return
    await this.view.webview.postMessage({ type: "results", items, busy, error })
  }

  private async changeTypes(connectionId: string | undefined, query: string) {
    const resolved = this.resolveConnectionId(connectionId)
    if (!resolved) return

    const selectedTypes = await pickTypeFilter()
    if (selectedTypes === undefined) return

    await context.globalState.update(TYPE_FILTER_KEY, selectedTypes)

    await this.postState()
    await this.search(query, resolved)
  }

  private async search(query: string, connectionId: string | undefined) {
    if (!this.view) return

    const resolved = this.resolveConnectionId(connectionId)
    this.currentConnId = resolved
    const trimmed = query.trim()
    const generation = ++this.searchGeneration

    if (!resolved) {
      await this.postResults([], false, "No ABAP system is mounted in this workspace.")
      return
    }

    if (trimmed.length < 2) {
      await this.postResults([])
      return
    }

    await this.postResults([], true)

    try {
      const items = await searchObjects(resolved, trimmed, getSavedTypeFilter())
      if (!this.view || generation !== this.searchGeneration) return

      await this.postResults(items.map(toSearchResultMessage))
    } catch (error) {
      if (!this.view || generation !== this.searchGeneration) return
      await this.postResults([], false, caughtToString(error))
    }
  }

  private getHtml(webview: Webview) {
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        padding: 0;
        margin: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }

      .wrap {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .toolbar {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
      }

      select,
      input,
      button {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, transparent);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 6px 8px;
        font: inherit;
      }

      button {
        width: auto;
        cursor: pointer;
      }

      .iconButton {
        width: 32px;
        min-width: 32px;
        padding: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        line-height: 1;
      }

      .iconButton svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
        display: block;
      }

      .hint {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .results {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .result {
        padding: 8px 2px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .result button {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        border: 0;
        padding: 0;
        color: inherit;
      }

      .name {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      .headline {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .desc,
      .detail {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
      }

      .desc {
        font-size: 11px;
      }

      .empty,
      .error {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        padding: 4px 0;
      }

      .error {
        color: var(--vscode-errorForeground);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="toolbar">
        <select id="connection"></select>
        <button
          id="filters"
          class="iconButton"
          type="button"
          title="Select object type filters"
          aria-label="Select object type filters"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1 3.25A1.25 1.25 0 0 1 2.25 2h11.5a1.25 1.25 0 0 1 .97 2.04L10 9.97v3.28a.75.75 0 0 1-1.2.6l-2-1.5a.75.75 0 0 1-.3-.6V9.97L1.28 4.04A1.25 1.25 0 0 1 1 3.25Z" />
          </svg>
        </button>
      </div>
      <input id="search" type="text" placeholder="Search ABAP objects">
      <div class="meta">
        <span id="filterInfo">All types</span>
        <span id="status">Type at least 2 characters</span>
      </div>
      <div id="error" class="error" hidden></div>
      <ul id="results" class="results"></ul>
      <div class="hint">Uses the existing object search logic and saved type filter. Manage filters with the filter button in the toolbar.</div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi()
      const connection = document.getElementById("connection")
      const search = document.getElementById("search")
      const results = document.getElementById("results")
      const error = document.getElementById("error")
      const status = document.getElementById("status")
      const filterInfo = document.getElementById("filterInfo")
      const filters = document.getElementById("filters")
      let searchTimer
      let currentConnectionId = undefined

      const pluralize = (count, singular, plural = singular + "s") => {
        return count + " " + (count === 1 ? singular : plural)
      }

      const postSearch = () => {
        vscode.postMessage({
          command: "search",
          connectionId: currentConnectionId,
          query: search.value
        })
      }

      const renderResults = items => {
        results.textContent = ""

        if (!items.length) {
          return
        }

        for (const item of items) {
          const li = document.createElement("li")
          li.className = "result"

          const button = document.createElement("button")
          button.type = "button"
          button.addEventListener("click", () => {
            vscode.postMessage({
              command: "open",
              connectionId: currentConnectionId,
              uri: item.uri,
              objectType: item.type
            })
          })

          const headline = document.createElement("div")
          headline.className = "headline"

          const name = document.createElement("div")
          name.className = "name"
          name.textContent = item.name

          const desc = document.createElement("div")
          desc.className = "desc"
          desc.textContent = item.description || ""

          const detail = document.createElement("div")
          detail.className = "detail"
          detail.textContent = item.detail || ""

          headline.appendChild(name)
          if (desc.textContent) headline.appendChild(desc)
          button.appendChild(headline)
          if (detail.textContent) button.appendChild(detail)
          li.appendChild(button)
          results.appendChild(li)
        }
      }

      search.addEventListener("input", () => {
        clearTimeout(searchTimer)
        searchTimer = setTimeout(postSearch, 200)
      })

      connection.addEventListener("change", () => {
        currentConnectionId = connection.value || undefined
        postSearch()
      })

      filters.addEventListener("click", () => {
        vscode.postMessage({
          command: "changeTypes",
          connectionId: currentConnectionId,
          query: search.value
        })
      })

      window.addEventListener("message", event => {
        const message = event.data

        if (message.type === "state") {
          currentConnectionId = message.connectionId
          const previousValue = connection.value
          connection.textContent = ""

          for (const option of message.connections) {
            const element = document.createElement("option")
            element.value = option.id
            element.textContent = option.label
            connection.appendChild(element)
          }

          connection.disabled = !message.hasConnections
          search.disabled = !message.hasConnections
          filters.disabled = !message.hasConnections

          if (message.connectionId) {
            connection.value = message.connectionId
          } else if (previousValue) {
            connection.value = previousValue
          }

          const typeCount = Array.isArray(message.typeFilter) ? message.typeFilter.length : 0
          filterInfo.textContent = typeCount > 0 ? pluralize(typeCount, "type filter") : "All types"
          if (!message.hasConnections) {
            status.textContent = "Mount an ABAP system to search"
            renderResults([])
          }
        }

        if (message.type === "results") {
          error.hidden = !message.error
          error.textContent = message.error || ""
          renderResults(message.items || [])

          if (message.busy) {
            status.textContent = "Searching..."
          } else if (message.error) {
            status.textContent = "Search failed"
          } else if (search.value.trim().length < 2) {
            status.textContent = "Type at least 2 characters"
          } else if ((message.items || []).length === 0) {
            status.textContent = "No matching objects"
          } else {
            status.textContent = pluralize(message.items.length, "object")
          }
        }
      })

      vscode.postMessage({ command: "ready" })
    </script>
  </body>
</html>`
  }
}

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let value = ""
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return value
}

function getSavedTypeFilter(): string[] {
  return context.globalState.get<string[]>(TYPE_FILTER_KEY) || []
}

const TYPE_FILTER_KEY = "abapfs.searchTypeFilter"

function getDisplayDescription(item: MySearchResult): string | undefined {
  const description = item.description?.trim()
  if (!description) return undefined
  return description === getObjectTypeLabel(item.type) ? undefined : description
}

function buildDetail(item: MySearchResult): string {
  const detailParts = [getObjectTypeLabel(item.type)]
  if (item.packageName) detailParts.push(`Package ${item.packageName}`)
  return detailParts.join(" • ")
}

function toSearchResultMessage(item: MySearchResult): SearchResultMessage {
  return {
    uri: item.uri,
    type: item.type,
    name: item.name,
    description: getDisplayDescription(item),
    detail: buildDetail(item)
  }
}

async function pickTypeFilter(): Promise<string[] | undefined> {
  const previousSelection = getSavedTypeFilter()
  const selected = await window.showQuickPick(
    OBJECT_TYPE_FILTER_OPTIONS.map(item => ({
      label: item.label,
      description: item.type,
      picked: previousSelection.includes(item.type),
      type: item.type
    })),
    {
      canPickMany: true,
      placeHolder: "Select object types for the sidebar search",
      title: "Object Search Filters",
      matchOnDescription: true
    }
  )

  if (!selected) return undefined
  if (selected.length === OBJECT_TYPE_FILTER_OPTIONS.length) return []
  return (selected as (QuickPickItem & { type: string })[]).map(item => item.type)
}

async function searchObjects(
  connectionId: string,
  query: string,
  typeFilter: string[]
): Promise<MySearchResult[]> {
  const raw = await getClient(connectionId).searchObject(query.toUpperCase() + "*", "")
  const filtered = typeFilter.length > 0
    ? raw.filter(result => typeFilter.includes(result["adtcore:type"]))
    : raw

  return MySearchResult.createResults(filtered, getClient(connectionId))
}