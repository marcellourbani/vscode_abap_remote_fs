import { decodeHTML, decodeHTMLAttribute, escapeAttribute, escapeText } from "entities"

export interface DocuText {
  type: "text"
  text: string
}

export interface DocuElement {
  type: "element"
  tag: string
  attrs: Record<string, string>
  children: DocuNode[]
}

export type DocuNode = DocuText | DocuElement

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
])
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"])
const CLOSES_PARAGRAPH = new Set([
  "address",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul"
])
const PARAGRAPH_SCOPE = new Set(["#root", "html", "body", "div", "li", "td", "th", "blockquote"])
const CHROME_TAGS = new Set([
  "head",
  "script",
  "style",
  "img",
  "select",
  "noscript",
  "svg",
  "button",
  "input",
  "meta",
  "link",
  "title"
])
const KEPT_ATTRIBUTES = new Set(["href", "class", "title", "colspan", "rowspan"])
const PUBLIC_DOCU_PATH = "/sap/public/bc/abap/docu"

const TAG_PATTERN =
  /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)[^>]*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g
const ATTRIBUTE_PATTERN = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const element = (tag: string, attrs: Record<string, string> = {}): DocuElement => ({
  type: "element",
  tag,
  attrs,
  children: []
})

function parseAttributes(text: string) {
  const attrs: Record<string, string> = {}
  for (const match of text.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase()
    if (name in attrs) continue
    attrs[name] = decodeHTMLAttribute(match[2] ?? match[3] ?? match[4] ?? "")
  }
  return attrs
}

/** Lenient HTML parser: never throws, keeps all text, recovers from unclosed tags. */
export function parseDocuHtml(html: string): DocuElement {
  const root = element("#root")
  const stack: DocuElement[] = [root]
  const lower = html.toLowerCase()
  const pattern = new RegExp(TAG_PATTERN.source, "g")
  const top = () => stack[stack.length - 1]
  const addText = (raw: string) => {
    if (raw) top().children.push({ type: "text", text: decodeHTML(raw) })
  }
  const closeOpen = (isTarget: (tag: string) => boolean, isBoundary: (tag: string) => boolean) => {
    for (let index = stack.length - 1; index > 0; index--) {
      const tag = stack[index].tag
      if (isTarget(tag)) {
        stack.length = index
        return
      }
      if (isBoundary(tag)) return
    }
  }
  const closeImplied = (tag: string) => {
    if (tag === "li")
      closeOpen(
        open => open === "li",
        open => open === "ul" || open === "ol"
      )
    if (tag === "td" || tag === "th")
      closeOpen(
        open => open === "td" || open === "th",
        open => open === "tr" || open === "table"
      )
    if (tag === "tr")
      closeOpen(
        open => open === "tr",
        open => open === "table"
      )
    if (CLOSES_PARAGRAPH.has(tag))
      closeOpen(
        open => open === "p",
        open => PARAGRAPH_SCOPE.has(open)
      )
  }

  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    addText(html.slice(last, match.index))
    last = pattern.lastIndex
    const [, closing, opening, attrText, selfClosing] = match
    if (closing) {
      const tag = closing.toLowerCase()
      closeOpen(
        open => open === tag,
        () => false
      )
      continue
    }
    if (!opening) continue
    const tag = opening.toLowerCase()
    closeImplied(tag)
    const node = element(tag, parseAttributes(attrText))
    top().children.push(node)
    if (RAW_TEXT_TAGS.has(tag)) {
      const end = lower.indexOf(`</${tag}`, last)
      const stop = end < 0 ? html.length : end
      node.children.push({ type: "text", text: html.slice(last, stop) })
      const close = end < 0 ? -1 : html.indexOf(">", end)
      last = close < 0 ? html.length : close + 1
      pattern.lastIndex = last
      continue
    }
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node)
  }
  addText(html.slice(last))
  return root
}

export const isElement = (node: DocuNode): node is DocuElement => node.type === "element"

export const classList = (node: DocuElement) =>
  (node.attrs.class ?? "").split(/\s+/).filter(Boolean)

export const hasClass = (node: DocuElement, name: string) => classList(node).includes(name)

export function* descendants(node: DocuElement): Generator<DocuElement> {
  for (const child of node.children) {
    if (!isElement(child)) continue
    yield child
    yield* descendants(child)
  }
}

/** Text content with a space at every element boundary, so adjacent cells never merge into one word. */
export function textOf(node: DocuNode): string {
  if (!isElement(node)) return node.text
  return ` ${node.children.map(textOf).join("")} `
}

export const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()

export function docuTopicId(href: string | undefined): string | undefined {
  if (!href) return
  let url: URL
  try {
    url = new URL(href, "https://sap.invalid")
  } catch {
    return
  }
  if (!href.trim().toLowerCase().startsWith("adtcom:") && url.pathname !== PUBLIC_DOCU_PATH) return
  const topicId = url.searchParams.get("object")?.trim()
  return topicId ? topicId.toUpperCase() : undefined
}

function isChrome(node: DocuElement) {
  if (CHROME_TAGS.has(node.tag) || hasClass(node, "topnav")) return true
  return node.tag === "a" && !!node.attrs.href?.trim().toLowerCase().startsWith("mailto:")
}

/** Removes page chrome (styles, scripts, images, navigation bar, feedback links, empty anchors). */
export function cleanDocuTree(node: DocuElement) {
  node.children = node.children.filter(child => {
    if (!isElement(child)) return true
    if (isChrome(child)) return false
    cleanDocuTree(child)
    return child.tag !== "a" || textOf(child).trim() !== ""
  })
}

export function serializeDocu(node: DocuNode): string {
  if (!isElement(node)) return escapeText(node.text)
  const inner = node.children.map(serializeDocu).join("")
  if (node.tag === "#root") return inner
  const attrs = Object.entries(node.attrs)
    .filter(([name]) => KEPT_ATTRIBUTES.has(name))
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("")
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}
