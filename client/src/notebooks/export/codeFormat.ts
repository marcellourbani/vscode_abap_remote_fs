/**
 * Code blocks in exports: language labels and a small, dependency-free syntax highlighter for
 * ABAP SQL, JavaScript, JSON and XML. Writers turn the tokens into HTML spans, Word runs, etc.
 */

export type CodeLang = "sql" | "javascript" | "json" | "xml" | "text"
export type TokenKind = "kw" | "str" | "com" | "num" | "var" | "tag" | "plain"
export interface Token {
  text: string
  kind: TokenKind
}

export const LANG_LABEL: Record<CodeLang, string> = {
  sql: "ABAP SQL",
  javascript: "JavaScript",
  json: "JSON",
  xml: "XML",
  text: "Text"
}

/** Markdown fence info string per language (what GitHub / VS Code highlight). */
export const FENCE_LANG: Record<CodeLang, string> = {
  sql: "sql",
  javascript: "javascript",
  json: "json",
  xml: "xml",
  text: "text"
}

/** Colours (hex, print-friendly on white) per token kind. */
export const TOKEN_COLORS: Record<TokenKind, string> = {
  kw: "0B4F9C",
  str: "A31515",
  com: "6A737D",
  num: "098658",
  var: "8E24AA",
  tag: "22863A",
  plain: "1F2328"
}

const SQL_KEYWORDS = new Set(
  (
    "SELECT FROM WHERE AND OR NOT IN AS INNER LEFT RIGHT OUTER CROSS JOIN ON ORDER BY GROUP HAVING " +
    "ASCENDING DESCENDING DISTINCT UP TO ROWS COUNT SUM MIN MAX AVG CASE WHEN THEN ELSE END LIKE " +
    "BETWEEN IS NULL EXISTS UNION ALL WITH SINGLE INTO TABLE FIELDS OFFSET CAST COALESCE ESCAPE ANY SOME"
  ).split(" ")
)
const JS_KEYWORDS = new Set(
  (
    "const let var function return if else for while do of in new try catch finally throw await " +
    "async typeof instanceof true false null undefined class extends break continue switch case " +
    "default delete void this"
  ).split(" ")
)

export function langOf(language: string | undefined): CodeLang {
  if (language === "sql" || language === "abap-sql") return "sql"
  if (language === "javascript" || language === "js") return "javascript"
  if (language === "json" || language === "xml") return language
  return "text"
}

/** Tokenize code into lines of tokens. Multi-line block comments / template strings are handled. */
export function tokenize(code: string, lang: CodeLang): Token[][] {
  const lines = code.replace(/\r\n?/g, "\n").split("\n")
  if (lang === "text") return lines.map(l => [{ text: l, kind: "plain" }])
  if (lang === "xml") return lines.map(tokenizeXmlLine)
  const state = { inBlock: false, inTemplate: false }
  return lines.map(l => tokenizeLine(l, lang, state))
}

function push(out: Token[], text: string, kind: TokenKind) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ text, kind })
}

function tokenizeLine(
  line: string,
  lang: CodeLang,
  state: { inBlock: boolean; inTemplate: boolean }
): Token[] {
  const out: Token[] = []
  let i = 0
  const n = line.length
  while (i < n) {
    if (state.inBlock) {
      const end = line.indexOf("*/", i)
      const stop = end < 0 ? n : end + 2
      push(out, line.slice(i, stop), "com")
      i = stop
      if (end >= 0) state.inBlock = false
      continue
    }
    if (state.inTemplate) {
      i = readTemplate(line, i, out, state)
      continue
    }
    const ch = line[i]
    const rest = line.slice(i)
    // ${...} interpolation (SQL cells) — highlight as a variable
    if (lang === "sql" && rest.startsWith("${")) {
      const end = line.indexOf("}", i)
      const stop = end < 0 ? n : end + 1
      push(out, line.slice(i, stop), "var")
      i = stop
      continue
    }
    if (lang === "javascript" && rest.startsWith("//")) {
      push(out, rest, "com")
      break
    }
    if (lang === "sql" && (rest.startsWith("--") || (ch === "*" && i === 0) || ch === '"')) {
      push(out, rest, "com")
      break
    }
    if (lang === "javascript" && rest.startsWith("/*")) {
      state.inBlock = true
      push(out, "/*", "com")
      i += 2
      continue
    }
    if (ch === "'" || (ch === '"' && lang !== "sql")) {
      const stop = readQuoted(line, i, ch)
      push(out, line.slice(i, stop), "str")
      i = stop
      continue
    }
    if (ch === "`" && lang === "javascript") {
      push(out, "`", "str")
      state.inTemplate = true
      i = readTemplate(line, i + 1, out, state)
      continue
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z_$]/.test(line[i - 1] ?? "")) {
      const m = /^[0-9][0-9_.eExXa-fA-F]*/.exec(rest)!
      push(out, m[0], "num")
      i += m[0].length
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(rest)!
      const word = m[0]
      const isKw =
        lang === "sql"
          ? SQL_KEYWORDS.has(word.toUpperCase())
          : lang === "javascript"
            ? JS_KEYWORDS.has(word)
            : word === "true" || word === "false" || word === "null"
      push(out, word, isKw ? "kw" : "plain")
      i += word.length
      continue
    }
    push(out, ch, "plain")
    i++
  }
  return out
}

