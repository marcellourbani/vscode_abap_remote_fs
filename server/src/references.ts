import {
  TextDocumentPositionParams,
  Location,
  ReferenceParams,
  CancellationToken,
  Position,
  CancellationTokenSource
} from "vscode-languageserver"
import { sourceRange, clientAndObjfromUrl } from "./utilities"
import {
  ReferenceUri,
  Location as ApiLocation,
  ADTClient,
  ClassComponent,
  UsageReference
} from "abap-adt-api"
import { vscUrl } from "./objectManager"
import { groupBy } from "lodash"
import { log, warn } from "./clientManager"
import { getObjectSource, setSearchProgress } from "./clientapis"
import { isAbapOrCds, isCdsLike, memoize, parts, toInt, hashParms, caughtToString } from "./functions"
import { cdsNavigationTarget } from "./cdsSyntax"
import { ddicRepositoryAccessField } from "./cdsNavigation"

async function cdsDefinition(params: TextDocumentPositionParams): Promise<Location | undefined> {
  const co = await clientAndObjfromUrl(params.textDocument.uri)
  if (!co) return

  const pos: Position = { line: params.position.line, character: params.position.character }
  const target = cdsNavigationTarget(co.source, pos)
  if (!target) return

  // resolve the target to an ADT object URI
  try {
    switch (target.kind) {
      case "source":
      case "association":
      case "dataElement": {
        // look up the name as a DDIC object
        const refs = await co.client.ddicRepositoryAccess(target.name)
        if (refs.length > 0) {
          const uri = await vscUrl(co.confKey, refs[0].uri, true)
          if (uri) return { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
        }
        break
      }
      case "field": {
        try {
          const fieldRef = await ddicRepositoryAccessField(
            co.client.statelessClone, target.source, target.field
          )
          if (fieldRef) {
            const baseUri = fieldRef.uri.replace(/[#?].*/, "")
            const fragMatch = fieldRef.uri.match(/#type=([^;]+);name=(.+)/)
            if (fragMatch) {
              try {
                const frag = await co.client.statelessClone.fragmentMappings(
                  baseUri, decodeURIComponent(fragMatch[1]), decodeURIComponent(fragMatch[2])
                )
                if (frag?.uri) {
                  const uri = await vscUrl(co.confKey, frag.uri, true)
                  if (uri) {
                    return {
                      uri,
                      range: {
                        start: { line: frag.line - 1, character: frag.column },
                        end: { line: frag.line - 1, character: frag.column + target.field.length }
                      }
                    }
                  }
                }
              } catch (e) {
                log("cdsDefinition fragmentMappings failed:", caughtToString(e))
              }
            }
            const uri = await vscUrl(co.confKey, baseUri, true)
            if (uri) return { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
          }
        } catch (e) {
          log("cdsDefinition field lookup failed:", caughtToString(e))
        }
        // fallback: navigate to the source itself
        const sourceRefs = await co.client.ddicRepositoryAccess(target.source)
        if (sourceRefs.length > 0) {
          const uri = await vscUrl(co.confKey, sourceRefs[0].uri, true)
          if (uri) return { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
        }
        break
      }
      case "unknown": {
        // fallback: try the word directly
        const refs = await co.client.ddicRepositoryAccess(target.word)
        if (refs.length > 0) {
          const uri = await vscUrl(co.confKey, refs[0].uri, true)
          if (uri) return { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
        }
        break
      }
    }
  } catch (e) {
    log("cdsDefinition error:", caughtToString(e))
  }
}

export async function findDefinition(impl: boolean, params: TextDocumentPositionParams) {
  if (!isAbapOrCds(params.textDocument.uri)) return

  if (isCdsLike(params.textDocument.uri)) {
    return cdsDefinition(params)
  }

  let co: any = null
  try {
    co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return

    const range = sourceRange(co.source, params.position.line + 1, params.position.character)

    const result = await co.client.statelessClone.findDefinition(
      co.obj.mainUrl,
      co.source,
      range.start.line + 1,
      range.start.character,
      range.end.character,
      impl,
      co.obj.mainProgram || ""
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
  } catch (e) {}
}

class LocationManager {
  private classes: (uri: string) => Promise<ClassComponent>
  private sources: (uri: string) => Promise<string>
  private sections = new Map([
    ["CLAS/OSI", /^(?:(?=[^*"])[^"]*)?private\s+section(?:\s|\n|\.)/i],
    ["CLAS/OSO", /^(?:(?=[^*"])[^"]*)?protected\s+section(?:\s|\n|\.)/i]
  ])

  constructor(
    private conKey: string,
    private client: ADTClient
  ) {
    this.classes = memoize(c => this.client.statelessClone.classComponents(c))
    this.sources = memoize(c => this.client.statelessClone.getObjectSource(c))
  }

  public async locationFromUrl(url: ReferenceUri) {
    if (url && url.start && url.uri) {
      const { uri, start, end, type, name } = url
      if (type && name) {
        let include
        try {
          include = await this.findInclude(name, type, uri)
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
  public async locationFromRef(ref: UsageReference) {
    const objtype = ref["adtcore:type"]
    if (objtype && objtype.match(/(clas)|(intf)/i)) {
      const { type, name } = hashParms(ref.uri)
      const uri = ref.uri.replace(/[#\?].*/, "")
      return this.locationFromUrl({
        uri,
        type: type || objtype,
        name: name || ref["adtcore:name"],
        start: { line: 0, column: 0 }
      })
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
    const link = include.links.find(l => !!(l.rel && l.href && l.rel.match("implementationBlock")))
    if (link) return link
    return include.links.find(l => !!(l.rel && l.href && l.rel.match("definitionBlock")))
  }

  private async findInclude(name: string, type: string, uri: string) {
    let include
    if (type && name) {
      const match = uri.match(/(\/sap\/bc\/adt\/oo\/(?:classes|interfaces)\/.*)\/source\/main/)
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

let lastSearch: CancellationTokenSource | undefined
export function cancelSearch() {
  if (lastSearch) {
    lastSearch.cancel()
    lastSearch = undefined
    return setSearchProgress({ ended: true, hits: 0, progress: 100 }).catch(() => {})
  }
}

async function startSearch() {
  await cancelSearch()
  await setSearchProgress({ ended: false, hits: 0, progress: 0 })
  lastSearch = new CancellationTokenSource()
  return lastSearch
}
export async function findReferences(params: ReferenceParams, token: CancellationToken) {
  if (!isAbapOrCds(params.textDocument.uri)) return
  const mySearch = await startSearch()
  const cancelled = () => mySearch.token.isCancellationRequested || token.isCancellationRequested

  const locations: Location[] = []
  try {
    const co = await clientAndObjfromUrl(params.textDocument.uri, false)
    if (!co) return
    const manager = new LocationManager(co.confKey, co.client)
    const references = await co.client.statelessClone.usageReferences(
      co.obj.mainUrl,
      params.position.line + 1,
      params.position.character
    )
    if (cancelled()) return locations

    const goodRefs = references.filter(fullname)
    const groups = groupBy(goodRefs, fullname)

    let processed = 0
    for (const group of Object.keys(groups)) {
      try {
        const snippets = await co.client.statelessClone.usageReferenceSnippets(groups[group])
        for (const s of snippets) {
          if (s.snippets.length === 0) {
            const ref = references.find(r => r.objectIdentifier === s.objectIdentifier)
            if (ref)
              try {
                const loc = await manager.locationFromRef(ref)
                if (loc) locations.push(loc)
              } catch (e) {
                warn("no reference found for", s.objectIdentifier) // ignore
              }
          }
          for (const sn of s.snippets) {
            if (cancelled()) return locations
            const location = await manager.locationFromUrl(sn.uri)
            if (location && !location.uri)
              location.uri = await vscUrl(co.confKey, sn.uri.uri).catch(() => "")
            if (location && location.uri) locations.push(location)
            else warn("no reference found for", s.objectIdentifier, sn.uri.uri)
          }
        }
      } catch (e) {
        warn("Exception in reference search:", caughtToString(e)) // ignore
      }
      processed = processed + groups[group].length
      if (!cancelled()) {
        setSearchProgress({
          ended: processed === goodRefs.length,
          hits: locations.length,
          progress: (processed / goodRefs.length) * 100
        })
      }
    }
  } catch (e) {
    warn("Exception in reference search:", caughtToString(e)) // ignore
  }
  cancelSearch() // just for cleanup
  return locations
}
