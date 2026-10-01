/**
 * Rich output for JS cells.
 *
 *   return display.table(rows, { wrap: true, highlight: true })
 *   return display.html('<h3>Hi</h3>')
 *   return display.markdown('# Title')
 *   return display.json(obj)
 *   return display.xml(objOrXmlString)
 *   return display.all(display.markdown('# A'), display.table(rows))
 *   return display.html(html, { data: rows })   // later cells receive `rows`
 *
 * The helpers return plain marker objects so they survive the worker's structured clone.
 */
import { type DisplayKind, type DisplayOptions, type DisplayValue } from "./types"

export const DISPLAY_MARKER = "__sapwbDisplay"
const KINDS: DisplayKind[] = ["html", "markdown", "json", "xml", "table", "text"]

type HelperOptions = DisplayOptions & { data?: unknown }

function make(kind: DisplayKind, content: unknown, opts?: HelperOptions): DisplayValue {
  const { data, ...options } = opts || {}
  const hasData = !!opts && Object.prototype.hasOwnProperty.call(opts, "data")
  return {
    [DISPLAY_MARKER]: kind,
    content,
    ...(Object.keys(options).length ? { options } : {}),
    ...(hasData ? { data, hasData: true } : {})
  } as DisplayValue
}

/** Object injected into the JS sandbox as `display`. */
export function createDisplayHelpers() {
  return {
    html: (html: unknown, opts?: HelperOptions) => make("html", String(html ?? ""), opts),
    markdown: (md: unknown, opts?: HelperOptions) => make("markdown", String(md ?? ""), opts),
    md: (md: unknown, opts?: HelperOptions) => make("markdown", String(md ?? ""), opts),
    json: (value: unknown, opts?: HelperOptions) => make("json", value, opts),
    xml: (value: unknown, opts?: HelperOptions) => make("xml", value, opts),
    table: (rows: unknown, opts?: HelperOptions) => make("table", rows, opts),
    text: (text: unknown, opts?: HelperOptions) => make("text", String(text ?? ""), opts),
    /** Several outputs in one cell; data for later cells = first item that carries data. */
    all: (...items: unknown[]) => items.filter(isDisplayValue)
  }
}

export function isDisplayValue(v: unknown): v is DisplayValue {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    KINDS.includes((v as Record<string, unknown>)[DISPLAY_MARKER] as DisplayKind)
  )
}

export function isDisplayList(v: unknown): v is DisplayValue[] {
  return Array.isArray(v) && v.length > 0 && v.every(isDisplayValue)
}

/**
 * Split a JS cell's return value into the data later cells see and the display (if any).
 * For display.table/json the data is the content; for html/markdown/xml/text it is the
 * content string unless `data` was passed explicitly.
 */
export function splitDisplay(value: unknown): {
  data: unknown
  display?: DisplayValue | DisplayValue[]
} {
  if (isDisplayValue(value)) return { data: dataOf(value), display: value }
  if (isDisplayList(value)) {
    const withData = value.find(v => v.hasData) ?? value.find(v => v[DISPLAY_MARKER] === "table")
    return { data: withData ? dataOf(withData) : dataOf(value[0]), display: value }
  }
  return { data: value }
}

function dataOf(d: DisplayValue): unknown {
  return d.hasData ? d.data : d.content
}

// ---------------------------------------------------------------- XML utilities

export function escapeXml(s: unknown): string {
  return (
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  )
}

export function xmlName(raw: string): string {
  let n = String(raw).replace(/[^A-Za-z0-9_.-]/g, "_")
  if (!/^[A-Za-z_]/.test(n)) n = "_" + n
  if (/^xml/i.test(n)) n = "_" + n
  return n || "_"
}

/** Convert any JS value to indented XML. Arrays become repeated <item> (or <row> for tables). */
export function toXml(value: unknown, root = "result", indent = ""): string {
  const tag = xmlName(root)
  const inner = indent + "  "
  if (value === null || value === undefined) return `${indent}<${tag}/>`
  if (value instanceof Date || Object.prototype.toString.call(value) === "[object Date]")
    return `${indent}<${tag}>${escapeXml(formatScalar(value))}</${tag}>`
  if (Array.isArray(value)) {
    const itemTag = value.every(v => typeof v === "object" && v !== null && !Array.isArray(v))
      ? "row"
      : "item"
    if (value.length === 0) return `${indent}<${tag}/>`
    return `${indent}<${tag}>\n${value.map(v => toXml(v, itemTag, inner)).join("\n")}\n${indent}</${tag}>`
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return `${indent}<${tag}/>`
    return `${indent}<${tag}>\n${entries.map(([k, v]) => toXml(v, k, inner)).join("\n")}\n${indent}</${tag}>`
  }
  return `${indent}<${tag}>${escapeXml(formatScalar(value))}</${tag}>`
}

/** Light pretty-printer for an XML string (one element per line, 2-space indent). */
export function prettyXml(xml: string): string {
  const tokens = xml
    .replace(/>\s+</g, "><")
    .trim()
    .split(/(<[^>]+>)/)
    .filter(t => t.length)
  let depth = 0
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^<\//.test(t)) {
      depth = Math.max(0, depth - 1)
      out.push("  ".repeat(depth) + t)
    } else if (/^<[^!?][^>]*[^/]>$/.test(t) || /^<[A-Za-z_][^>]*>$/.test(t)) {
      // opening tag; keep <a>text</a> on one line
      const text = tokens[i + 1]
      const close = tokens[i + 2]
      if (text && !text.startsWith("<") && close && close.startsWith("</")) {
        out.push("  ".repeat(depth) + t + text + close)
        i += 2
      } else if (/\/>$/.test(t)) {
        out.push("  ".repeat(depth) + t)
      } else {
        out.push("  ".repeat(depth) + t)
        depth++
      }
    } else {
      out.push("  ".repeat(depth) + t)
    }
  }
  return out.join("\n")
}

export function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date || Object.prototype.toString.call(v) === "[object Date]") {
    const d = v as Date
    if (isNaN(d.getTime())) return ""
    const iso = d.toISOString()
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(".000Z", "Z")
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

// ---------------------------------------------------------------- status highlighting

export type StatusKind = "red" | "yellow" | "green" | "info"

const STATUS_WORDS: Record<string, StatusKind> = {
  RED: "red",
  FAIL: "red",
  ERROR: "red",
  CRITICAL: "red",
  YELLOW: "yellow",
  WARN: "yellow",
  WARNING: "yellow",
  GREEN: "green",
  PASS: "green",
  OK: "green",
  MATCH: "green",
  INFO: "info"
}

/** RED/YELLOW/GREEN-style status of a cell value ("[PASS]" style brackets allowed). */
export function statusKind(v: unknown): StatusKind | undefined {
  if (typeof v !== "string") return undefined
  return STATUS_WORDS[
    v
      .trim()
      .replace(/^\[\s*|\s*\]$/g, "")
      .toUpperCase()
  ]
}

export const STATUS_COLORS: Record<StatusKind, string> = {
  red: "F8C9CE",
  yellow: "FFE9A8",
  green: "C8E6C9",
  info: "CDEBF0"
}
