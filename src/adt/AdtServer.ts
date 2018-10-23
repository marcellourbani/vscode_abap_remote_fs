import { AdtConnectionManager } from "./AdtConnectionManager"
import { AdtConnection } from "./AdtConnection"
import { AdtNode } from "./AdtNode"
import { Uri } from "vscode"
import { AbapObject } from "./AbapObject"

export class AdtServer {
  readonly connectionId: string
  readonly connectionP: Promise<AdtConnection>
  private directories: Map<string, AdtNode> = new Map()
  private objectUris: Map<string, Uri> = new Map()

  private addChildrenToNs(node: AdtNode, objects: AbapObject[]) {
    objects.forEach(object => {
      const childname = node.childPath(object.nameinns())
      const child = new AdtNode(node.uri.with({ path: childname }))
      node.entries.set(object.nameinns(), child)
      this.objectUris.set(childname, object.getUri(node.uri))
    })
  }

  addNodes(parent: AdtNode, objects: AbapObject[]) {
    this.directories.set(parent.uri.path, parent)
    const namespaces = objects.reduce((map, obj) => {
      const nsname = obj.namespace()
      let ns = map.get(nsname)
      if (!ns) {
        ns = []
        map.set(nsname, ns)
      }
      ns.push(obj)
      return map
    }, new Map<string, AbapObject[]>())

    namespaces.forEach((objects, name) => {
      if (name === "") this.addChildrenToNs(parent, objects)
      else {
        const nodeName = parent.childPath(name)
        const node = new AdtNode(parent.uri.with({ path: nodeName }))
        parent.entries.set(name, node)
        this.addChildrenToNs(node, objects)
        this.directories.set(nodeName, node)
      }
    })
  }

  getDirectory(name: string): AdtNode | undefined {
    return this.directories.get(name)
  }

  constructor(connectionId: string) {
    this.connectionId = connectionId
    this.connectionP = AdtConnectionManager.getManager().findConn(connectionId)
  }
}
const servers = new Map<string, AdtServer>()
export const getServer = (connId: string): AdtServer => {
  let server = servers.get(connId)
  if (!server) {
    server = new AdtServer(connId)
    servers.set(connId, server)
  }
  return server
}
