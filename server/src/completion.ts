import {
  CompletionParams,
  CompletionItem,
  CompletionList,
  Position,
  InsertTextFormat,
  SignatureHelpParams,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation
} from "vscode-languageserver"
import { clientAndObjfromUrl, ClientAndObject } from "./utilities"
import { log } from "./clientManager"
import { isAbap, callThrottler, isCdsView, caughtToString } from "./functions"
import { CompletionProposal, ADTClient, CompletionElementInfo } from "abap-adt-api"
import { cdsCompletionExtractor } from "./cdsSyntax"
import { formatItem } from "./completionutils"

// ── Completion ──────────────────────────────────────────────────────────────

const completionKey = (url: string, p: Position) => `${url} ${p.line} ${p.character}`
const throttler = callThrottler<CompletionProposal[]>()
const proposals = (client: ADTClient, url: string, p: Position, source: string) => {
  const key = completionKey(url, p)
  return throttler(key, () =>
    client.codeCompletion(url, source, p.line + 1, p.character).catch(e => {
      log(`Completion error: ${caughtToString(e)}`)
      return []
    })
  )
}
const isSupported = (x: string) => isAbap(x) || isCdsView(x)

// Cache the last completion context so onCompletionResolve can call codeCompletionFull
let lastCompletionContext: {
  uri: string
  mainUrl: string
  source: string
  position: Position
} | undefined

async function abapCompletion(co: ClientAndObject, pos: Position, docUri: string) {
  const { client, obj, source } = co
  const rawItems = await proposals(client, obj.mainUrl, pos, source)
  const line = source.split(/\n/)[pos.line] || ""
  const items: CompletionItem[] = rawItems.map(formatItem(line, pos))

  // Store context for resolve - must use the adt:// document URI, not obj.url
  lastCompletionContext = {
    uri: docUri,
    mainUrl: obj.mainUrl,
    source,
    position: pos
  }

  return items
}

async function cdsCompletion(co: ClientAndObject, pos: Position) {
  const { client, source } = co
  const items: CompletionItem[] = []
  const { matched, prefix, sources } = cdsCompletionExtractor(source, pos)
  const add = (label: string) => {
    if (!items.find(i => i.label === label)) items.push({ label })
  }
  if (matched === "NONE") return items
  if (matched === "SOURCE") {
    const elements = await client.ddicRepositoryAccess(`${prefix}*`)
    for (const element of elements) add(element.name)
  } else if (sources.length) {
    const elements = await client.ddicRepositoryAccess(sources.map(s => `${s}.`))
    for (const element of elements) {
      if (element.name.startsWith(prefix)) add(element.name)
      else {
        const label = `${element.path}.${element.name}`
        if (label.startsWith(prefix)) add(label)
      }
    }
  }
  return items
}

export async function completion(params: CompletionParams) {
  try {
    if (!isSupported(params.textDocument.uri)) return
    let items: CompletionItem[] = []
    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return items

    if (isAbap(params.textDocument.uri)) items = await abapCompletion(co, params.position, params.textDocument.uri)
    if (isCdsView(params.textDocument.uri)) items = await cdsCompletion(co, params.position)
    const isInComplete = (compl: CompletionItem[]) => {
      if (compl.length > 10) return true
      if (compl.length === 0) return false
      // special handling for "type table of"
      let found = false

      compl.some(c => {
        const match = (typeof c.label === "string" ? c.label : "").match(/type( table of)?/i)
        if (match && match[1]) found = true
        return found || !match
      })

      return !found
    }
    return CompletionList.create(items, isInComplete(items))
  } catch (e) {
    log("Exception in completion:", caughtToString(e))
  }
}

// ── Completion Resolve ──────────────────────────────────────────────────────
// When the user selects a completion item, try to get the full insertion text
// (with method parameters) from the ADT codeCompletionFull endpoint.

export async function completionResolve(item: CompletionItem): Promise<CompletionItem> {
  try {
    const proposal: CompletionProposal | undefined = item.data
    if (!proposal) return item
    if (!lastCompletionContext) return item

    // If this item has a post-insert command (method calls), skip resolve snippet insertion
    // The command will handle fetching and inserting the full snippet after insertion
    if (item.command) return item

    const co = await clientAndObjfromUrl(lastCompletionContext.uri, true)
    if (!co?.client) return item

    const { mainUrl, source, position } = lastCompletionContext
    const fullText = await co.client.statelessClone.codeCompletionFull(
      mainUrl,
      source,
      position.line + 1,
      position.character,
      proposal.IDENTIFIER
    )

    if (fullText && typeof fullText === "string" && fullText.length > proposal.IDENTIFIER.length) {
      // Convert to a snippet: replace empty assignment spots with tab stops
      const snippet = convertToSnippet(fullText, proposal.IDENTIFIER)
      if (snippet) {
        item.insertText = snippet
        item.insertTextFormat = InsertTextFormat.Snippet
      }
    } else {
    }
  } catch (e) {
    log("Exception in completionResolve:", caughtToString(e))
  }
  return item
}

