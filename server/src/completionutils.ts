import { type CompletionProposal } from "abap-adt-api"
import { CompletionItem, Position, Range, TextEdit } from "vscode-languageserver-protocol"

const INTERFACEROLE = 58 // sccmp_role_intftype in abap

export const completionSourceUrl = (mainUrl: string, mainProgram?: string) =>
  mainProgram ? `${mainUrl}?context=${encodeURIComponent(mainProgram)}` : mainUrl

const ADT_SECTION_HEADER = "(?:EXPORTING|IMPORTING|CHANGING|RECEIVING|EXCEPTIONS|TABLES)"

export function convertToSnippet(fullText: string): string | undefined {
  let text = fullText.replace(/\r\n/g, "\n")

  // Format A: ADT may echo a value on the line after "= \n". Strip that echo,
  // but keep the next parameter, section header, or call closer (via lookahead).
  if (text.includes("(")) {
    const protectedNext = `[ \\t]*(?:$|[).]|\\w+[ \\t]*=|${ADT_SECTION_HEADER}\\b)`
    text = text.replace(new RegExp(`(=[ \\t]*\\n)(?!${protectedNext})[^\\n]*\\n?`, "gi"), "$1")
  }
  // Format B: strip inline ABAP comment after "=": `=   " comment` → `= `
  text = text.replace(/(=)\s*"[^\n]*/g, "$1 ")

  let tabIndex = 0
  // Empty assignment slots: before ), ,, newline, EOL, or the next `name =` (Format C).
  const snippet = text.replace(
    /(\b\w+)([ \t]*=[ \t]*)(?=[ \t]*(?:[),\n]|$|\w+[ \t]*=))/gm,
    (match, paramName, equals, offset, source) => {
      const lineStart = source.lastIndexOf("\n", offset - 1) + 1
      if (/^\s*\*/.test(source.substring(lineStart, offset + paramName.length))) return match
      tabIndex++
      const rest = source.slice(offset + match.length)
      const gap = /^\w/.test(rest) ? " " : ""
      return `${paramName}${equals}\${${tabIndex}}${gap}`
    }
  )

  return tabIndex === 0 ? undefined : snippet + `\$0`
}

/**
 * Transform an ADT completion proposal into the LSP shape expected by the client.
 */
export const formatItem =
  (textLine: string, p: Position) =>
  (i: CompletionProposal): CompletionItem => {
    const { line, character } = p
    const before = textLine.substring(0, character)
    const start = before.length - i.PREFIXLENGTH
    const isMethodCall = !!before.substring(start - 2).match(/^[-=]>/)
    const label = i.IDENTIFIER + (i.ROLE === INTERFACEROLE && isMethodCall ? "~" : "")
    let insertText = label
    // handle wildcards
    if (before.match(/\*/)) {
      const mpref = before.match(/(<?[\w\*]+)$/)
      const len = mpref ? mpref[1].length : i.PREFIXLENGTH
      const prefixLen = label.match(/(\/[\w]+\/)/)?.[1].length || 0
      const range = {
        start: { line, character: character - len - prefixLen },
        end: { line, character }
      }
      return {
        label,
        sortText: `${i.LOCATION}  ${i.IDENTIFIER}`,
        textEdit: TextEdit.insert(p, label),
        additionalTextEdits: [TextEdit.del(range)],
        data: i
      }
    }
    // fix namespaces
    const match = label.match(/^(\/\w+\/)/)
    if (match) {
      const lastChar = before.substring(start, start + 1)
      const len = match[1].length
      if (i.PREFIXLENGTH >= len) insertText = insertText.substring(len)
      else if (lastChar === "/") insertText = insertText.substring(1)
    }
    // fix field-symbols
    if (label[0] === "<") {
      if (textLine[p.character - i.PREFIXLENGTH] === "<") insertText = insertText.substring(1)
      if (textLine[p.character] === ">") insertText = insertText.substring(0, insertText.length - 1)
    }
    const item: CompletionItem = {
      label,
      insertText,
      sortText: `${i.LOCATION}  ${i.IDENTIFIER}`,
      data: i
    }
    return item
  }
