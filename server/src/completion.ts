import { CompletionParams, CompletionItem } from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"
import { log } from "./clientManager"

export async function completion(params: CompletionParams) {
  const items: CompletionItem[] = []
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
    let firstChar: string
    rawItems.forEach(i => {
      const label = i.IDENTIFIER
      let insertText = label
      if (label && label[0] === "<") {
        // if the first character of the match is <, eat it from completion text
        if (!firstChar) {
          const line = source.split(/\n/)[params.position.line]
          let pos = params.position.character - 1
          while (pos > 0 && !line[pos - 1].match(/\s/)) pos--
          if (line) firstChar = line[pos]
          firstChar = firstChar ? firstChar.substr(0, 1) || ">" : ">" // dummy, !== <
        }
        if (firstChar === "<") insertText = insertText.substr(1)
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
  return items
}
