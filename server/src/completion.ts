import {
  CompletionParams,
  CompletionItem,
  CompletionList
} from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"
import { log } from "./clientManager"

export async function completion(params: CompletionParams) {
  const iRole = 58 // sccmp_role_intftype in abap
  const items: CompletionItem[] = []
  // const sapIdStartPattern = /[\w\/\<]/
  try {
    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return items
    const { client, obj, source } = co
    const rawItems = await client.codeCompletion(
      obj.mainUrl,
      source,
      params.position.line + 1,
      params.position.character
    )
    // let prefix: string
    const line = source.split(/\n/)[params.position.line] || ""
    rawItems.forEach(i => {
      const label = i.IDENTIFIER + (i.ROLE === iRole ? "~" : "")
      let insertText = label
      // fix namespaces
      const match = label.match(/^(\/\w+\/)/)
      if (match) {
        let len = match[1].length
        len = i.PREFIXLENGTH >= len ? len : 1
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
