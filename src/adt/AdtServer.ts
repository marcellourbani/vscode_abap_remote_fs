import { AdtConnectionManager } from "./AdtConnectionManager"
import { AdtConnection } from "./AdtConnection"
import { Uri, FileSystemError, FileType } from "vscode"
import { AbapMetaFolder } from "../fs/AbapMetaFolder"
import { AbapObjectNode, AbapNode } from "../fs/AbapNode"
import { AbapPackage } from "../abap/AbapPackage"
import { mapWidth, pipe, pipePromise } from "../functions"
export const ADTBASEURL = "/sap/bc/adt/repository/nodestructure"

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

export class AdtServer {
  readonly connectionId: string
  readonly connectionP: Promise<AdtConnection>
  private root: AbapMetaFolder

  findNode(uri: Uri): AbapNode {
    const parts = uri.path.split("/").slice(1)
    return parts.reduce((current: any, name) => {
      if (current && "getChild" in current) return current.getChild(name)
      throw FileSystemError.FileNotFound(uri)
    }, this.root)
  }

  findNodePromise(uri: Uri): Promise<AbapNode> {
    const parts = uri.path.split("/").slice(1)

    const promiseChild = (name: string) => (node: AbapNode) =>
      this.connectionP.then(node.refresh).then(fresh => {
        const child = fresh.getChild(name)
        if (child) return child
        throw FileSystemError.FileNotFound(name)
      })

    const rootProm = Promise.resolve(this.root)

    return parts.length === 0
      ? rootProm
      : pipePromise(...parts.map(promiseChild))(rootProm)

    const nextp = (name: string) => (
      parentP: Promise<AbapNode>
    ): Promise<AbapNode> =>
      parentP.then(parent => {
        if (parent.type === FileType.Directory) {
          let child = parent.getChild(name)
          if (child) return child
          if (parent instanceof AbapObjectNode)
            this.connectionP.then(parent.refresh)
        }
        throw FileSystemError.FileNotFound(uri)
      })
    const chained = pipe(mapWidth(nextp, parts))

    return Promise.resolve(this.root).then(chained)
  }

  constructor(connectionId: string) {
    this.connectionId = connectionId
    this.connectionP = AdtConnectionManager.getManager().findConn(connectionId)
    this.root = new AbapMetaFolder()
    this.root.setChild(
      "Local",
      new AbapObjectNode(new AbapPackage("DEVC/K", "$TMP", ADTBASEURL))
    )
    this.root.setChild(
      "System Library",
      new AbapObjectNode(new AbapPackage("DEVC/K", "", ADTBASEURL))
    )
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
export const fromUri = (uri: Uri) => {
  if (uri.scheme === "adt") return getServer(uri.authority)
  throw FileSystemError.FileNotFound(uri)
}