// ── Code Completion Full Request ────────────────────────────────────────────
// Called by client command after a method-call completion item is inserted.
// Returns the full snippet text so the client can apply it.

export interface CodeCompletionFullParams {
  uri: string
  identifier: string
}

export async function codeCompletionFullRequest(params: CodeCompletionFullParams): Promise<string | undefined> {
  try {
    const { uri, identifier } = params
    const co = await clientAndObjfromUrl(uri, true)
    if (!co?.client) return undefined

    const { source, obj } = co
    const lines = source.split(/\n/)
    // Find the identifier in the source to get the correct position
    // Search from the end since it was just inserted
    let foundLine = -1, foundCol = -1
    for (let l = lines.length - 1; l >= 0; l--) {
      const idx = lines[l].toUpperCase().lastIndexOf(identifier.toUpperCase())
      if (idx >= 0) {
        foundLine = l
        foundCol = idx + identifier.length
        break
      }
    }
    if (foundLine < 0) return undefined

    const fullText = await co.client.statelessClone.codeCompletionFull(
      obj.mainUrl, source, foundLine + 1, foundCol, identifier
    )

    if (fullText && typeof fullText === "string" && fullText.length > identifier.length) {
      const snippet = convertToSnippet(fullText, identifier)
      return snippet
    }
    return undefined
  } catch (e) {
    log("Exception in codeCompletionFullRequest:", caughtToString(e))
    return undefined
  }
}

/**
 * Convert ADT's full insertion text into a VS Code snippet with tab stops.
 * ADT returns text in three known formats depending on system/method:
 *   Format A: multiline, echo on next line: "param = \necho_value\n"
 *   Format B: multiline, inline ABAP comment: "param =                  " comment"
 *   Format C: single-line: "method( param =  )."
 * We normalize all to "param = " and add tab stops.
 */
function convertToSnippet(fullText: string, identifier: string): string | undefined {
  // Must have either parentheses (functional call) or EXPORTING/IMPORTING/etc. (call method form)
  if (!fullText.includes("(") && !/\b(EXPORTING|IMPORTING|CHANGING|RECEIVING)\b/i.test(fullText)) return undefined


  // Normalize line endings
  let text = fullText.replace(/\r\n/g, "\n")

  // Format A: strip echoed parameter value on next line ONLY if it's not a parameter or comment line.
  // ADT sometimes echoes the value on the next line: "param = \necho_value\n"
  // But we must NOT strip lines that are new parameters (contain "=") or comments (start with *)
  text = text.replace(/=[ \t]*\n([^\n]*)/g, (match, nextLine) => {
    const trimmed = nextLine.trim()
    // Keep the next line if it's a parameter, comment, closing paren, dot, or keyword
    if (trimmed === "" || /[=*().]/.test(trimmed) || /^(EXPORTING|IMPORTING|CHANGING|RECEIVING)\b/i.test(trimmed)) {
      return match // keep as-is
    }
    // Strip the echoed value
    return "= \n"
  })

  // Format B: strip inline ABAP comment after "=": "= <spaces>" comment" → "= "
  // Use [ \t]* instead of \s* to avoid crossing newlines
  text = text.replace(/(=)[ \t]*"[^\n]*/g, "$1 ")

  // Fix commented-out optional parameter lines: in ABAP, * must be in column 1
  text = text.replace(/^[ \t]+\*/gm, "*")


  let tabIndex = 0
  // Replace all empty assignment slots (value is only whitespace before ")", ",", or end-of-line)
  // Works for both multiline (Format A/B) and single-line (Format C)
  const snippet = text.replace(
    /(\b\w+)([ \t]*=[ \t]*)(?=[ \t]*[),\n]|[ \t]*$)/gm,
    (match, paramName, equals, offset, str) => {
      // Skip assignments on commented-out lines (line starts with optional spaces then *)
      const lineStart = str.lastIndexOf("\n", offset - 1) + 1
      if (/^\s*\*/.test(str.substring(lineStart, offset + paramName.length))) return match
      tabIndex++
      return `${paramName}${equals}\${${tabIndex}}`
    }
  )


  // Even with no tab stops (all params optional/commented), return the snippet
  // so the full method signature template is inserted
  return snippet + `\$0`
}

// ── Signature Help ──────────────────────────────────────────────────────────
// Shows method parameter hints when typing inside parentheses.

