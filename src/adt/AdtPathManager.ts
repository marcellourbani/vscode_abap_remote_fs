import { AdtNode } from "./AdtNode"
import { Response } from "request"
import { getNodeStructureTreeContent, ObjectNode } from "./AdtParser"
import { getServer, AdtServer } from "./AdtServer"
import { fromObjectNode } from "../abap/AbapObjectFactory"
import { Uri, FileSystemError, FileType } from "vscode"
const nodeTypeValid = (node: ObjectNode): boolean => {
  return !node.OBJECT_TYPE.match(/(FUGR\/P.)/)
}

export class AdtPathManager {
  getDirectory(uri: Uri): AdtNode | undefined {
    return getServer(uri.authority).getDirectory(uri.path)
  }
  find(uri: Uri): AdtNode | undefined {
    const server = getServer(uri.authority)
    let node = server.getDirectory(uri.path)
    if (node) return node
    const matches = uri.path.match(/(.*)\/([^\/]+)$/)
    if (matches) {
      const [dir, name] = matches.slice(1)
      let parent = server.getDirectory(dir)
      let node = parent && parent.entries.get(name)
      if (node) return node
    }
  }

  parse(
    uri: Uri,
    response: Response,
    server: AdtServer,
    node: AdtNode | undefined
  ): Promise<AdtNode> | AdtNode {
    if (
      response.request.uri.path &&
      response.request.uri.path.match(/\/nodestructure/i)
    )
      return getNodeStructureTreeContent(response.body).then(
        (children: ObjectNode[]) => {
          if (node) node.entries.clear()
          else node = new AdtNode(uri, true, true)
          server.addNodes(
            node,
            children.filter(nodeTypeValid).map(fromObjectNode)
          )
          node.fetched = true
          return node
        }
      )
    else if (node && node.type === FileType.File) {
      node.setContents(response.body)
      return node
    }
    throw FileSystemError.FileNotFound(uri.path)
  }

  fetchFileOrDir(vsUrl: Uri): Promise<AdtNode> | AdtNode {
    const server = getServer(vsUrl.authority)

    const cached = this.find(vsUrl)
    if (cached && !cached.needRefresh()) {
      return cached
    }

    const url = server.actualUri(vsUrl)

    return server.connectionP
      .then(conn => conn.request(url, this.getMethod(url)))
      .then(response => this.parse(vsUrl, response, server, cached))
  }
  getMethod(uri: Uri): string {
    return uri.path.match(/\/nodestructure/i) ? "POST" : "GET"
  }
}
