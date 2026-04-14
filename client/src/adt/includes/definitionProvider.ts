import { DefinitionProvider, TextDocument, Position, CancellationToken, Location, Uri, Range } from "vscode"
import { abapUri, getClient, getRoot } from "../conections"
import { log } from "../../lib"

const INCLUDE_RE = /^\s*INCLUDE\s+([\w\/]+)\s*(?:IF\s+FOUND\s*)?\.?\s*$/i
const CACHE_TTL = 60_000 // 1 minute

function includeNameAt(document: TextDocument, position: Position) {
  const line = document.lineAt(position.line).text
  const match = line.match(INCLUDE_RE)
  if (!match?.[1]) return

  const name = match[1]
  const upper = line.toUpperCase()
  const start = upper.indexOf(name.toUpperCase(), upper.indexOf("INCLUDE") + 7)
  if (start < 0) return

  const range = new Range(position.line, start, position.line, start + name.length)
  if (!range.contains(position)) return
  return { name: name.toUpperCase(), range }
}

interface CacheEntry {
  location: Location | undefined
  timestamp: number
}

export class IncludeDefinitionProvider implements DefinitionProvider {
  private static _instance: IncludeDefinitionProvider
  private cache = new Map<string, CacheEntry>()

  static get() {
    if (!this._instance) this._instance = new IncludeDefinitionProvider()
    return this._instance
  }

  async provideDefinition(document: TextDocument, position: Position, _token: CancellationToken) {
    if (!abapUri(document.uri)) return

    const hit = includeNameAt(document, position)
    if (!hit) return

    const connId = document.uri.authority
    const cacheKey = `${connId}::${hit.name}`

    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.location

    try {
      const client = getClient(connId)
      const root = getRoot(connId)

      for (const type of ["PROG/I", "PROG/P"]) {
        try {
          const results = await client.searchObject(hit.name, type)
          const exact = results.find(r => r["adtcore:name"].toUpperCase() === hit.name)
          if (!exact) continue

          const found = await root.findByAdtUri(exact["adtcore:uri"], true)
          if (!found?.path) continue

          const uri = Uri.parse("adt://" + connId).with({ path: found.path })
          const location = new Location(uri, new Position(0, 0))
          this.cache.set(cacheKey, { location, timestamp: Date.now() })
          return location
        } catch {
          // try next type
        }
      }
      this.cache.set(cacheKey, { location: undefined, timestamp: Date.now() })
    } catch (e) {
      log(`Include navigation failed for ${hit.name}: ${e}`)
    }
  }
}
