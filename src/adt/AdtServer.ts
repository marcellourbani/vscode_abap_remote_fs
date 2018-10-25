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

  actualUri(original: Uri): Uri {
    if (!isValid(original)) throw FileSystemError.FileNotFound(original)
    return this.objectUris.get(original.path) || original
  }

  addNodes(parent: AdtNode, objects: AbapObject[]) {
    this.directories.set(parent.uri.path, parent)
    objects.forEach(object => {
      const childname = parent.childPath(object.vsName())
      const child = new AdtNode(
        parent.uri.with({ path: childname }),
        !object.isLeaf(),
        false
      )
      parent.entries.set(object.vsName(), child)
      this.objectUris.set(childname, object.getUri(parent.uri))
      if (child.type === FileType.Directory)
        this.directories.set(childname, child)
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
