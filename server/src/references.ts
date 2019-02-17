import { TextDocumentPositionParams, Location } from "vscode-languageserver"
import { getVSCodeUri } from "./clientapis"
import { sourceRange, clientAndObjfromUrl } from "./utilities"

export async function findDefinition(params: TextDocumentPositionParams) {
  const co = await clientAndObjfromUrl(params.textDocument.uri)
  if (!co) return
  const result = await co.client.findDefinition(
    co.obj.mainUrl,
    co.source,
    params.position.line + 1,
    params.position.character,
    params.position.character
  )

  const uri =
    result.url &&
    (result.url === co.obj.url
      ? params.textDocument.uri // same file
      : await getVSCodeUri(co.confKey, result.url)) // ask for new file's url

  if (!uri) return
  const l: Location = {
    uri,
    range: sourceRange(co.source, result.line, result.column)
  }
  return l
}
