import {
  CompletionParams,
  CompletionItem,
  CompletionList,
  Position
} from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"
import { log } from "./clientManager"
import { isAbap, callThrottler } from "./functions"
import { CompletionProposal, ADTClient } from "abap-adt-api"

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
export async function completion(params: CompletionParams) {
  if (!isAbap(params.textDocument.uri)) return
  const InterfaceRole = 58 // sccmp_role_intftype in abap
  const items: CompletionItem[] = []
  // const sapIdStartPattern = /[\w\/\<]/
  try {
    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return items
    const { client, obj, source } = co
    const rawItems = await proposals(
      client,
      obj.mainUrl,
      params.position,
      source
    )
    const line = source.split(/\n/)[params.position.line] || ""
    const before = line.substr(0, params.position.character)
    rawItems.forEach(i => {
      const lastChar = before.substr(-i.PREFIXLENGTH, 1)
      const isMethodCall = !!before
        .substr(-(i.PREFIXLENGTH + 2))
        .match(/^[-=]>/)
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
        if (line[params.position.character - i.PREFIXLENGTH] === "<")
          insertText = insertText.substr(1)
        if (line[params.position.character] === ">")
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
