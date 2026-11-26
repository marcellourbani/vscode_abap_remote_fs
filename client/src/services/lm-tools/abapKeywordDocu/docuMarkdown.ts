import { decodeHTML } from "entities"
import {
  type DocuElement,
  type DocuNode,
  classList,
  cleanDocuTree,
  collapseWhitespace,
  descendants,
  docuTopicId,
  hasClass,
  isElement,
  parseDocuHtml,
  serializeDocu,
  textOf
} from "./docuHtml"

export interface DocuHit {
  topicId: string
  title: string
  group?: string
}

export interface DocuLink {
  topicId: string
  title: string
  parent: boolean
}

export type DocuPage =
  | { kind: "hits"; hits: DocuHit[]; html: string }
  | { kind: "empty"; message: string; html: string }
  | {
      kind: "topic"
      topicId?: string
      markdown: string
      links: DocuLink[]
      complete: boolean
      html: string
    }

interface RenderState {
  links: Map<string, DocuLink>
  selfId?: string
  inPath: boolean
  inTable: boolean
}

const BLOCK_TAGS = new Set([
  "#root",
  "address",
  "article",
  "blockquote",
  "body",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figure",
  "footer",
  "form",
  "header",
  "html",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
])
const HEADING = /^h([1-6])$/

function headingLevel(node: DocuElement) {
  const byTag = HEADING.exec(node.tag)
  if (byTag) return Number(byTag[1])
  for (const name of classList(node)) {
    const byClass = HEADING.exec(name)
    if (byClass) return Number(byClass[1])
  }
}

const isCodeLike = (node: DocuElement) =>
  ["code", "tt", "kbd"].includes(node.tag) || classList(node).some(name => name.startsWith("qtext"))

const hasLineBreak = (node: DocuElement) => [...descendants(node)].some(child => child.tag === "br")

function isBlock(node: DocuElement, state: RenderState) {
  if (BLOCK_TAGS.has(node.tag) || headingLevel(node) !== undefined) return true
  return !state.inTable && isCodeLike(node) && hasLineBreak(node)
}

const inlineText = (text: string) => text.replace(/[ \t\r\n\f]+/g, " ")

