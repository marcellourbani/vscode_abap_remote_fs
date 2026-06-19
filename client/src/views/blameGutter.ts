/**
 * Live Object Blame Gutter
 *
 * File-wide blame annotations for ABAP objects.
 * Supports the original inline view and a GitLens-inspired blame lane.
 * Uses SAP version history and client-side diffing.
 */

import * as vscode from "vscode"
import { diffArrays } from "diff"
import { Revision } from "abap-adt-api"
import { AbapRevisionService } from "../scm/abaprevisions/abaprevisionservice"
import { abapUri, getClient, ADTSCHEME } from "../adt/conections"
import { setContext } from "../context"
import { log } from "../lib"
import { logTelemetry } from "../services/telemetry"
import { funWindow as window } from "../services/funMessenger"

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

type BlameRenderMode = "classic" | "gitlens"

interface BlameState {
  blame: BlameInfo[]
  uri: string
  latestRevisionDate: string
}

interface ComputedHeatmap {
  coldThresholdTimestamp: number
  colors: { hot: string[]; cold: string[] }
  computeRelativeAge(date: Date): number
}

// ============================================================================
// MODULE STATE
// ============================================================================

const BLAME_RENDER_MODE_SETTING = "blame.renderMode"
const DEFAULT_BLAME_RENDER_MODE: BlameRenderMode = "gitlens"

const GITLENS_MESSAGE_WIDTH = 58
const GITLENS_AGE_WIDTH = 8
const GITLENS_GUTTER_WIDTH = `calc(${GITLENS_MESSAGE_WIDTH + GITLENS_AGE_WIDTH + 3}ch + 13px)`
const DEFAULT_HEATMAP_AGE_THRESHOLD_DAYS = 90
const NBSP = "\u00A0"
const ZERO_WIDTH_SPACE = "\u200B"

const GITLENS_GUTTER_BACKGROUND_COLOR = "abapfs.blameGutterBackgroundColor"
const GITLENS_GUTTER_FOREGROUND_COLOR = "abapfs.blameGutterForegroundColor"
const GITLENS_LINE_HIGHLIGHT_BACKGROUND_COLOR = "abapfs.blameLineHighlightBackgroundColor"
const GITLENS_LINE_HIGHLIGHT_OVERVIEW_COLOR = "abapfs.blameLineHighlightOverviewRulerColor"
const GITLENS_TRAILING_LINE_BACKGROUND_COLOR = "abapfs.blameTrailingLineBackgroundColor"
const GITLENS_TRAILING_LINE_FOREGROUND_COLOR = "abapfs.blameTrailingLineForegroundColor"
const MAX_EDITOR_COLUMN = 2 ** 30 - 1
const REVISION_FETCH_BATCH_SIZE = 5
const REVISION_FETCH_CONCURRENCY = 3

const DEFAULT_HEATMAP_COLORS = [
  "#f66a0a",
  "#ef6939",
  "#e96950",
  "#e26862",
  "#db6871",
  "#d3677e",
  "#cc678a",
  "#c46696",
  "#bb66a0",
  "#b365a9",
  "#a965b3",
  "#a064bb",
  "#9664c4",
  "#8a63cc",
  "#7e63d3",
  "#7162db",
  "#6262e2",
  "#5061e9",
  "#3961ef",
  "#0a60f6"
]

const AUTHOR_COLORS = [
  "#4a9eff",
  "#ff6b6b",
  "#51cf66",
  "#ffd93d",
  "#c084fc",
  "#ff9f43",
  "#67e8f9",
  "#f472b6"
]

let blameActiveUris = new Set<string>()
const blameCache = new Map<string, BlameState>()

let classicBlameDecorationType: vscode.TextEditorDecorationType | undefined
let classicSelectedLineDecorationType: vscode.TextEditorDecorationType | undefined
let gitlensLeaderDecorationType: vscode.TextEditorDecorationType | undefined
let gitlensCompactDecorationType: vscode.TextEditorDecorationType | undefined
let blameHighlightDecorationType: vscode.TextEditorDecorationType | undefined
let gitlensSelectedLineDecorationType: vscode.TextEditorDecorationType | undefined

// ============================================================================
// BLAME ALGORITHM
// ============================================================================

