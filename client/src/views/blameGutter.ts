/**
 * Live Object Blame Gutter
 *
 * GitLens-style blame annotations for ABAP objects.
 * Shows who last changed each line, when, and in which transport.
 * Uses SAP version history and client-side diffing.
 */

import * as vscode from "vscode"
import { diffArrays } from "diff"
import { Revision } from "abap-adt-api"
import { AbapRevisionService } from "../scm/abaprevisions/abaprevisionservice"
import { abapUri, getClient, ADTSCHEME } from "../adt/conections"
import { setContext } from "../context"
import { log } from "../lib"

// ============================================================================
// TYPES
// ============================================================================

export interface BlameInfo {
  author: string
  date: string
  version: string // transport number
  versionTitle: string // transport description
  lineNumber: number // 0-based line in current source
}

interface BlameState {
  blame: BlameInfo[]
  uri: string // the document URI this blame was computed for
  latestRevisionDate: string
}

// ============================================================================
// MODULE STATE
// ============================================================================

let blameActiveUris = new Set<string>()
const blameCache = new Map<string, BlameState>()

// Decoration type — created once, reused
let blameDecorationType: vscode.TextEditorDecorationType | undefined

// Author color palette — subtle, translucent, works on both light and dark themes
const AUTHOR_COLORS = [
  "#4a9eff40",
  "#ff6b6b40",
  "#51cf6640",
  "#ffd93d40",
  "#c084fc40",
  "#ff9f4340",
  "#67e8f940",
  "#f472b640"
]

// ============================================================================
// BLAME ALGORITHM
// ============================================================================

/**
 * Compute blame attribution for each line of the current (newest) version.
 *
 * Algorithm — walks version history from newest to oldest:
 * 1. Start with all current lines as "pending" (unattributed).
 * 2. For each consecutive pair (newer, older):
 *    - diff older → newer (LCS-based via `diffArrays`)
 *    - Lines that are "added" in newer (not in older) → attribute to newer version
 *    - Lines that are "equal" → map their position in newer to their position in older
 *      and carry them forward as still-pending
 * 3. Any lines still pending after all pairs → attribute to oldest version.
 */
function computeBlame(revisions: Revision[], sources: string[]): BlameInfo[] {
  const currentLines = sources[0].split("\n")
  const blame: (BlameInfo | null)[] = new Array(currentLines.length).fill(null)

  // Map: currentLineIndex → lineIndex in the "newer" version being processed
  let pendingLines = new Map<number, number>()
  for (let i = 0; i < currentLines.length; i++) {
    pendingLines.set(i, i)
  }

  for (let v = 0; v < revisions.length - 1 && pendingLines.size > 0; v++) {
    const newerLines = sources[v].split("\n")
    const olderLines = sources[v + 1].split("\n")

    // diff(old, new) — added = in new only, removed = in old only
    const changes = diffArrays(olderLines, newerLines)

    // Build maps from this diff
    const addedInNewer = new Set<number>()
    const newerToOlder = new Map<number, number>()

    let newerIdx = 0
    let olderIdx = 0
    for (const change of changes) {
      const count = change.count ?? change.value.length
      if (!change.added && !change.removed) {
        // Equal chunk — lines exist in both
        for (let i = 0; i < count; i++) {
          newerToOlder.set(newerIdx + i, olderIdx + i)
        }
        newerIdx += count
        olderIdx += count
      } else if (change.added) {
        // Lines only in newer
        for (let i = 0; i < count; i++) {
          addedInNewer.add(newerIdx + i)
        }
        newerIdx += count
      } else {
        // Lines only in older (removed)
        olderIdx += count
      }
    }

    // Process pending lines
    const newPending = new Map<number, number>()
    for (const [currentLine, versionLine] of pendingLines) {
      if (addedInNewer.has(versionLine)) {
        // Line was introduced in this version
        blame[currentLine] = makeBlameInfo(revisions[v], currentLine)
      } else if (newerToOlder.has(versionLine)) {
        // Line exists in older version too — carry forward
        newPending.set(currentLine, newerToOlder.get(versionLine)!)
      } else {
        // Shouldn't happen, but attribute to this version as fallback
        blame[currentLine] = makeBlameInfo(revisions[v], currentLine)
      }
    }

    pendingLines = newPending
  }

  // Remaining unattributed lines → oldest version
  if (pendingLines.size > 0) {
    const oldest = revisions[revisions.length - 1]
    for (const [currentLine] of pendingLines) {
      blame[currentLine] = makeBlameInfo(oldest, currentLine)
    }
  }

  // Safety: fill any nulls (shouldn't happen)
  for (let i = 0; i < blame.length; i++) {
    if (!blame[i]) {
      blame[i] = {
        author: "Unknown",
        date: "",
        version: "",
        versionTitle: "",
        lineNumber: i
      }
    }
  }

  return blame as BlameInfo[]
}

