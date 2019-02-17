import { FileStat, Uri, FileType } from "vscode"
import { AbapObjectNode } from "../fs/AbapNode"

export class AdtSymLinkCollection {
  private links: Map<string, AbapObjectNode> = new Map()

  public getNode(uri: Uri): FileStat | undefined {
    const node = this.links.get(uri.path)
    if (node)
      return {
        // tslint:disable-next-line: no-bitwise
        type: FileType.SymbolicLink | node.type,
        ctime: node.ctime,
        mtime: node.mtime,
        size: node.size
      }
  }

  public getRealNode(uri: Uri) {
    return this.links.get(uri.path)
  }

  public updateLink(uri: Uri, node: AbapObjectNode) {
    this.links.set(uri.path, node)
  }

  public isSymlink(uri: Uri) {
    return !!uri.path.match(/^\/sap\/bc\/adt/)
  }
}
