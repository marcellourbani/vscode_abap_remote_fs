import {
  TextDocumentPositionParams,
  Location,
  ReferenceParams,
  CancellationToken,
  Position
} from "vscode-languageserver"
import {
  sourceRange,
  clientAndObjfromUrl,
  memoize,
  parts,
  toInt
} from "./utilities"
import {
  ReferenceUri,
  Location as ApiLocation,
  ADTClient,
  ClassComponent
} from "abap-adt-api"
import { vscUrl } from "./objectManager"

export async function findDefinition(params: TextDocumentPositionParams) {
  try {
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
        : await vscUrl(co.confKey, result.url)) // ask for new file's url

    if (!uri) return
    const l: Location = {
      uri,
      range: sourceRange(co.source, result.line, result.column)
    }
    return l
  } catch (e) {
    // ignore
  }
}

class LocationManager {
  private classes: (uri: string) => Promise<ClassComponent>
  constructor(private conKey: string, private client: ADTClient) {
    this.classes = memoize(c => this.client.classComponents(c))
  }

  public async locationFromUrl(url: ReferenceUri) {
    if (url && url.start) {
      const { uri, start, end, type, name } = url
      let main: ClassComponent
      if (type && name) {
        const match = uri.match(
          /(\/sap\/bc\/adt\/oo\/classes\/.*)\/source\/main/
        )
        if (match) {
          try {
            main = await this.classes(match[1])
          } catch (e) {
            return
          }
          if (main) {
            const include = main.components.find(
              c => c["adtcore:name"] === name && c["adtcore:type"] === type
            )
            if (include) {
              let link = include.links.find(
                l => !!(l.rel && l.href && l.rel.match("implementationBlock"))
              )
              if (!link)
                link = include.links.find(
                  l => !!(l.rel && l.href && l.rel.match("definitionBlock"))
                )
              if (link) {
                const [blockstart] = parts(link.href, /#.*start=([\d]+)/)
                if (blockstart) {
                  start.line += toInt(blockstart) - 1
                  if (end) end.line += toInt(blockstart) - 1
                }
              }
            }
          }
        }
      }
      const includeUri = await vscUrl(this.conKey, uri)
      return {
        uri: includeUri,
        range: {
          start: this.convertLocation(start),
          end: this.convertLocation(end || start)
        }
      } as Location
    }
  }

  private convertLocation = (l: ApiLocation): Position => ({
    line: l.line - 1,
    character: l.column
  })
}

export async function findReferences(
  params: ReferenceParams,
  token: CancellationToken
) {
  const locations: Location[] = []
  try {
    const co = await clientAndObjfromUrl(params.textDocument.uri, false)
    if (!co) return
    const manager = new LocationManager(co.confKey, co.client)
    const result = await co.client.usageReferences(
      co.obj.mainUrl,
      params.position.line + 1,
      params.position.character
    )
    if (token.isCancellationRequested) return
    const snippets = await co.client.usageReferenceSnippets(result)
    for (const s of snippets) {
      for (const sn of s.snippets) {
        if (token.isCancellationRequested) return
        const location = await manager.locationFromUrl(sn.uri)
        if (location) locations.push(location)
      }
    }
  } catch (e) {
    // ignore
  }
  return locations
}