function makeBlameInfo(rev: Revision, lineNumber: number): BlameInfo {
  return {
    author: rev.author || "Unknown",
    date: rev.date || "",
    version: rev.version || "",
    versionTitle: rev.versionTitle || "",
    lineNumber
  }
}

// ============================================================================
// DECORATION RENDERING
// ============================================================================

function ensureDecorationType(): vscode.TextEditorDecorationType {
  if (!blameDecorationType) {
    blameDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    })
  }
  return blameDecorationType
}

function colorForAuthor(author: string): string {
  let hash = 0
  for (const c of author) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length]
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return ""
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return dateStr
  }
}

function formatFullDate(dateStr: string): string {
  if (!dateStr) return "Unknown"
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  } catch {
    return dateStr
  }
}

function renderBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  const decType = ensureDecorationType()

  const decorations: vscode.DecorationOptions[] = []

  // Find the longest line so all annotations start at the same column
  let maxLineLen = 0
  const lineCount = Math.min(blame.length, editor.document.lineCount)
  for (let i = 0; i < lineCount; i++) {
    const len = editor.document.lineAt(i).text.length
    if (len > maxLineLen) maxLineLen = len
  }
  const targetCol = maxLineLen + 10

  for (let i = 0; i < lineCount; i++) {
    const info = blame[i]

    // Consecutive-line grouping: only show full annotation on first line of a block
    const isFirstInGroup =
      i === 0 || blame[i - 1].author !== info.author || blame[i - 1].version !== info.version

    const annotationText = isFirstInGroup
      ? `${info.author} · ${formatShortDate(info.date)} · ${info.version}${info.versionTitle ? ` — ${info.versionTitle}` : ""}`
      : "│"

    const borderColor = colorForAuthor(info.author)

    // Use margin in `ch` units to align all annotations to the same column
    // `ch` = width of the "0" character in the element's font, so it tracks the editor font
    const lineLen = editor.document.lineAt(i).text.length
    const gapCh = Math.max(4, targetCol - lineLen)

    // Hover tooltip with full detail
    const hover = new vscode.MarkdownString(
      `**${info.author}** · ${formatFullDate(info.date)}\n\n` +
        `Transport: \`${info.version}\`${info.versionTitle ? ` — *"${info.versionTitle}"*` : ""}`
    )
    hover.isTrusted = true

    const range = new vscode.Range(i, 0, i, 0)

    decorations.push({
      range,
      renderOptions: {
        before: {
          contentText: "\u200B", // zero-width space to make the element render
          backgroundColor: borderColor,
          width: "3px",
          height: "100%",
          margin: "0 6px 0 0"
        },
        after: {
          contentText: annotationText,
          color: new vscode.ThemeColor("editorCodeLens.foreground"),
          fontStyle: "italic",
          margin: `0 0 0 ${gapCh}ch`
        }
      },
      hoverMessage: hover
    })
  }

  editor.setDecorations(decType, decorations)
}

function clearBlameDecorations(editor?: vscode.TextEditor) {
  if (blameDecorationType && editor) {
    editor.setDecorations(blameDecorationType, [])
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Toggle blame ON → show annotations.
 * Called from the "Show Blame" editor/title button.
 */
export async function showBlame() {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== ADTSCHEME) return
  if (!abapUri(editor.document.uri)) return

  if (editor.document.isDirty) {
    vscode.window.showWarningMessage("Cannot show blame while the document has unsaved changes.")
    return
  }

  const uri = editor.document.uri
  const cacheKey = uri.toString()

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Computing blame...",
      cancellable: true
    },
    async (progress, token) => {
      try {
        const connId = uri.authority

        // Check cache
        const cached = blameCache.get(cacheKey)
        if (cached) {
          blameActiveUris.add(cacheKey)
          updateBlameContext(editor)
          renderBlameDecorations(editor, cached.blame)
          return
        }

        // Fetch revisions
        progress.report({ message: "Fetching version history..." })
        const service = AbapRevisionService.get(connId)
        const revisions = await service.uriRevisions(uri, true)

        if (token.isCancellationRequested) return

        if (!revisions || revisions.length === 0) {
          vscode.window.showInformationMessage(
            "No version history available for this object. Objects in $TMP that were never transported have no versions."
          )
          return
        }

        // Single version — all lines attributed to it
        if (revisions.length === 1) {
          const lines = editor.document.getText().split("\n")
          const blame: BlameInfo[] = lines.map((_, i) => makeBlameInfo(revisions[0], i))

          blameCache.set(cacheKey, {
            blame,
            uri: cacheKey,
            latestRevisionDate: revisions[0].date
          })

          blameActiveUris.add(cacheKey)
          updateBlameContext(editor)
          renderBlameDecorations(editor, blame)
          return
        }

        // Fetch source for each version, in parallel batches
        const client = getClient(connId)
        const sources: string[] = []
        const BATCH_SIZE = 5

        for (let i = 0; i < revisions.length; i += BATCH_SIZE) {
          if (token.isCancellationRequested) return

          const batch = revisions.slice(i, i + BATCH_SIZE)
          const end = Math.min(i + BATCH_SIZE, revisions.length)
          progress.report({
            message: `Fetching versions ${i + 1}–${end} of ${revisions.length}...`
          })
          const batchSources = await Promise.all(batch.map(r => client.getObjectSource(r.uri)))
          sources.push(...batchSources)
        }

        if (token.isCancellationRequested) return

        // Compute blame
        progress.report({ message: "Computing line attributions..." })
        const blame = computeBlame(revisions, sources)

        // Cache result
        blameCache.set(cacheKey, {
          blame,
          uri: cacheKey,
          latestRevisionDate: revisions[0].date
        })

        // Verify editor is still active and same document
        if (vscode.window.activeTextEditor !== editor) return

        blameActiveUris.add(cacheKey)
        updateBlameContext(editor)
        renderBlameDecorations(editor, blame)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`Blame computation failed: ${msg}`)
        vscode.window.showErrorMessage(`Failed to compute blame: ${msg}`)
      }
    }
  )
}

