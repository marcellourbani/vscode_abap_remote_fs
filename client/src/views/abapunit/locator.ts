import { Uri, Position } from "vscode"
import { getClient, getRoot } from "../../adt/conections"
import {
  AbapStat,
  AbapFile,
  isAbapStat,
  isAbapFolder,
  isAbapFile
} from "abapfs"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"

export class MethodLocator {
  private objSource = new Map<string, string>()

  constructor(private connId: string) {}

  private async getSource(node: AbapFile) {
    const cached = this.objSource.get(node.object.key)
    if (cached) return cached
    const source = await node.read()
    this.objSource.set(node.object.key, source)
    return source
  }

  public clear() {
    this.objSource.clear()
  }

  private async methodImplementation(uri: string, pos: Position) {
    const root = getRoot(this.connId)
    const node = root.getNode(Uri.parse(uri).path)

    if (isAbapFile(node)) {
      if (!node.object.structure) await node.object.loadStructure()
      const contantsUrl = node.object.contentsPath()
      const source = await this.getSource(node)
      return getClient(this.connId).findDefinition(
        contantsUrl,
        source,
        pos.line + 1,
        pos.character,
        pos.character,
        false
      )
    }
  }

  public async methodLocation(objectUri: string, objectType: string) {
    const finder = new AdtObjectFinder(this.connId)
    const { uri, start } = await finder.vscodeRange(objectUri)
    if (start)
      if (objectType === "PROG/OLI" || objectType.match(/^CLAS\/OCN/))
        return { uri, line: start.line }
      else {
        const impl = await this.methodImplementation(uri, start)
        // if (impl) met.line = impl.line - 1
        if (impl) {
          if (impl.url === uri) return { uri, line: impl.line - 1 }
          const implLoc = await finder.vscodeRange(impl.url)
          if (implLoc) return { uri: implLoc.uri, line: impl.line - 1 }
        }
      }
    return { uri }
  }
}
