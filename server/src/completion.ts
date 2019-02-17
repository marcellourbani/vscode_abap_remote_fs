import { CompletionParams, CompletionItem } from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"

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
    rawItems.forEach(i => {
      const item: CompletionItem = { label: i.IDENTIFIER }
      items.push(item)
    })
  } catch (e) {
    // ignore
  }
  return items
}