export async function signatureHelp(params: SignatureHelpParams): Promise<SignatureHelp | undefined> {
  try {
    if (!isAbap(params.textDocument.uri)) return undefined

    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co?.client) return undefined

    const { source, obj } = co
    const lines = source.split(/\n/)

    // Find the method call context: look backwards for CLASS=>METHOD( or OBJECT->METHOD(
    const callMatch = findMethodCall(lines, params.position)
    if (!callMatch) return undefined

    // Use codeCompletionElement to get parameter info at the method call position
    // Try at method name position first, then fall back to paren position
    let elementInfo = await co.client.statelessClone.codeCompletionElement(
      obj.mainUrl,
      source,
      callMatch.line + 1,
      callMatch.column
    )
  
    // If that returned nothing useful, try at the opening paren position
    if (!elementInfo || typeof elementInfo === "string" || !elementInfo.components?.length) {
      elementInfo = await co.client.statelessClone.codeCompletionElement(
        obj.mainUrl,
        source,
        callMatch.line + 1,
        callMatch.parenColumn + 1
      )
    }

    if (!elementInfo || typeof elementInfo === "string") return undefined

    const sigInfo = buildSignatureFromElementInfo(elementInfo, callMatch.methodName)
    if (!sigInfo) return undefined

    // Determine active parameter based on comma count
    const activeParam = countCommasBeforeCursor(lines, params.position, callMatch)

    return {
      signatures: [sigInfo],
      activeSignature: 0,
      activeParameter: activeParam
    }
  } catch (e) {
    log("Exception in signatureHelp:", caughtToString(e))
    return undefined
  }
}

interface MethodCallContext {
  line: number
  column: number
  methodName: string
  parenLine: number
  parenColumn: number
}

/**
 * Scan backwards from cursor to find the opening ( of a method call.
 * Handles multi-line calls.
 */
function findMethodCall(lines: string[], pos: Position): MethodCallContext | undefined {
  let depth = 0
  let l = pos.line
  let c = pos.character - 1

  // Walk backwards to find the matching opening parenthesis
  while (l >= 0) {
    const line = lines[l] || ""
    if (c < 0) c = line.length - 1

    while (c >= 0) {
      const ch = line[c]
      if (ch === ")") depth++
      else if (ch === "(") {
        if (depth === 0) {
          // Found the opening paren. Now look for the method name before it.
          const textBefore = line.substring(0, c).trimEnd()
          // Match patterns like: CLASS=>METHOD, obj->method, FUNCTION_NAME
          const nameMatch = textBefore.match(/([\w\/]+(?:[=-]>[\w\/]+)?)\s*$/)
          if (nameMatch) {
            const fullName = nameMatch[1]
            const methodName = fullName.includes("=>") || fullName.includes("->")
              ? fullName.split(/[=-]>/)[1] || fullName
              : fullName
            // Point column at the method name part, not the class prefix
            // ADT needs the position of the method identifier to return parameter info
            const fullNameStart = textBefore.length - nameMatch[0].trimStart().length
            const methodNameStart = fullName.includes("=>") || fullName.includes("->")
              ? fullNameStart + fullName.lastIndexOf(">") + 1
              : fullNameStart
            return {
              line: l,
              column: methodNameStart + 1, // 1-based for ADT
              methodName,
              parenLine: l,
              parenColumn: c
            }
          }
          return undefined
        }
        depth--
      }
      c--
    }
    l--
    c = -1
  }
  return undefined
}

/**
 * Build a SignatureInformation from CompletionElementInfo
 */
function buildSignatureFromElementInfo(
  info: CompletionElementInfo,
  methodName: string
): SignatureInformation | undefined {
  if (!info.components || info.components.length === 0) return undefined

  const params: ParameterInformation[] = []
  const paramLabels: string[] = []

  for (const comp of info.components) {
    // Each component represents a parameter group or individual parameter
    if (!comp["adtcore:name"]) continue
    const paramType = comp.entries?.find(e => e.key === "type")?.value || ""
    const paramDir = comp["adtcore:type"] || ""
    const label = `${comp["adtcore:name"]}${paramType ? " TYPE " + paramType : ""}`
    paramLabels.push(label)
    params.push(ParameterInformation.create(comp["adtcore:name"], paramDir))
  }

  if (params.length === 0) return undefined

  const sigLabel = `${methodName}( ${paramLabels.join(", ")} )`
  const sig = SignatureInformation.create(sigLabel, info.doc || undefined, ...params)
  return sig
}

/**
 * Count commas between the opening paren and the cursor to determine active parameter
 */
function countCommasBeforeCursor(
  lines: string[],
  cursorPos: Position,
  callCtx: MethodCallContext
): number {
  let commas = 0
  let depth = 0

  for (let l = callCtx.parenLine; l <= cursorPos.line; l++) {
    const line = lines[l] || ""
    const startCol = l === callCtx.parenLine ? callCtx.parenColumn + 1 : 0
    const endCol = l === cursorPos.line ? cursorPos.character : line.length

    for (let c = startCol; c < endCol; c++) {
      const ch = line[c]
      if (ch === "(") depth++
      else if (ch === ")") depth--
      else if (ch === "," && depth === 0) commas++
    }
  }
  return commas
}
