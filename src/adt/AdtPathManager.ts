import { AdtNode } from "./AdtNode"
import { Response } from "request"
import { getNodeStructureTreeContent, ObjectNode } from "./AdtParser"
import { getServer, AdtServer } from "./AdtServer"
import { fromObjectNode } from "./AbapObjectFactory"
import { Uri } from "vscode"

const asPromise = (x: AdtNode) => new Promise<AdtNode>(resolve => resolve(x))

export class AdtPathManager {
  getDirectory(uri: Uri): AdtNode | undefined {
    return getServer(uri.authority).getDirectory(uri.path)
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

  fetchFileOrDir(vsUrl: Uri): Promise<AdtNode> {
    const server = getServer(vsUrl.authority)

    const cached = server.getDirectory(vsUrl.path)
    if (cached && !cached.needRefresh()) {
      return asPromise(cached)
    }

    const url = server.actualUri(vsUrl)

    return server.connectionP
      .then(conn => conn.request(url, "POST"))
      .then(response => this.parse(vsUrl, response, server))
  }
}