function readQuoted(line: string, start: number, q: string): number {
  let i = start + 1
  while (i < line.length) {
    if (line[i] === "\\" && q !== "'") {
      i += 2
      continue
    }
    if (line[i] === q) {
      // ABAP SQL escapes a quote by doubling it
      if (q === "'" && line[i + 1] === "'") {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return line.length
}

function readTemplate(
  line: string,
  start: number,
  out: Token[],
  state: { inBlock: boolean; inTemplate: boolean }
): number {
  let i = start
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2
      continue
    }
    if (line[i] === "`") {
      push(out, line.slice(start, i + 1), "str")
      state.inTemplate = false
      return i + 1
    }
    i++
  }
  push(out, line.slice(start), "str")
  return line.length
}

function tokenizeXmlLine(line: string): Token[] {
  const out: Token[] = []
  const re = /(<!--.*?-->)|(<\/?[\w:.-]+)|("[^"]*"|'[^']*')|(\/?>)|([^<"']+|.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m[1]) push(out, m[1], "com")
    else if (m[2]) push(out, m[2], "tag")
    else if (m[3]) push(out, m[3], "str")
    else if (m[4]) push(out, m[4], "tag")
    else push(out, m[5] ?? m[0], "plain")
  }
  return out
}

/** Header shown above an exported code block: "ABAP SQL · s1_define · erp100". */
export function codeCaption(lang: CodeLang, name?: string, system?: string): string {
  return [LANG_LABEL[lang], name, system].filter(Boolean).join(" · ")
}

/** Code language of an export item: code cells, and json/xml/text results. undefined = not code. */
export function itemCodeLang(i: {
  kind: string
  language?: string
  contentType?: string
  table?: unknown
}): CodeLang | undefined {
  if (i.kind === "code") return langOf(i.language)
  if (i.kind !== "data" || i.table) return undefined
  if (i.contentType === "json" || i.contentType === "xml") return i.contentType
  return undefined // tables, html, markdown and plain text are not code
}

/** Language id as stored in the workbook file ("abap-sql" for SQL cells). */
export const LANG_ID: Record<CodeLang, string> = {
  sql: "abap-sql",
  javascript: "javascript",
  json: "json",
  xml: "xml",
  text: "text"
}

// ---------------------------------------------------------------- markdown blocks

export type MdBlock =
  | { type: "text"; lines: string[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "code"; lang: CodeLang; code: string }

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map(c =>
      c
        .trim()
        .replace(/\\\|/g, "|")
        .replace(/\*\*|`/g, "")
    )

const isSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)

/** Split markdown into text runs, pipe tables and fenced code blocks (for PDF / Word export). */
export function splitMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n")
  const blocks: MdBlock[] = []
  let text: string[] = []
  const flush = () => {
    if (text.length) blocks.push({ type: "text", lines: text })
    text = []
  }
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i])
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i])
      blocks.push({ type: "code", lang: langOf(fence[2].toLowerCase()), code: body.join("\n") })
      continue
    }
    if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush()
      const columns = splitRow(lines[i])
      const rows: string[][] = []
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(splitRow(lines[i]))
      i--
      blocks.push({ type: "table", columns, rows })
      continue
    }
    text.push(lines[i])
  }
  flush()
  return blocks
}
