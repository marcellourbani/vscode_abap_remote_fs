import { AdtConnectionManager } from "./AdtConnectionManager"
import { AdtConnection } from "./AdtConnection"
import { AdtNode } from "./AdtNode"
import { Uri, FileSystemError, FileType } from "vscode"
import { AbapObject } from "../abap/AbapObject"
// visual studio paths are hierarchic, adt ones aren't
// so we need a way to translate the hierarchic ones to the original ones
// this file is concerned with telling whether a path is a real ADT one or one from vscode
// /sap/bc/adt/repository/nodestructure (with ampty query) is the root of both
// also, several objects have namespaces.
//  Class /foo/bar of package /foo/baz in code will have a path like
//    /sap/bc/adt/repository/nodestructure/foo/baz/foo/bar
//  the actual adt path would be something like:
//    /sap/bc/adt/oo/classes/%2Ffoo%2Fbar
//  so we need to do quite a bit of transcoding
const isValid = (vsUri: Uri): boolean => {
  const matches = vsUri.path.match(
    /^\/sap\/bc\/adt\/repository\/nodestructure\/?(.*)/i
  )
  return !!(matches && !matches[1].match(/^\./))
}
export class AdtServer {
  readonly connectionId: string
  readonly connectionP: Promise<AdtConnection>
  private directories: Map<string, AdtNode> = new Map()
  private objectUris: Map<string, Uri> = new Map()

  private addChildrenToNs(node: AdtNode, objects: AbapObject[]) {
    objects.forEach(object => {
      const childname = node.childPath(object.nameinns())
      const child = new AdtNode(
        node.uri.with({ path: childname }),
        !object.isLeaf(),
        false
      )
      node.entries.set(object.nameinns(), child)
      this.objectUris.set(childname, object.getUri(node.uri))
      if(child.type=== FileType.Directory)this.directories.set(childname,child)
    })
  }

  actualUri(original: Uri): Uri {
    if (!isValid(original)) throw FileSystemError.FileNotFound(original)
    return this.objectUris.get(original.path) || original
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

    //for every namespace create a node, add the children to it
    // so package /foo/bar will be rendered in
    //  a namespace folder foo
    //  with a package bar inside
    namespaces.forEach((objects, name) => {
      if (name !== "") {
        const nodeName = parent.childPath(name)
        const node = new AdtNode(
          parent.uri.with({ path: nodeName }),
          true,
          true
        )
        parent.entries.set(name, node)
        this.addChildrenToNs(node, objects)
        this.directories.set(nodeName, node)
      }
    })
    //add objects without a namespace
    namespaces.forEach((objects, name) => {
      if (name === "") this.addChildrenToNs(parent, objects)
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
