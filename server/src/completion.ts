import {
  CompletionParams,
  CompletionItem,
  CompletionList
} from "vscode-languageserver"
import { clientAndObjfromUrl, parts } from "./utilities"
import { log } from "./clientManager"

export async function completion(params: CompletionParams) {
  const iRole = 58 // sccmp_role_intftype in abap
  const items: CompletionItem[] = []
  const sapIdStartPattern = /[\w\/\<]/
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
    let prefix: string
    rawItems.forEach(i => {
      const label = i.IDENTIFIER + (i.ROLE === iRole ? "~" : "")
      let insertText = label
      if (label && label[0].match(/^[\/<]/)) {
        // if the first character of the match is < or a namespace, eat it from completion text
        if (prefix === undefined) {
          const line = source.split(/\n/)[params.position.line]
          let pos = params.position.character
          while (pos > 0 && line[pos - 1].match(sapIdStartPattern)) pos--
          // field symbol
          if (label[0] === "<") prefix = line && line[pos]
          // namespace
          else [prefix] = parts(line.substr(pos), /^(\/(?:[\w]+\/)?)/)
          // }
          prefix = prefix || "" // prevent doing it every loop
        }
        if (prefix) insertText = insertText.substr(prefix.length)
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
  return CompletionList.create(items, items.length > 10)
}