/**
 * Compute blame attribution for each line of the current (newest) version.
 *
 * Algorithm - walks version history from newest to oldest:
 * 1. Start with all current lines as "pending" (unattributed).
 * 2. For each consecutive pair (newer, older):
 *    - diff older -> newer (LCS-based via `diffArrays`)
 *    - Lines that are "added" in newer (not in older) -> attribute to newer version
 *    - Lines that are "equal" -> map their position in newer to their position in older
 *      and carry them forward as still-pending
 * 3. Any lines still pending after all pairs -> attribute to oldest version.
 */
function computeBlame(revisions: Revision[], sources: string[]): BlameInfo[] {
  const currentLines = sources[0].split("\n")
  const blame: (BlameInfo | null)[] = new Array(currentLines.length).fill(null)

  // Map: currentLineIndex -> lineIndex in the "newer" version being processed
  let pendingLines = new Map<number, number>()
  for (let i = 0; i < currentLines.length; i++) {
    pendingLines.set(i, i)
  }

  for (let v = 0; v < revisions.length - 1 && pendingLines.size > 0; v++) {
    const newerLines = sources[v].split("\n")
    const olderLines = sources[v + 1].split("\n")

    // diff(old, new) - added = in new only, removed = in old only
    const changes = diffArrays(olderLines, newerLines)

    // Build maps from this diff
    const addedInNewer = new Set<number>()
    const newerToOlder = new Map<number, number>()

    let newerIdx = 0
    let olderIdx = 0
    for (const change of changes) {
      const count = change.count ?? change.value.length
      if (!change.added && !change.removed) {
        // Equal chunk - lines exist in both
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
        // Line exists in older version too - carry forward
        newPending.set(currentLine, newerToOlder.get(versionLine)!)
      } else {
        // Fallback: attribute to the newer version if mapping is ambiguous
        blame[currentLine] = makeBlameInfo(revisions[v], currentLine)
      }
    }

    pendingLines = newPending
  }

  // Remaining unattributed lines -> oldest version
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

function getBlameRenderMode(): BlameRenderMode {
  const mode = vscode.workspace
    .getConfiguration("abapfs")
    .get<string>(BLAME_RENDER_MODE_SETTING, DEFAULT_BLAME_RENDER_MODE)

  return mode === "classic" ? "classic" : "gitlens"
}

function toCssInjection(styles: Record<string, string | number | undefined | null>): string {
  const textDecoration = styles["text-decoration"] ?? "none"
  return `text-decoration:${textDecoration};${Object.entries(styles)
    .filter(([key, value]) => key !== "text-decoration" && value != null && value !== "")
    .map(([key, value]) => `${key}:${value}`)
    .join(";")};`
}

function ensureClassicDecorationType(): vscode.TextEditorDecorationType {
  if (!classicBlameDecorationType) {
    classicBlameDecorationType = window.createTextEditorDecorationType({
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    })
  }
  return classicBlameDecorationType
}

function ensureClassicSelectedLineDecorationType(): vscode.TextEditorDecorationType {
  if (!classicSelectedLineDecorationType) {
    classicSelectedLineDecorationType = window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
        textDecoration: toCssInjection({
          "white-space": "pre",
          "font-variant-numeric": "tabular-nums"
        })
      }
    })
  }
  return classicSelectedLineDecorationType
}

function getGitLensBaseOptions(
  separator: boolean
): vscode.ThemableDecorationAttachmentRenderOptions {
  return {
    backgroundColor: new vscode.ThemeColor(GITLENS_GUTTER_BACKGROUND_COLOR),
    color: new vscode.ThemeColor(GITLENS_GUTTER_FOREGROUND_COLOR),
    fontWeight: "normal",
    fontStyle: "normal",
    height: "100%",
    margin: "0 26px -1px 0",
    width: GITLENS_GUTTER_WIDTH,
    textDecoration: toCssInjection({
      "text-decoration": separator ? "overline solid rgba(0, 0, 0, .2)" : undefined,
      "box-sizing": "border-box",
      padding: "0 0 0 18px",
      "border-style": "solid",
      "border-width": "0 2px 0 0",
      "white-space": "pre",
      "font-variant-numeric": "tabular-nums"
    })
  }
}

function ensureGitLensLeaderDecorationType(): vscode.TextEditorDecorationType {
  if (!gitlensLeaderDecorationType) {
    gitlensLeaderDecorationType = window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
      before: getGitLensBaseOptions(false)
    })
  }
  return gitlensLeaderDecorationType
}

