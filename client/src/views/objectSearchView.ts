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
import { RecentObject, addRecent, clearRecent, getRecent } from "../adt/operations/recentObjects"

/** Shape sent to the webview — display strings plus canonical data for storage. */
type SearchResultMessage = {
  uri: string
  type: string
  name: string
  description?: string
  detail?: string
  packageName?: string
  typeLabel?: string
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
          if (message.connectionId && message.connectionId !== this.currentConnId) {
            this.currentConnId = message.connectionId
            await this.postState()
          }
          await this.search(message.query || "", message.connectionId)
          break
        case "open":
          if (message.connectionId && message.uri) {
            await addRecent(message.connectionId, {
              uri: message.uri,
              type: message.objectType || "",
              name: message.name || "",
              packageName: message.packageName || "",
              description: message.description
            })
            await this.postState()
            await openObject(message.connectionId, message.uri, message.objectType)
          }
          break
        case "changeTypes":
          await this.changeTypes(message.connectionId, message.query || "")
          break
        case "clearHistory":
          if (message.connectionId) {
            await clearRecent(message.connectionId)
            await this.postState()
          }
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
    const recentObjects: SearchResultMessage[] = connectionId
      ? getRecent(connectionId).map(recentToSearchResultMessage)
      : []

    await this.view.webview.postMessage({
      type: "state",
      connections,
      connectionId,
      typeFilter,
      hasConnections: connections.length > 0,
      recentObjects
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
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .toolbar {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
      }

      select,
      input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, transparent);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 2px 4px;
        font-family: inherit;
        font-size: 12px;
        height: 20px;
      }

      button {
        width: auto;
        cursor: pointer;
      }

      .iconButton {
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, transparent);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        width: auto;
        min-width: 20px;
        height: 20px;
        padding: 0 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-family: inherit;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
      }

      .iconButton svg {
        width: 12px;
        height: 12px;
        fill: currentColor;
        display: block;
      }

      .badge {
        background-color: var(--vscode-badge-background, #007acc);
        color: var(--vscode-badge-foreground, #ffffff);
        border-radius: 8px;
        font-size: 9px;
        font-weight: bold;
        line-height: 1;
        padding: 1px 4px;
        min-width: 8px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .hint {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .search-area {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        padding: 4px 2px 0 2px;
        margin: 0;
      }

      .results {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .result {
        padding: 2px 2px;
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
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
      }

      .headline {
        display: flex;
        align-items: baseline;
        gap: 4px;
      }

      .desc,
      .detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.2;
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

      .section-header-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 2px 2px 2px 2px;
      }

      .section-header {
        font-size: 11px;
        text-transform: uppercase;
        font-weight: bold;
        color: var(--vscode-descriptionForeground);
        margin: 0;
        letter-spacing: 0.5px;
      }

      .search-container {
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
        margin-bottom: 4px;
      }

      .search-container input {
        padding-right: 24px;
      }

      .clear-btn,
      .clear-history-btn {
        background: transparent;
        border: none;
        padding: 0;
        width: auto;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        opacity: 0.6;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: bold;
        line-height: 1;
        font-family: var(--vscode-font-family);
      }

      .clear-btn {
        position: absolute;
        right: 6px;
        top: 0;
        bottom: 0;
        height: 100%;
        margin: 0;
      }

      .clear-history-btn {
        height: auto;
      }

      .clear-btn:hover,
      .clear-history-btn:hover {
        opacity: 1;
        color: var(--vscode-foreground);
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
          <span id="filterBadge" class="badge" style="display: none;"></span>
        </button>
      </div>
      <div class="search-area">
        <div class="search-container">
          <input id="search" type="text" placeholder="Search ABAP objects">
          <button id="clearSearch" class="clear-btn" type="button" title="Clear Search Query" aria-label="Clear Search Query" style="display: none;">&times;</button>
        </div>
        <div id="error" class="error" hidden></div>
        <div id="recentHeaderContainer" class="section-header-container" style="display: none;">
          <span class="section-header">Recent Objects</span>
          <button id="clearHistory" class="clear-history-btn" type="button" title="Clear Recent Objects History" aria-label="Clear Recent Objects History">&times;</button>
        </div>
        <ul id="recentList" class="results" style="display: none;"></ul>
        <ul id="results" class="results"></ul>
        <div class="meta">
          <span id="status">Type at least 2 characters</span>
        </div>
      </div>
      <div class="hint">Manage filters with the filter button in the toolbar.</div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi()
      const connection = document.getElementById("connection")
      const search = document.getElementById("search")
      const results = document.getElementById("results")
      const error = document.getElementById("error")
      const status = document.getElementById("status")
      const filterBadge = document.getElementById("filterBadge")
      const filters = document.getElementById("filters")
      const recentHeaderContainer = document.getElementById("recentHeaderContainer")
      const recentList = document.getElementById("recentList")
      const clearSearch = document.getElementById("clearSearch")
      const clearHistory = document.getElementById("clearHistory")
      let searchTimer
      let currentConnectionId = undefined
      let recentItems = []

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

      const renderList = (container, items) => {
        container.textContent = ""

        if (!items || !items.length) {
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
              objectType: item.type,
              name: item.name,
              packageName: item.packageName || "",
              typeLabel: item.typeLabel || "",
              description: item.description,
              detail: item.detail
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
          container.appendChild(li)
        }
      }

      const updateListVisibility = () => {
        const query = search.value.trim()
        clearSearch.style.display = search.value ? "flex" : "none"
        if (query.length < 2) {
          results.style.display = "none"
          if (recentItems && recentItems.length > 0) {
            recentHeaderContainer.style.display = "flex"
            recentList.style.display = "block"
            status.textContent = "Recent objects"
          } else {
            recentHeaderContainer.style.display = "none"
            recentList.style.display = "none"
            status.textContent = "Type at least 2 characters"
          }
        } else {
          results.style.display = "block"
          recentHeaderContainer.style.display = "none"
          recentList.style.display = "none"
        }
      }

      search.addEventListener("input", () => {
        updateListVisibility()
        clearTimeout(searchTimer)
        searchTimer = setTimeout(postSearch, 200)
      })

      clearSearch.addEventListener("click", () => {
        search.value = ""
        updateListVisibility()
        clearTimeout(searchTimer)
        postSearch()
      })

      clearHistory.addEventListener("click", () => {
        vscode.postMessage({
          command: "clearHistory",
          connectionId: currentConnectionId
        })
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
          if (typeCount > 0) {
            filterBadge.textContent = typeCount
            filterBadge.style.display = "flex"
            filters.title = "Select object type filters (" + typeCount + " active)"
          } else {
            filterBadge.style.display = "none"
            filters.title = "Select object type filters"
          }
          
          recentItems = message.recentObjects || []
          renderList(recentList, recentItems)
          updateListVisibility()

          if (!message.hasConnections) {
            status.textContent = "Mount an ABAP system to search"
            renderList(results, [])
          }
        }

        if (message.type === "results") {
          error.hidden = !message.error
          error.textContent = message.error || ""
          renderList(results, message.items || [])
          updateListVisibility()

          if (message.busy) {
            status.textContent = "Searching..."
          } else if (message.error) {
            status.textContent = "Search failed"
          } else if (search.value.trim().length < 2) {
            updateListVisibility()
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
    detail: buildDetail(item),
    packageName: item.packageName || "",
    typeLabel: getObjectTypeLabel(item.type)
  }
}

function recentToSearchResultMessage(item: RecentObject): SearchResultMessage {
  const typeLabel = getObjectTypeLabel(item.type)
  return {
    uri: item.uri,
    type: item.type,
    name: item.name,
    description: item.description,
    detail: item.packageName ? `${typeLabel} • Package ${item.packageName}` : typeLabel,
    packageName: item.packageName,
    typeLabel
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
  const filtered =
    typeFilter.length > 0 ? raw.filter(result => typeFilter.includes(result["adtcore:type"])) : raw

  return MySearchResult.createResults(filtered, getClient(connectionId))
}
