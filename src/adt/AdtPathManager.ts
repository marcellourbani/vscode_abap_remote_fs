import { AdtNode } from "./AdtNode"
import { Response } from "request"
import { getNodeStructureTreeContent, ObjectNode } from "./AdtParser"
import { Uri, FileSystemError } from "vscode"
import { isValid } from "./AdtPathClassifier"
import { getServer, AdtServer } from "./AdtServer"
import { fromObjectNode } from "./AbapObjectFactory"

const asPromise = (x: AdtNode) => new Promise<AdtNode>(resolve => resolve(x))

export class AdtPathManager {
  getDirectory(uri: Uri): AdtNode | undefined {
    return getServer(uri.authority).getDirectory(uri.path)
  }

  private actualUri(original: Uri): Uri {
    if (!isValid(original)) throw FileSystemError.FileNotFound(original)
    return original
  }

  parse(uri: Uri, response: Response, server: AdtServer): Promise<AdtNode> {
    return getNodeStructureTreeContent(response.body).then(
      (children: ObjectNode[]) => {
        const node = new AdtNode(uri)
        server.addNodes(node, children.map(fromObjectNode))

        return node
      }
    )
  }

  fetchFileOrDir(url: Uri): Promise<AdtNode> {
    const server = getServer(url.authority)
    url = this.actualUri(url)

    const cached = server.getDirectory(url.path)
    if (cached && !cached.needRefresh()) {
      return asPromise(cached)
    }
    if (cached) return asPromise(cached)

    return server.connectionP
      .then(conn => conn.vsRequest(url))
      .then(response => this.parse(url, response, server))
  }
}