function ensureGitLensCompactDecorationType(): vscode.TextEditorDecorationType {
  if (!gitlensCompactDecorationType) {
    gitlensCompactDecorationType = window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
      before: getGitLensBaseOptions(false)
    })
  }
  return gitlensCompactDecorationType
}

function ensureBlameHighlightDecorationType(): vscode.TextEditorDecorationType {
  if (!blameHighlightDecorationType) {
    blameHighlightDecorationType = window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      backgroundColor: new vscode.ThemeColor(GITLENS_LINE_HIGHLIGHT_BACKGROUND_COLOR),
      overviewRulerColor: new vscode.ThemeColor(GITLENS_LINE_HIGHLIGHT_OVERVIEW_COLOR)
    })
  }
  return blameHighlightDecorationType
}

function ensureGitLensSelectedLineDecorationType(): vscode.TextEditorDecorationType {
  if (!gitlensSelectedLineDecorationType) {
    gitlensSelectedLineDecorationType = window.createTextEditorDecorationType({
      after: {
        backgroundColor: new vscode.ThemeColor(GITLENS_TRAILING_LINE_BACKGROUND_COLOR),
        color: new vscode.ThemeColor(GITLENS_TRAILING_LINE_FOREGROUND_COLOR),
        textDecoration: toCssInjection({
          "white-space": "pre",
          "font-variant-numeric": "tabular-nums"
        })
      }
    })
  }
  return gitlensSelectedLineDecorationType
}

function accentColorForAuthor(author: string): string {
  let hash = 0
  for (const c of author) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length]
}

function translucentColor(color: string, alphaHex: string): string {
  return `${color}${alphaHex}`
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  const parsed = Number.parseInt(normalized, 16)
  const r = (parsed >> 16) & 255
  const g = (parsed >> 8) & 255
  const b = parsed & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function getHeatmapColors(): { hot: string[]; cold: string[] } {
  return {
    hot: DEFAULT_HEATMAP_COLORS.slice(0, 10),
    cold: DEFAULT_HEATMAP_COLORS.slice(10, 20)
  }
}

function getRelativeAgeLookupTable(dates: Date[]): number[] {
  if (dates.length === 0) return []

  // Mirror GitLens' lookup-table approach so heatmap steps cluster around the median age.
  const lookup: number[] = []
  const half = Math.floor(dates.length / 2)
  const median =
    dates.length % 2
      ? dates[half].getTime()
      : (dates[half - 1].getTime() + dates[half].getTime()) / 2

  const newest = dates[dates.length - 1].getTime()
  let step = (newest - median) / 5
  for (let i = 5; i > 0; i--) {
    lookup.push(median + step * i)
  }

  lookup.push(median)

  const oldest = dates[0].getTime()
  step = (median - oldest) / 4
  for (let i = 1; i <= 4; i++) {
    lookup.push(median - step * i)
  }

  return lookup
}

function getComputedHeatmap(blame: BlameInfo[]): ComputedHeatmap | undefined {
  const dates = blame
    .map(line => new Date(line.date))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())

  if (dates.length === 0) return undefined

  const coldThresholdDate = new Date()
  coldThresholdDate.setDate(coldThresholdDate.getDate() - DEFAULT_HEATMAP_AGE_THRESHOLD_DAYS)
  const coldThresholdTimestamp = coldThresholdDate.getTime()

  const hotDates: Date[] = []
  const coldDates: Date[] = []

  for (const date of dates) {
    if (date.getTime() < coldThresholdTimestamp) {
      coldDates.push(date)
    } else {
      hotDates.push(date)
    }
  }

  const unifiedLookup = getRelativeAgeLookupTable(dates)
  const hotLookup = hotDates.length > 0 ? getRelativeAgeLookupTable(hotDates) : unifiedLookup
  const coldLookup = coldDates.length > 0 ? getRelativeAgeLookupTable(coldDates) : unifiedLookup

  const computeRelativeAge = (date: Date, lookup: number[]) => {
    if (lookup.length === 0) return 0

    const time = date.getTime()
    let index = 0
    for (let i = 0; i < lookup.length; i++) {
      index = i
      if (time >= lookup[i]) break
    }
    return index
  }

  return {
    coldThresholdTimestamp,
    colors: getHeatmapColors(),
    computeRelativeAge: (date: Date) =>
      computeRelativeAge(date, date.getTime() < coldThresholdTimestamp ? coldLookup : hotLookup)
  }
}

