import { Uri, Position } from "vscode"
import { getClient, getRoot } from "../../adt/conections"
import {
  AbapFile,
  isAbapFile
} from "abapfs"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { IncludeService } from "../../adt/includes"
import { AbapObject } from "abapobject"

export class MethodLocator {
  private objSource = new Map<string, string>()

  constructor(private connId: string) { }

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

  private getMain(object: AbapObject, uri: string) {
    const service = IncludeService.get(this.connId)
    if (!service.needMain(object)) return
    const main = service.current(uri)
    return main?.["adtcore:uri"]
  }

  private async methodImplementation(uristr: string, pos: Position) {
    const root = getRoot(this.connId)
    const uri = Uri.parse(uristr)
    const node = root.getNode(uri.path)

    if (isAbapFile(node)) {
      if (!node.object.structure) await node.object.loadStructure()
      const contentsUrl = node.object.contentsPath()
      const source = await this.getSource(node)
      const mainInclude = this.getMain(node.object, uri.path)
      return getClient(this.connId).findDefinition(
        contentsUrl,
        source,
        pos.line + 1,
        pos.character,
        pos.character,
        false,
        mainInclude
      )
    }
  }

  public async methodLocation(objectUri: string) {
    const finder = new AdtObjectFinder(this.connId)
    const { uri, start } = await finder.vscodeRange(objectUri)
    if (start) return { uri, line: start.line }
    return { uri }
  }
}
