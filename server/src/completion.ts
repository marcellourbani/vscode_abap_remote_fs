import {
  CompletionParams,
  CompletionItem,
  CompletionList,
  Position
} from "vscode-languageserver"
import { clientAndObjfromUrl, ClientAndObject } from "./utilities"
import { log } from "./clientManager"
import { isAbap, callThrottler, isCdsView, caughtToString } from "./functions"
import { CompletionProposal, ADTClient } from "abap-adt-api"
import { cdsCompletionExtractor } from "./cdsSyntax"
import { formatItem } from "./completionutils"

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
    client.codeCompletion(url, source, p.line + 1, p.character).catch(e => {
      log(`Completion error: ${caughtToString(e)}`)
      return []
    })
  )
}
const isSupported = (x: string) => isAbap(x) || isCdsView(x)

async function abapCompletion(co: ClientAndObject, pos: Position) {
  const { client, obj, source } = co
  const rawItems = await proposals(client, obj.mainUrl, pos, source)
  const line = source.split(/\n/)[pos.line] || ""
  const items: CompletionItem[] = rawItems.map(formatItem(line, pos))
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
    const elements = await client.ddicRepositoryAccess(
      sources.map(s => `${s}.`)
    )
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

    if (isAbap(params.textDocument.uri))
      items = await abapCompletion(co, params.position)
    if (isCdsView(params.textDocument.uri))
      items = await cdsCompletion(co, params.position)
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
  } catch (e) {
    log("Exception in completion:", caughtToString(e)) // ignore
  }
}
