import {
  CompletionParams,
  CompletionItem,
  CompletionList,
  Position
} from "vscode-languageserver"
import { clientAndObjfromUrl, ClientAndObject } from "./utilities"
import { log } from "./clientManager"
import { isAbap, callThrottler, isCdsView } from "./functions"
import { CompletionProposal, ADTClient } from "abap-adt-api"
import { cdsCompletionExtractor } from "./cdsSyntax"

const completionKey = (url: string, p: Position) =>
  `${url} ${p.line} ${p.character}`
const throttler = callThrottler<CompletionProposal[]>()
const proposals = (
  client: ADTClient,
  url: string,
  p: Position,
  source: string
) => {
  const key = completionKey(url, p)
  return throttler(key, () =>
    client.codeCompletion(url, source, p.line + 1, p.character)
  )
}
const isSupported = (x: string) => isAbap(x) || isCdsView(x)

async function abapCompletion(co: ClientAndObject, pos: Position) {
  const InterfaceRole = 58 // sccmp_role_intftype in abap
  const { client, obj, source } = co
  const items: CompletionItem[] = []
  const rawItems = await proposals(client, obj.mainUrl, pos, source)
  const line = source.split(/\n/)[pos.line] || ""
  const before = line.substr(0, pos.character)
  rawItems.forEach(i => {
    const lastChar = before.substr(-i.PREFIXLENGTH, 1)
    const isMethodCall = !!before.substr(-(i.PREFIXLENGTH + 2)).match(/^[-=]>/)
    const label =
      i.IDENTIFIER + (i.ROLE === InterfaceRole && isMethodCall ? "~" : "")
    let insertText = label
    // fix namespaces
    const match = label.match(/^(\/\w+\/)/)
    if (match) {
      let len = match[1].length
      len = i.PREFIXLENGTH >= len ? len : lastChar === "/" ? 1 : 0
      if (len) insertText = insertText.substr(len)
    }
    // fix field-symbols
    if (label[0] === "<") {
      if (line[pos.character - i.PREFIXLENGTH] === "<")
        insertText = insertText.substr(1)
      if (line[pos.character] === ">")
        insertText = insertText.substr(0, insertText.length - 1)
    }
    const item: CompletionItem = {
      label,
      insertText,
      sortText: `${i.LOCATION}  ${i.IDENTIFIER}`,
      data: i
    }
    items.push(item)
  })
  return items
}
async function cdsCompletion(co: ClientAndObject, pos: Position) {
  const { client, obj, source } = co
  const items: CompletionItem[] = []
  const { matched, prefix, sources } = cdsCompletionExtractor(source, pos)
  if (matched === "NONE") return items
  if (matched === "SOURCE") {
    const elements = await client.ddicRepositoryAccess(`${prefix}*`)
    for (const element of elements) items.push({ label: element.name })
  } else if (sources.length) {
    const elements = await client.ddicRepositoryAccess(
      sources.map(s => `${s}.`)
    )
    const compatible = elements.filter(e => e.name.startsWith(prefix))
    for (const element of elements) {
      if (element.name.startsWith(prefix)) items.push({ label: element.name })
      else {
        const label = `${element.path}.${element.name}`
        if (label.startsWith(prefix)) items.push({ label })
      }
    }
  }
  return items
}
export async function completion(params: CompletionParams) {
  if (!isSupported(params.textDocument.uri)) return
  let items: CompletionItem[] = []
  try {
    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return items

    if (isAbap(params.textDocument.uri))
      items = await abapCompletion(co, params.position)
    if (isCdsView(params.textDocument.uri))
      items = await cdsCompletion(co, params.position)
  } catch (e) {
    log("Exception in completion:", e.toString()) // ignore
  }
  const isInComplete = (compl: CompletionItem[]) => {
    if (compl.length > 10) return true
    if (compl.length === 0) return false
    // special handling for "type table of"
    let found = false

    compl.some(c => {
      const match = c.label.match(/type( table of)?/i)
      if (match && match[1]) found = true
      return found || !match
    })

    return !found
  }
  return CompletionList.create(items, isInComplete(items))
}
