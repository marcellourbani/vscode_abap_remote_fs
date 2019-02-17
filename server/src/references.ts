import {
  TextDocumentPositionParams,
  Location,
  ReferenceParams,
  CancellationToken,
  Position
} from "vscode-languageserver"
import { getVSCodeUri } from "./clientapis"
import { sourceRange, clientAndObjfromUrl } from "./utilities"
import { ReferenceUri, Location as ApiLocation } from "abap-adt-api"
import { urlFromPath } from "sharedtypes"

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

function locationFromUrl(url: ReferenceUri, ck: string): Location | undefined {
  const convertLocation = (l: ApiLocation): Position => ({
    line: l.line - 1,
    character: l.column
  })
  if (url && url.start) {
    const { uri, start, end } = url
    return {
      uri: urlFromPath(ck, uri),
      range: {
        start: convertLocation(start),
        end: convertLocation(end || start)
      }
    }
  }
}

export async function findReferences(
  params: ReferenceParams,
  token: CancellationToken
) {
  const locations: Location[] = []
  const co = await clientAndObjfromUrl(params.textDocument.uri, false)
  if (!co) return
  const result = await co.client.usageReferences(
    co.obj.mainUrl,
    params.position.line + 1,
    params.position.character
  )
  if (token.isCancellationRequested) return
  const snippets = await co.client.usageReferenceSnippets(result)
  snippets.forEach(s => {
    s.snippets.forEach(sn => {
      const location = locationFromUrl(sn.uri, co.confKey)
      if (location) locations.push(location)
    })
  })

  return locations
}
