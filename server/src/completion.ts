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
import { cdsCompletionExtractor, cdsDataSources } from "./cdsSyntax"
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
  if (matched === "NONE") {
    // cursor may be on an empty line inside { } — offer all fields from data sources
    const line = source.split("\n")[pos.line] || ""
    if (line.trim() === "" || line.trim() === "," || line.trim() === "KEY") {
      const dataSources = cdsDataSources(source)
      if (dataSources.length) {
        const elements = await client.ddicRepositoryAccess(dataSources.map(s => `${s}.`))
        for (const element of elements) add(element.name)
      }
    }
    return items
  }
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
    log("Exception in completion:", caughtToString(e)) // ignore
  }
}

// ── Completion Resolve ──────────────────────────────────────────────────────
// When the user selects a completion item, try to get the full insertion text
// (with method parameters) from the ADT codeCompletionFull endpoint.

export async function completionResolve(item: CompletionItem): Promise<CompletionItem> {
  try {
    log("[completionResolve] called for:", typeof item.label === "string" ? item.label : item.label.label)
    const proposal: CompletionProposal | undefined = item.data
    if (!proposal) { log("[completionResolve] no proposal data on item"); return item }
    if (!lastCompletionContext) { log("[completionResolve] no lastCompletionContext"); return item }

    log("[completionResolve] uri:", lastCompletionContext.uri, "mainUrl:", lastCompletionContext.mainUrl)
    const co = await clientAndObjfromUrl(lastCompletionContext.uri, true)
    if (!co?.client) { log("[completionResolve] clientAndObjfromUrl returned nothing"); return item }

    const { mainUrl, source, position } = lastCompletionContext
    log("[completionResolve] calling codeCompletionFull for", proposal.IDENTIFIER, "at", position.line + 1, position.character)
    const fullText = await co.client.statelessClone.codeCompletionFull(
      mainUrl,
      source,
      position.line + 1,
      position.character,
      proposal.IDENTIFIER
    )

    log("[completionResolve] fullText:", JSON.stringify(fullText?.substring(0, 200)))
    if (fullText && typeof fullText === "string" && fullText.length > proposal.IDENTIFIER.length) {
      // Convert to a snippet: replace empty assignment spots with tab stops
      const snippet = convertToSnippet(fullText, proposal.IDENTIFIER)
      log("[completionResolve] snippet:", JSON.stringify(snippet?.substring(0, 200)))
      if (snippet) {
        item.insertText = snippet
        item.insertTextFormat = InsertTextFormat.Snippet
      }
    } else {
      log("[completionResolve] fullText not usable (length:", fullText?.length, "vs identifier:", proposal.IDENTIFIER.length, ")")
    }
  } catch (e) {
    log("Exception in completionResolve:", caughtToString(e))
  }
  return item
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
  // If the full text doesn't contain parentheses, it's not a method call
  if (!fullText.includes("(")) return undefined

  log("[convertToSnippet] raw fullText:", JSON.stringify(fullText))

  // Normalize line endings
  let text = fullText.replace(/\r\n/g, "\n")

  // Format A: strip echoed parameter value on next line: "= \n<echo>" → "= \n"
  text = text.replace(/(=[ \t]*\n)[^\n]*/g, "$1")

  // Format B: strip inline ABAP comment after "=": "= <spaces>" comment" → "= "
  text = text.replace(/(=)\s*"[^\n]*/g, "$1 ")

  log("[convertToSnippet] cleanedText:", JSON.stringify(text))

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

  log("[convertToSnippet] tabIndex:", tabIndex, "snippet:", JSON.stringify(snippet?.substring(0, 300)))

  if (tabIndex === 0) return undefined

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
    const elementInfo = await co.client.statelessClone.codeCompletionElement(
      obj.mainUrl,
      source,
      callMatch.line + 1,
      callMatch.column
    )

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
            const nameStart = textBefore.length - nameMatch[0].trimStart().length
            return {
              line: l,
              column: nameStart + 1, // 1-based for ADT
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
    if (comp.entries && comp.entries.length > 0) {
      const paramType = comp.entries.find(e => e.key === "type")?.value || ""
      const paramDir = comp["adtcore:type"] || ""
      const label = `${comp["adtcore:name"]}${paramType ? " TYPE " + paramType : ""}`
      paramLabels.push(label)
      params.push(ParameterInformation.create(comp["adtcore:name"], paramDir))
    }
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
