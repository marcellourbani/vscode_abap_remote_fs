import { getServer } from "../../adt/AdtServer"
import { Uri, Position } from "vscode"
import { isAbapNode, AbapObjectNode } from "../../fs/AbapNode"

export class MethodLocator {
  private objSource = new Map<string, string>()

  constructor(private connId: string) {}

  private async getSource(node: AbapObjectNode) {
    const cached = this.objSource.get(node.abapObject.key)
    if (cached) return cached
    const client = getServer(this.connId).client
    const source = (await node.fetchContents(client)).toString()
    this.objSource.set(node.abapObject.key, source)
    return source
  }

  public clear() {
    this.objSource.clear()
  }

  private async methodImplementation(uri: string, pos: Position) {
    const server = getServer(this.connId)
    const node = server.findNode(Uri.parse(uri))

    if (isAbapNode(node)) {
      if (!node.abapObject.structure)
        await node.abapObject.loadMetadata(server.client)
      const contantsUrl = node.abapObject.getContentsUri()
      const source = await this.getSource(node)
      return server.client.findDefinition(
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
    const finder = getServer(this.connId).objectFinder
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
