import { CompletionParams, CompletionItem } from "vscode-languageserver"
import { clientFromUrl } from "./clientManager"
import { getObjectSource } from "./clientapis"
import { getObject } from "./objectManager"

export async function completion(params: CompletionParams) {
  const items: CompletionItem[] = []
  const uri = params.textDocument.uri
  const client = await clientFromUrl(uri)
  if (!client) return items
  const obj = await getObject(uri)
  if (!obj) return
  const source = await getObjectSource(uri)
  if (!source) return items
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
  return items
}
