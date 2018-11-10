import { AdtConnection } from "./AdtConnection"
import { Uri, FileSystemError, FileType, commands } from "vscode"
import { MetaFolder } from "../fs/MetaFolder"
import { AbapObjectNode, AbapNode, isAbapNode } from "../fs/AbapNode"
import { AbapObject, TransportStatus, isAbapObject } from "../abap/AbapObject"
import { getRemoteList } from "../config"
import { selectTransport } from "./AdtTransports"
import { AdtObjectActivator } from "./AdtObjectActivator"
import { pick } from "../functions"
import { AdtObjectFinder } from "./AdtObjectFinder"
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
  readonly connection: AdtConnection
  private readonly activator: AdtObjectActivator
  private root: MetaFolder
  readonly objectFinder: Promise<AdtObjectFinder>

  constructor(connectionId: string) {
    const config = getRemoteList().filter(
      config => config.name.toLowerCase() === connectionId.toLowerCase()
    )[0]

    if (!config) throw new Error(`connection ${connectionId}`)

    this.connection = AdtConnection.fromRemote(config)
    this.activator = new AdtObjectActivator(this.connection)
    this.objectFinder = this.connection
      .connect()
      .then(pick("body"))
      .then(AdtObjectFinder.fromXML)

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

  async saveFile(file: AbapNode, content: Uint8Array): Promise<void> {
    if (file.isFolder()) throw FileSystemError.FileIsADirectory()
    if (!isAbapNode(file))
      throw FileSystemError.NoPermissions("Can only save source code")

    await file.abapObject.lock(this.connection)
    if (file.abapObject.transport === TransportStatus.REQUIRED) {
      const transport = await selectTransport(file.abapObject, this.connection)
      if (transport) file.abapObject.transport = transport
    }

    await file.abapObject.setContents(this.connection, content)

    await file.abapObject.unlock(this.connection)
    await file.stat(this.connection)
    //might have a race condition with user changing editor...
    commands.executeCommand("setContext", "abapfs:objectInactive", true)
  }

  findNode(uri: Uri): AbapNode {
    const parts = uriParts(uri)
    return parts.reduce((current: any, name) => {
      if (current && "getChild" in current) return current.getChild(name)
      throw FileSystemError.FileNotFound(uri)
    }, this.root)
  }

  async findAbapObject(uri: Uri): Promise<AbapObject> {
    const node = await this.findNodePromise(uri)
    if (isAbapNode(node)) return node.abapObject
    return Promise.reject(new Error("Not an abap object"))
  }

  async stat(uri: Uri) {
    const node = await this.findNodePromise(uri)
    if (node.canRefresh()) {
      if (node.type === FileType.Directory) await node.refresh(this.connection)
      else await node.stat(this.connection)
    }
    return node
  }

  async findNodePromise(uri: Uri): Promise<AbapNode> {
    let node: AbapNode = this.root
    const parts = uriParts(uri)
    for (const part of parts) {
      let next: AbapNode | undefined = node.getChild(part)
      if (!next && node.canRefresh()) {
        await node.refresh(this.connection)
        next = node.getChild(part)
      }
      if (next) node = next
      else return Promise.reject(FileSystemError.FileNotFound(uri))
    }

    return node
  }

  async activate(subject: AbapObject | Uri) {
    const obj = this.getObject(subject)
    return this.activator.activate(obj)
  }

  private getObject(subject: Uri | AbapObject): AbapObject {
    if (isAbapObject(subject)) return subject
    const node = this.findNode(subject)
    if (isAbapNode(node)) return node.abapObject
    throw new Error(`Path ${subject.path} is not an ABAP object`)
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