function applyHeatmap(
  before: vscode.ThemableDecorationAttachmentRenderOptions,
  dateStr: string,
  heatmap?: ComputedHeatmap
) {
  if (!heatmap) return

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return

  const age = heatmap.computeRelativeAge(date)
  const colors = date.getTime() < heatmap.coldThresholdTimestamp ? heatmap.colors.cold : heatmap.colors.hot
  const color = colors[Math.min(age, colors.length - 1)]
  const alpha = age === 0 ? 1 : age <= 5 ? 0.8 : 0.6

  before.borderColor = hexToRgba(color, alpha)
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

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "unknown"

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "unknown"

  const deltaMs = Date.now() - date.getTime()
  const isFuture = deltaMs < 0
  const absMs = Math.abs(deltaMs)
  const units = [
    { label: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { label: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { label: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { label: "day", ms: 24 * 60 * 60 * 1000 },
    { label: "hour", ms: 60 * 60 * 1000 },
    { label: "minute", ms: 60 * 1000 }
  ]

  if (absMs < 60 * 1000) return "just now"

  for (const unit of units) {
    if (absMs >= unit.ms || unit.label === "minute") {
      const value = Math.max(1, Math.round(absMs / unit.ms))
      const suffix = value === 1 ? "" : "s"
      return isFuture ? `in ${value} ${unit.label}${suffix}` : `${value} ${unit.label}${suffix} ago`
    }
  }

  return "unknown"
}

function formatCompactRelativeDate(dateStr: string): string {
  if (!dateStr) return "?"

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "?"

  const deltaMs = Math.abs(Date.now() - date.getTime())
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (deltaMs < hour) return `${Math.max(1, Math.round(deltaMs / minute))}m ago`
  if (deltaMs < day) return `${Math.max(1, Math.round(deltaMs / hour))}h ago`
  if (deltaMs < week) return `${Math.max(1, Math.round(deltaMs / day))}d ago`
  if (deltaMs < month) return `${Math.max(1, Math.round(deltaMs / week))}w ago`
  if (deltaMs < year) return `${Math.max(1, Math.round(deltaMs / month))}mo ago`
  return `${Math.max(1, Math.round(deltaMs / year))}y ago`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function buildHoverMessage(info: BlameInfo): vscode.MarkdownString {
  const relativeAge = formatRelativeDate(info.date)
  const transportText = info.version || "Unknown"
  const detailText = info.versionTitle ? ` - *\"${info.versionTitle}\"*` : ""

  const hover = new vscode.MarkdownString(
    `**${info.author}** - ${formatFullDate(info.date)}` +
      `\n\nAge: ${relativeAge}` +
      `\n\nTransport: \`${transportText}\`${detailText}`
  )
  hover.isTrusted = true
  return hover
}

function buildGitLensSummary(info: BlameInfo): string {
  const summary =
    normalizeWhitespace(
      info.version
        ? `${info.version}${info.versionTitle ? `, ${info.versionTitle}` : ""}`
        : info.versionTitle || info.author
    ) || "Unknown change"

  return truncateText(summary, GITLENS_MESSAGE_WIDTH)
}

function getBlameGroupKey(info: BlameInfo): string {
  return `${info.author}:${info.version}`
}

function getWholeLineRange(editor: vscode.TextEditor, line: number): vscode.Range {
  const range = new vscode.Range(line, 0, line, MAX_EDITOR_COLUMN)
  if (typeof editor.document.validateRange === "function") {
    return editor.document.validateRange(range)
  }

  return new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length)
}

function clearBlameHighlights(editor?: vscode.TextEditor) {
  if (!editor || !blameHighlightDecorationType) return
  editor.setDecorations(blameHighlightDecorationType, [])
}

function clearSelectedLineAnnotation(editor?: vscode.TextEditor) {
  if (!editor) return
  if (classicSelectedLineDecorationType) editor.setDecorations(classicSelectedLineDecorationType, [])
  if (gitlensSelectedLineDecorationType) editor.setDecorations(gitlensSelectedLineDecorationType, [])
}

function updateBlameHighlights(editor: vscode.TextEditor, blame: BlameInfo[], line?: number) {
  const decorationType = ensureBlameHighlightDecorationType()
  if (line == null || line < 0 || line >= blame.length) {
    editor.setDecorations(decorationType, [])
    return
  }

  const selected = blame[line]
  if (!selected) {
    editor.setDecorations(decorationType, [])
    return
  }

  const selectedKey = getBlameGroupKey(selected)
  const ranges: vscode.Range[] = []
  const lineCount = Math.min(blame.length, editor.document.lineCount)

  for (let index = 0; index < lineCount; index++) {
    if (getBlameGroupKey(blame[index]) !== selectedKey) continue
    ranges.push(getWholeLineRange(editor, index))
  }

  editor.setDecorations(decorationType, ranges)
}

function buildGitLensLaneText(info: BlameInfo): string {
  const summary = buildGitLensSummary(info).padEnd(GITLENS_MESSAGE_WIDTH, " ")
  const age = truncateText(formatCompactRelativeDate(info.date), GITLENS_AGE_WIDTH).padStart(
    GITLENS_AGE_WIDTH,
    " "
  )

  return ` ${summary} ${age} `
}

function buildSelectedLineText(info: BlameInfo): string {
  const change = info.version
    ? `${info.version}${info.versionTitle ? ` - ${info.versionTitle}` : ""}`
    : info.versionTitle || "Unknown change"
  return `${info.author}, ${formatRelativeDate(info.date)} • ${change}`
}

function getAvatarInitials(author: string): string {
  const parts = author
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function buildAvatarRenderOptions(author: string): vscode.ThemableDecorationAttachmentRenderOptions {
  const initials = getAvatarInitials(author)
  const accent = accentColorForAuthor(author)
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'>` +
      `<circle cx='8' cy='8' r='8' fill='${accent}'/>` +
      `<text x='8' y='8' fill='#ffffff' font-family='Segoe UI, sans-serif' font-size='7' font-weight='700' text-anchor='middle' dominant-baseline='central'>${initials}</text>` +
      `</svg>`
  )

  return {
    contentText: "",
    height: "16px",
    width: "16px",
    textDecoration: toCssInjection({
      position: "absolute",
      top: "1px",
      left: "5px",
      background: `url("data:image/svg+xml;utf8,${svg}")`,
      "background-repeat": "no-repeat",
      "background-size": "16px 16px",
      "border-radius": "50%",
      "margin-left": "0 !important"
    })
  }
}

function updateSelectedLineAnnotation(editor: vscode.TextEditor, blame: BlameInfo[], line?: number) {
  if (line == null || line < 0 || line >= blame.length) {
    clearSelectedLineAnnotation(editor)
    return
  }

  if (getBlameRenderMode() === "classic") {
    const decorationType = ensureClassicSelectedLineDecorationType()
    const lineText = editor.document.lineAt(line).text
    editor.setDecorations(decorationType, [
      {
        range: new vscode.Range(line, lineText.length, line, lineText.length),
        renderOptions: {
          after: {
            contentText: `  ${buildSelectedLineText(blame[line])}  `
          }
        }
      }
    ])
    if (gitlensSelectedLineDecorationType) {
      editor.setDecorations(gitlensSelectedLineDecorationType, [])
    }
    return
  }

  const decorationType = ensureGitLensSelectedLineDecorationType()
  const lineText = editor.document.lineAt(line).text
  editor.setDecorations(decorationType, [
    {
      range: new vscode.Range(line, lineText.length, line, lineText.length),
      renderOptions: {
        after: {
          contentText: buildSelectedLineText(blame[line])
        }
      }
    }
  ])
}

function renderClassicBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  ensureClassicSelectedLineDecorationType()
  const decType = ensureClassicDecorationType()
  const decorations: vscode.DecorationOptions[] = []

  // Find the longest line so all annotations start at the same column.
  let maxLineLen = 0
  const lineCount = Math.min(blame.length, editor.document.lineCount)
  for (let i = 0; i < lineCount; i++) {
    const len = editor.document.lineAt(i).text.length
    if (len > maxLineLen) maxLineLen = len
  }
  const targetCol = maxLineLen + 10

  for (let i = 0; i < lineCount; i++) {
    const info = blame[i]

    // Consecutive-line grouping: only show the full annotation on the first line of a block.
    const isFirstInGroup =
      i === 0 || blame[i - 1].author !== info.author || blame[i - 1].version !== info.version

    const annotationText = isFirstInGroup
      ? `${info.author} - ${formatShortDate(info.date)} - ${info.version}${info.versionTitle ? ` - ${info.versionTitle}` : ""}`
      : "|"

    // Use margin in `ch` units so the annotation tracks the editor font width.
    const lineLen = editor.document.lineAt(i).text.length
    const gapCh = Math.max(4, targetCol - lineLen)

    decorations.push({
      range: new vscode.Range(i, 0, i, 0),
      renderOptions: {
        before: {
          contentText: ZERO_WIDTH_SPACE,
          backgroundColor: translucentColor(accentColorForAuthor(info.author), "40"),
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
      hoverMessage: buildHoverMessage(info)
    })
  }

  editor.setDecorations(decType, decorations)
}

function renderGitLensBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  const leaderType = ensureGitLensLeaderDecorationType()
  const compactType = ensureGitLensCompactDecorationType()
  const leaderDecorations: vscode.DecorationOptions[] = []
  const compactDecorations: vscode.DecorationOptions[] = []
  const heatmap = getComputedHeatmap(blame)
  const lineCount = Math.min(blame.length, editor.document.lineCount)

  let previousKey: string | undefined
  for (let i = 0; i < lineCount; i++) {
    const info = blame[i]
    const key = `${info.author}:${info.version}`
    const range = new vscode.Range(i, 0, i, 0)
    const hoverMessage = buildHoverMessage(info)

    // Compact followers reuse the blame lane styling but omit the summary text.
    if (previousKey === key) {
      const before: vscode.ThemableDecorationAttachmentRenderOptions = { contentText: NBSP }
      applyHeatmap(before, info.date, heatmap)

      compactDecorations.push({
        range,
        renderOptions: { before },
        hoverMessage
      })
      continue
    }

    previousKey = key

    // Leader lines carry the summary text, age, and small avatar marker.
    const before: vscode.ThemableDecorationAttachmentRenderOptions = {
      contentText: buildGitLensLaneText(info)
    }
    if (i > 0) {
      before.textDecoration = "overline solid rgba(0, 0, 0, .2)"
    }
    applyHeatmap(before, info.date, heatmap)

    leaderDecorations.push({
      range,
      renderOptions: {
        before,
        after: buildAvatarRenderOptions(info.author)
      },
      hoverMessage
    })
  }

  editor.setDecorations(leaderType, leaderDecorations)
  editor.setDecorations(compactType, compactDecorations)
}

function renderBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  clearBlameDecorations(editor)

  // Switch render strategy by configuration while keeping the same blame data/cache.
  if (getBlameRenderMode() === "gitlens") {
    renderGitLensBlameDecorations(editor, blame)
    return
  }

  renderClassicBlameDecorations(editor, blame)
}

function clearBlameDecorations(editor?: vscode.TextEditor) {
  if (!editor) return
  if (classicBlameDecorationType) editor.setDecorations(classicBlameDecorationType, [])
  if (gitlensLeaderDecorationType) editor.setDecorations(gitlensLeaderDecorationType, [])
  if (gitlensCompactDecorationType) editor.setDecorations(gitlensCompactDecorationType, [])
  clearSelectedLineAnnotation(editor)
}

function disposeBlameDecorationTypes() {
  classicBlameDecorationType?.dispose()
  classicSelectedLineDecorationType?.dispose()
  gitlensLeaderDecorationType?.dispose()
  gitlensCompactDecorationType?.dispose()
  blameHighlightDecorationType?.dispose()
  gitlensSelectedLineDecorationType?.dispose()
  classicBlameDecorationType = undefined
  classicSelectedLineDecorationType = undefined
  gitlensLeaderDecorationType = undefined
  gitlensCompactDecorationType = undefined
  blameHighlightDecorationType = undefined
  gitlensSelectedLineDecorationType = undefined
}

function rerenderVisibleBlameEditors() {
  for (const editor of window.visibleTextEditors) {
    if (editor.document.uri.scheme !== ADTSCHEME || editor.document.languageId !== "abap") continue

    const cacheKey = editor.document.uri.toString()
    if (!blameActiveUris.has(cacheKey)) continue

    const cached = blameCache.get(cacheKey)
    if (cached) {
      renderBlameDecorations(editor, cached.blame)
      updateSelectedLineAnnotation(editor, cached.blame, editor.selection.active.line)
    }
  }
}

async function fetchRevisionSources(
  client: ReturnType<typeof getClient>,
  revisions: Revision[],
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<string[] | undefined> {
  const totalBatches = Math.ceil(revisions.length / REVISION_FETCH_BATCH_SIZE)
  const batchResults: string[][] = new Array(totalBatches)
  const workerCount = Math.min(REVISION_FETCH_CONCURRENCY, totalBatches)

  let nextBatchIndex = 0
  let completedVersions = 0

  const runWorker = async () => {
    while (!token.isCancellationRequested) {
      const batchIndex = nextBatchIndex++
      // nextBatchIndex is 0-based and post-incremented, so equality means there are no batches left.
      if (batchIndex >= totalBatches) return

      const start = batchIndex * REVISION_FETCH_BATCH_SIZE
      const batch = revisions.slice(start, start + REVISION_FETCH_BATCH_SIZE)
      const batchSources = await Promise.all(batch.map(revision => client.getObjectSource(revision.uri)))

      if (token.isCancellationRequested) return

      batchResults[batchIndex] = batchSources
      completedVersions += batch.length

      progress.report({
        increment: (batch.length / revisions.length) * 100,
        message: `Fetched ${completedVersions} of ${revisions.length} versions...`
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  if (token.isCancellationRequested) return undefined

  return batchResults.flat()
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Toggle blame ON -> show annotations.
 * Called from the "Show Blame" editor/title button.
 */
export async function showBlame() {
  logTelemetry("command_show_blame_called")
  const editor = window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== ADTSCHEME) return
  if (!abapUri(editor.document.uri)) return

  if (editor.document.isDirty) {
    window.showWarningMessage("Cannot show blame while the document has unsaved changes.")
    return
  }

  const uri = editor.document.uri
  const cacheKey = uri.toString()

  await window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Computing blame...",
      cancellable: true
    },
    async (progress, token) => {
      try {
        const connId = uri.authority

        // Check cache first so re-opening blame is instant.
        const cached = blameCache.get(cacheKey)
        if (cached) {
          blameActiveUris.add(cacheKey)
          updateBlameContext(editor)
          renderBlameDecorations(editor, cached.blame)
          updateSelectedLineAnnotation(editor, cached.blame, editor.selection.active.line)
          return
        }

        // Fetch version history for the object.
        progress.report({ message: "Fetching version history..." })
        const service = AbapRevisionService.get(connId)
        const revisions = await service.uriRevisions(uri, true)

        if (token.isCancellationRequested) return

        if (!revisions || revisions.length === 0) {
          window.showInformationMessage(
            "No version history available for this object. Objects in $TMP that were never transported have no versions."
          )
          return
        }

        // Single version: attribute every line to that version.
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
          updateBlameHighlights(editor, blame, editor.selection.active.line)
          updateSelectedLineAnnotation(editor, blame, editor.selection.active.line)
          return
        }

        // Fetch source for each version in small parallel batches.
        const client = getClient(connId)
        const sources = await fetchRevisionSources(client, revisions, progress, token)

        if (token.isCancellationRequested || sources == null) return

        // Compute final line attribution and cache it for future toggles.
        progress.report({ message: "Computing line attributions..." })
        const blame = computeBlame(revisions, sources)

        blameCache.set(cacheKey, {
          blame,
          uri: cacheKey,
          latestRevisionDate: revisions[0].date
        })

        // The active editor may have changed while blame was loading.
        if (window.activeTextEditor !== editor) return

        blameActiveUris.add(cacheKey)
        updateBlameContext(editor)
        renderBlameDecorations(editor, blame)
        updateBlameHighlights(editor, blame, editor.selection.active.line)
        updateSelectedLineAnnotation(editor, blame, editor.selection.active.line)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`Blame computation failed: ${msg}`)
        window.showErrorMessage(`Failed to compute blame: ${msg}`)
      }
    }
  )
}

/**
 * Toggle blame OFF -> hide annotations.
 * Called from the "Hide Blame" editor/title button.
 */
export async function hideBlame() {
  logTelemetry("command_hide_blame_called")
  const editor = window.activeTextEditor
  if (editor) {
    const cacheKey = editor.document.uri.toString()
    blameActiveUris.delete(cacheKey)
    clearBlameDecorations(editor)
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
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
      updateBlameHighlights(editor, cached.blame, editor.selection.active.line)
      updateSelectedLineAnnotation(editor, cached.blame, editor.selection.active.line)
    }
  } else {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
  }

  updateBlameContext(editor)
}

/**
 * Called when the selection changes inside an editor that may have blame active.
 * Highlights every line that belongs to the same blame group as the selected line.
 */
export function onBlameTextEditorSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
  const editor = event.textEditor
  if (editor.document.uri.scheme !== ADTSCHEME || editor.document.languageId !== "abap") {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
    return
  }

  const cacheKey = editor.document.uri.toString()
  if (!blameActiveUris.has(cacheKey)) {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
    return
  }

  const cached = blameCache.get(cacheKey)
  if (!cached) {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
    return
  }

  updateBlameHighlights(editor, cached.blame, event.selections[0]?.active.line)
  updateSelectedLineAnnotation(editor, cached.blame, event.selections[0]?.active.line)
}

/**
 * Called when the blame render mode configuration changes.
 * Re-renders visible editors that already have blame enabled.
 */
export function onBlameConfigurationChanged(event: vscode.ConfigurationChangeEvent) {
  if (!event.affectsConfiguration(`abapfs.${BLAME_RENDER_MODE_SETTING}`)) return
  disposeBlameDecorationTypes()
  rerenderVisibleBlameEditors()
}

/**
 * Called when a document's content changes.
 * If blame is active and the document becomes dirty, auto-hide blame.
 */
export function onBlameDocumentChanged(event: vscode.TextDocumentChangeEvent) {
  if (event.document.uri.scheme !== ADTSCHEME) return

  const cacheKey = event.document.uri.toString()

  // If blame is active for this file and there are actual content changes, auto-hide it.
  if (blameActiveUris.has(cacheKey) && event.contentChanges.length > 0) {
    blameActiveUris.delete(cacheKey)
    const editor = window.activeTextEditor
    if (editor && editor.document === event.document) {
      clearBlameDecorations(editor)
      clearBlameHighlights(editor)
      updateBlameContext(editor)
    }
  }

  // Always update the "Show Blame" button availability.
  updateBlameAvailableForDocument(event.document)
}

/**
 * Called after a document is saved / activated.
 * Invalidates the blame cache for that object so the next blame is fresh.
 */
export function onBlameDocumentSaved(document: vscode.TextDocument) {
  if (document.uri.scheme !== ADTSCHEME) return

  // Invalidate cache - version history may have changed.
  blameCache.delete(document.uri.toString())
  const editor = window.activeTextEditor
  if (editor && editor.document === document) {
    updateBlameContext(editor)
  }
}

/**
 * Update both context keys for the current editor.
 * blameActive = is blame currently shown for this file?
 * blameAvailable = can blame be shown for this file?
 */
function updateBlameContext(editor?: vscode.TextEditor) {
  const isAbap =
    !!editor && editor.document.uri.scheme === ADTSCHEME && editor.document.languageId === "abap"

  const cacheKey = editor?.document.uri.toString() ?? ""
  const isBlameOn = isAbap && blameActiveUris.has(cacheKey)
  const canShowBlame = isAbap && !editor?.document.isDirty && !isBlameOn

  setContext("abapfs:blameActive", isBlameOn)
  setContext("abapfs:blameAvailable", canShowBlame)
}

function updateBlameAvailableForDocument(document: vscode.TextDocument) {
  const editor = window.activeTextEditor
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
  // Register commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.showBlame", showBlame),
    vscode.commands.registerCommand("abapfs.hideBlame", hideBlame)
  )

  // Invalidate the blame cache when documents are saved, and re-render when the mode changes.
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onBlameDocumentSaved))
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onBlameConfigurationChanged))
  context.subscriptions.push(window.onDidChangeTextEditorSelection(onBlameTextEditorSelectionChanged))

  // Clean up decoration types and cached state on deactivate.
  context.subscriptions.push({
    dispose: () => {
      disposeBlameDecorationTypes()
      blameCache.clear()
      blameActiveUris.clear()
    }
  })

  // Initialize context keys used by the toolbar/menu visibility rules.
  setContext("abapfs:blameActive", false)
  setContext("abapfs:blameAvailable", false)
}