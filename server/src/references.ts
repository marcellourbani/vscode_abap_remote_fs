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
  ClassComponent,
  UsageReference
} from "abap-adt-api"
import { vscUrl } from "./objectManager"
import { groupBy } from "lodash"
import { log } from "./clientManager"
import { getObjectSource } from "./clientapis"

export async function findDefinition(params: TextDocumentPositionParams) {
  try {
    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return

    const range = sourceRange(
      co.source,
      params.position.line + 1,
      params.position.character
    )
    const result = await co.client.findDefinition(
      co.obj.mainUrl,
      co.source,
      range.start.line + 1,
      range.start.character,
      range.end.character
    )

    if (!result.url) return

    let uri
    let source = ""
    if (result.url === co.obj.url) {
      // same file
      uri = params.textDocument.uri
      source = co.source
    } else {
      uri = await vscUrl(co.confKey, result.url, true) // ask for new file's url
      if (!uri) return
      const s = await getObjectSource(uri)
      if (!s) return
      uri = s.url
      source = s.source
    }

    const l: Location = {
      uri,
      range: sourceRange(source, result.line, result.column)
    }
    return l
  } catch (e) {
    log("Exception in find definition:", e.toString()) // ignore
  }
}

class LocationManager {
  private classes: (uri: string) => Promise<ClassComponent>
  private sources: (uri: string) => Promise<string>
  private sections = new Map([
    ["CLAS/OSI", /^(?:(?=[^*"])[^"]*)?private\s+section(?:\s|\n|\.)/i],
    ["CLAS/OSO", /^(?:(?=[^*"])[^"]*)?protected\s+section(?:\s|\n|\.)/i]
  ])

  constructor(private conKey: string, private client: ADTClient) {
    this.classes = memoize(c => this.client.classComponents(c))
    this.sources = memoize(c => this.client.getObjectSource(c))
  }

  public async locationFromUrl(url: ReferenceUri) {
    if (url && url.start) {
      const { uri, start, end, type, name } = url
      if (type && name) {
        let include
        try {
          include = await this.findInclude(name, type, uri, url)
        } catch (e) {
          return
        }
        if (include) {
          const link = this.findLink(include)
          if (link) {
            const [blockstart] = parts(link.href, /#.*start=([\d]+)/)
            if (blockstart) {
              const ofs = toInt(blockstart) - (start.line > 0 ? 1 : 0)
              start.line += ofs
              if (end) end.line += ofs
            }
          }
        } else {
          const reg = this.sections.get(type)
          if (!reg) return
          const ofs = await this.findLine(reg, uri)
          if (!ofs) return
          start.line += ofs
          if (end) end.line += ofs
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

  private async findLine(reg: RegExp, uri: string) {
    // hack for protected and private in older systems
    if (reg) {
      const source = await this.sources(uri)
      const lines = source.split("\n")
      for (const idx in lines) {
        if (lines[idx].match(reg)) return toInt(idx)
      }
    }
    return 0
  }

  private findLink(include: ClassComponent) {
    const link = include.links.find(
      l => !!(l.rel && l.href && l.rel.match("implementationBlock"))
    )
    if (link) return link
    return include.links.find(
      l => !!(l.rel && l.href && l.rel.match("definitionBlock"))
    )
  }

  private async findInclude(
    name: string,
    type: string,
    uri: string,
    url: ReferenceUri
  ) {
    let include
    if (type && name) {
      const match = uri.match(
        /(\/sap\/bc\/adt\/oo\/(?:classes|interfaces)\/.*)\/source\/main/
      )
      if (match) {
        const main = await this.classes(match[1])
        if (main) {
          include = main.components.find(
            c => c["adtcore:name"] === name && c["adtcore:type"] === type
          )
          // hack for method references in older systems
          if (!include && type === "CLAS/OM")
            include = main.components.find(
              c => c["adtcore:name"] === name && c["adtcore:type"] === "CLAS/OO"
            )
        }
      }
    }
    return include
  }

  private convertLocation = (l: ApiLocation): Position => ({
    line: l.line - 1,
    character: l.column
  })
}

const fullname = (usageReference: UsageReference) => {
  const rparts = usageReference.objectIdentifier.split(";")
  return rparts[1] && rparts[0] === "ABAPFullName" ? rparts[1] : ""
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
    const references = await co.client.usageReferences(
      co.obj.mainUrl,
      params.position.line + 1,
      params.position.character
    )
    if (token.isCancellationRequested) return

    const groups = groupBy(references.filter(fullname), fullname)
    for (const group of Object.keys(groups)) {
      try {
        const snippets = await co.client.usageReferenceSnippets(groups[group])
        for (const s of snippets) {
          for (const sn of s.snippets) {
            if (token.isCancellationRequested) return
            const location = await manager.locationFromUrl(sn.uri)
            if (location) locations.push(location)
          }
        }
      } catch (e) {
        log("Exception in reference search:", e.toString()) // ignore
      }
    }
  } catch (e) {
    log("Exception in reference search:", e.toString()) // ignore
  }
  return locations
}