function tidyInline(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function wrap(text: string, mark: string, padding = "") {
  const core = text.trim()
  if (!core) return text
  return text.replace(core, () => `${mark}${padding}${core}${padding}${mark}`)
}

function noteLink(anchor: DocuElement, state: RenderState) {
  const topicId = docuTopicId(anchor.attrs.href)
  if (!topicId || topicId === state.selfId) return
  if (topicId.endsWith("_GLOSRY")) return
  const known = state.links.get(topicId)
  if (known) {
    known.parent ||= state.inPath
    return
  }
  const title = collapseWhitespace(textOf(anchor)) || topicId
  state.links.set(topicId, { topicId, title, parent: state.inPath })
}

function codeText(node: DocuNode, state: RenderState, preserve: boolean): string {
  if (!isElement(node)) {
    const text = preserve ? node.text : node.text.replace(/[ \t\r\n\f]+/g, " ")
    return text.replace(/\u00a0/g, " ")
  }
  if (node.tag === "br" || node.tag === "hr") return "\n"
  if (node.tag === "a") noteLink(node, state)
  const keep = preserve || node.tag === "pre"
  const inner = node.children.map(child => codeText(child, state, keep)).join("")
  const isLine = BLOCK_TAGS.has(node.tag) || headingLevel(node) !== undefined
  return isLine ? `\n${inner}\n` : inner
}

function renderCodeBlock(node: DocuElement, state: RenderState): string[] {
  const lines = codeText(node, state, node.tag === "pre")
    .split("\n")
    .map(line => line.trimEnd())
    .filter((line, index, all) => line || (index > 0 && all[index - 1]))
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return []
  if (node.tag !== "pre") lines[0] = lines[0].trimStart()
  const code = lines.join("\n")
  const fence = code.includes("```") ? "~~~~" : "```"
  return [`${fence}\n${code}\n${fence}`]
}

function renderInlineCode(node: DocuElement, state: RenderState) {
  const code = codeText(node, state, false).replace(/\n/g, " ").replace(/ {2,}/g, " ")
  const runs = code.match(/`+/g) ?? []
  const fence = "`".repeat(1 + runs.reduce((max, run) => Math.max(max, run.length), 0))
  return wrap(code, fence, runs.length ? " " : "")
}

function renderInlineChildren(node: DocuElement, state: RenderState) {
  return node.children
    .map(child => (isElement(child) ? renderInline(child, state) : inlineText(child.text)))
    .join("")
}

function renderInline(node: DocuElement, state: RenderState): string {
  if (node.tag === "br") return state.inTable ? " " : "\n"
  if (node.tag === "a") {
    noteLink(node, state)
    return renderInlineChildren(node, state)
  }
  if (hasClass(node, "path")) {
    const wasInPath = state.inPath
    state.inPath = true
    const text = renderInlineChildren(node, state)
    state.inPath = wasInPath
    return text
  }
  if (node.tag === "i" && hasClass(node, "bn")) return renderInlineChildren(node, state)
  if (isCodeLike(node)) return renderInlineCode(node, state)
  const inner = renderInlineChildren(node, state)
  if (node.tag === "b" || node.tag === "strong" || hasClass(node, "bold")) return wrap(inner, "**")
  if (node.tag === "i" || node.tag === "em") return wrap(inner, "*")
  if (BLOCK_TAGS.has(node.tag) || headingLevel(node) !== undefined) return ` ${inner} `
  return inner
}

function renderList(list: DocuElement, state: RenderState): string[] {
  const items: string[] = []
  let number = 0
  for (const child of list.children) {
    if (!isElement(child)) {
      const text = tidyInline(inlineText(child.text))
      if (text) items.push(`- ${text}`)
      continue
    }
    const nested = child.tag === "ul" || child.tag === "ol"
    const body = (child.tag === "li" ? renderBlocks(child, state) : renderBlock(child, state)).join(
      "\n"
    )
    if (!body) continue
    const marker = nested ? "" : list.tag === "ol" ? `${++number}.` : "-"
    const pad = " ".repeat(marker ? marker.length + 1 : 2)
    const lines = body.split("\n").map((line, index) => {
      if (index === 0 && marker) return `${marker} ${line}`
      return line ? `${pad}${line}` : line
    })
    items.push(lines.join("\n"))
  }
  return items.length ? [items.join("\n")] : []
}

function tableRows(node: DocuElement): DocuElement[] {
  const rows: DocuElement[] = []
  for (const child of node.children) {
    if (!isElement(child) || child.tag === "table") continue
    if (child.tag === "tr") rows.push(child)
    else rows.push(...tableRows(child))
  }
  return rows
}

function renderTable(table: DocuElement, state: RenderState): string[] {
  for (const child of descendants(table)) {
    if (
      child.tag === "caption" ||
      child.tag === "table" ||
      child.attrs.colspan ||
      child.attrs.rowspan
    ) {
      for (const link of descendants(table)) if (link.tag === "a") noteLink(link, state)
      return [serializeDocu(table)]
    }
  }
  const wasInTable = state.inTable
  state.inTable = true
  const rows = tableRows(table)
    .map(row =>
      row.children
        .filter(isElement)
        .filter(cell => cell.tag === "td" || cell.tag === "th")
        .map(cell =>
          renderBlocks(cell, state)
            .join(" ")
            .replace(/\s*\n\s*/g, " ")
            .replace(/\|/g, "\\|")
            .trim()
        )
    )
    .filter(cells => cells.length)
  state.inTable = wasInTable
  if (!rows.length) return []
  const width = Math.max(...rows.map(cells => cells.length))
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`
  return [[line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")]
}

function renderBlock(node: DocuElement, state: RenderState): string[] {
  const level = headingLevel(node)
  if (level) {
    const text = tidyInline(renderInlineChildren(node, state)).replace(/\s*\n\s*/g, " ")
    return text ? [`${"#".repeat(level)} ${text}`] : []
  }
  if (node.tag === "pre" || isCodeLike(node)) return renderCodeBlock(node, state)
  if (node.tag === "ul" || node.tag === "ol") return renderList(node, state)
  if (node.tag === "table") return renderTable(node, state)
  if (node.tag === "li") return renderList({ ...node, tag: "ul", children: [node] }, state)
  return renderBlocks(node, state)
}

function renderBlocks(node: DocuElement, state: RenderState): string[] {
  const blocks: string[] = []
  let inline = ""
  const flush = () => {
    const text = tidyInline(inline)
    if (text) blocks.push(text)
    inline = ""
  }
  for (const child of node.children) {
    if (!isElement(child)) inline += inlineText(child.text)
    else if (isBlock(child, state)) {
      flush()
      blocks.push(...renderBlock(child, state))
    } else inline += renderInline(child, state)
  }
  flush()
  return blocks
}

export function retainsContent(source: string, rendered: string): boolean {
  const output = rendered.replace(/\s/g, "")
  let offset = 0
  for (const character of source.replace(/\s/g, "")) {
    const index = output.indexOf(character, offset)
    if (index === -1) return false
    offset = index + character.length
  }
  return true
}

function pageTopicId(root: DocuElement) {
  for (const node of descendants(root)) {
    if (node.tag !== "option") continue
    const topicId = docuTopicId(node.attrs.value)
    if (topicId) return topicId
  }
}

function readHits(root: DocuElement): DocuHit[] {
  const hits: DocuHit[] = []
  const seen = new Set<string>()
  let group: string | undefined
  const nodes = [...descendants(root)]
  const hasBreadcrumb = nodes.some(node => hasClass(node, "path"))
  const hasIndexHeading = nodes.some(node => hasClass(node, "h3"))
  const hasTopicLinks = nodes.some(node => node.tag === "a" && docuTopicId(node.attrs.href))
  const legacySearchResults = !hasBreadcrumb && hasIndexHeading && hasTopicLinks
  for (const node of nodes) {
    if (HEADING.test(node.tag) || (legacySearchResults && node.tag === "b"))
      group = collapseWhitespace(textOf(node)) || group
    if (hasClass(node, "tab")) {
      for (const anchor of descendants(node)) addHit(anchor)
    } else if (legacySearchResults && node.tag === "a") addHit(node)
  }
  return hits

  function addHit(anchor: DocuElement) {
    const topicId = docuTopicId(anchor.attrs.href)
    if (!topicId) return
    const title = collapseWhitespace(textOf(anchor)) || topicId
    const key = `${topicId}\u0000${title}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ topicId, title, group })
  }
}

const looksLikeTopic = (root: DocuElement) =>
  [...descendants(root)].some(
    node => hasClass(node, "path") || headingLevel(node) !== undefined || hasClass(node, "h1")
  )

/** Classifies an ABAP keyword documentation page and converts topics to Markdown. */
export function readDocuPage(rawHtml: string, currentTopicId?: string): DocuPage {
  const root = parseDocuHtml(rawHtml)
  const topicId = currentTopicId?.toUpperCase() ?? pageTopicId(root)
  cleanDocuTree(root)
  const html = serializeDocu(root).trim()
  const hits = readHits(root)
  if (hits.length) return { kind: "hits", hits, html }
  if (!looksLikeTopic(root))
    return { kind: "empty", message: collapseWhitespace(textOf(root)), html }
  const state: RenderState = { links: new Map(), selfId: topicId, inPath: false, inTable: false }
  const markdown = renderBlocks(root, state)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  const complete = retainsContent(textOf(root), decodeHTML(markdown))
  return { kind: "topic", topicId, markdown, links: [...state.links.values()], complete, html }
}
