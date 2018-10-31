import { AdtConnection } from "./AdtConnection"
import { Uri, FileSystemError } from "vscode"
import { MetaFolder } from "../fs/MetaFolder"
import { AbapObjectNode, AbapNode } from "../fs/AbapNode"
import { pipePromise } from "../functions"
import { AbapObject } from "../abap/AbapObject"
import { getRemoteList } from "../config"
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
const uriParts = (uri: Uri): string[] =>
  uri.path
    .split("/")
    .filter((v, idx, arr) => (idx > 0 && idx < arr.length - 1) || v) //ignore empty at begginning or end

export class AdtServer {
  readonly connectionId: string
  readonly connectionP: Promise<AdtConnection>
  private root: MetaFolder

  findNode(uri: Uri): AbapNode {
    const parts = uriParts(uri)
    return parts.reduce((current: any, name) => {
      if (current && "getChild" in current) return current.getChild(name)
      throw FileSystemError.FileNotFound(uri)
    }, this.root)
  }

  findNodePromise(uri: Uri): Promise<AbapNode> {
    const parts = uriParts(uri)
    const promiseChild = (name: string) => (node: AbapNode) => {
      const child = node.getChild(name)
      if (child) return Promise.resolve(child)
      if (node.canRefresh()) {
        return this.connectionP
          .then(conn => {
            return node.refresh(conn)
          })
          .then(fresh => {
            const child = fresh.getChild(name)
            if (child) return child
            throw FileSystemError.FileNotFound(name)
          })
      } else throw FileSystemError.FileNotFound(name)
    }

    const rootProm = Promise.resolve(this.root)

    return parts.length === 0
      ? rootProm
      : pipePromise(...parts.map(promiseChild))(rootProm).then(
          node =>
            node.isFolder() && node.canRefresh()
              ? this.connectionP.then(conn => {
                  return node.refresh(conn)
                })
              : node
        )
  }

  constructor(connectionId: string) {
    const config = getRemoteList().filter(
      config => config.name.toLowerCase() === connectionId.toLowerCase()
    )[0]

    if (!config) throw new Error(`connection ${connectionId}`)

    const connection = AdtConnection.fromRemote(config)

    this.connectionId = config.name.toLowerCase()
    this.connectionP = connection.waitReady()
    connection.connect()

    this.root = new MetaFolder()
    this.root.setChild(
      `$TMP`,
      new AbapObjectNode(new AbapObject("DEVC/K", "$TMP", ADTBASEURL, "X"))
    )
    this.root.setChild(
      "System Library",
      new AbapObjectNode(new AbapObject("DEVC/K", "", ADTBASEURL, "X"))
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