/**
 * Toggle blame OFF → hide annotations.
 * Called from the "Hide Blame" editor/title button.
 */
export async function hideBlame() {
  const editor = vscode.window.activeTextEditor
  if (editor) {
    const cacheKey = editor.document.uri.toString()
    blameActiveUris.delete(cacheKey)
    clearBlameDecorations(editor)
  }
  updateBlameContext(editor)
}

/**
 * Called when the active text editor changes.
 * Re-renders cached blame if the new editor has blame data, otherwise clears.
 */
export function onBlameActiveEditorChanged(editor?: vscode.TextEditor) {
  if (!editor || editor.document.uri.scheme !== ADTSCHEME) {
    updateBlameContext(editor)
    return
  }

  const cacheKey = editor.document.uri.toString()
  if (blameActiveUris.has(cacheKey)) {
    const cached = blameCache.get(cacheKey)
    if (cached) {
      renderBlameDecorations(editor, cached.blame)
    }
  }

  updateBlameContext(editor)
}

/**
 * Called when a document's content changes.
 * If blame is active and the document becomes dirty, auto-hide blame.
 */
export function onBlameDocumentChanged(event: vscode.TextDocumentChangeEvent) {
  if (event.document.uri.scheme !== ADTSCHEME) return

  const cacheKey = event.document.uri.toString()

  // If blame is active for this file and there are actual content changes, auto-hide
  if (blameActiveUris.has(cacheKey) && event.contentChanges.length > 0) {
    blameActiveUris.delete(cacheKey)
    const editor = vscode.window.activeTextEditor
    if (editor && editor.document === event.document) {
      clearBlameDecorations(editor)
      updateBlameContext(editor)
    }
  }

  // Always update the "Show Blame" button availability (handles dirty→clean transitions too)
  updateBlameAvailableForDocument(event.document)
}

/**
 * Called after a document is saved / activated.
 * Invalidates the blame cache for that object so next blame is fresh.
 */
export function onBlameDocumentSaved(document: vscode.TextDocument) {
  if (document.uri.scheme !== ADTSCHEME) return
  // Invalidate cache — the version history likely changed
  blameCache.delete(document.uri.toString())
  // Update button availability (doc should now be clean)
  const editor = vscode.window.activeTextEditor
  if (editor && editor.document === document) {
    updateBlameContext(editor)
  }
}

/**
 * Update both context keys for the current editor.
 * blameActive = is blame currently shown for THIS file?
 * blameAvailable = can blame be shown for THIS file?
 */
function updateBlameContext(editor?: vscode.TextEditor) {
  const isAbap =
    !!editor &&
    editor.document.uri.scheme === ADTSCHEME &&
    editor.document.languageId === "abap"

  const cacheKey = editor?.document.uri.toString() ?? ""
  const isBlameOn = isAbap && blameActiveUris.has(cacheKey)
  const canShowBlame = isAbap && !editor!.document.isDirty && !isBlameOn

  setContext("abapfs:blameActive", isBlameOn)
  setContext("abapfs:blameAvailable", canShowBlame)
}

function updateBlameAvailableForDocument(document: vscode.TextDocument) {
  const editor = vscode.window.activeTextEditor
  if (editor && editor.document === document) {
    updateBlameContext(editor)
  }
}

// ============================================================================
// INITIALIZATION & DISPOSAL
// ============================================================================

/**
 * Initialize the blame gutter feature.
 * Call from extension.ts activate().
 */
export function initializeBlameGutter(context: vscode.ExtensionContext) {
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.showBlame", showBlame),
    vscode.commands.registerCommand("abapfs.hideBlame", hideBlame)
  )

  // Invalidate blame cache when documents are saved (version history may change)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(onBlameDocumentSaved)
  )

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      blameDecorationType?.dispose()
      blameDecorationType = undefined
      blameCache.clear()
      blameActiveUris.clear()
    }
  })

  // Initialize context keys
  setContext("abapfs:blameActive", false)
  setContext("abapfs:blameAvailable", false)
}
