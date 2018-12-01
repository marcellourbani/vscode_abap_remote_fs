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
import { AdtObjectCreator } from "./create/AdtObjectCreator"
import { PACKAGE } from "./create/AdtObjectTypes"
export const ADTBASEURL = "/sap/bc/adt/repository/nodestructure"

/**
 * Split a vscode URI. Parts will then be used to navigate the path
 *
 * @param uri vscode URI
 */
const uriParts = (uri: Uri): string[] =>
  uri.path
    .split("/")
    .filter((v, idx, arr) => (idx > 0 && idx < arr.length - 1) || v) //ignore empty at begginning or end
/**
 * centralizes most API accesses
 * some will be delegated/provided from members or ABAP object nodes
 */
export class AdtServer {
  readonly connection: AdtConnection
  private readonly activator: AdtObjectActivator
  readonly root: MetaFolder
  readonly objectFinder: AdtObjectFinder
  creator: AdtObjectCreator
  private lastRefreshed?: string

  /**
   * Creates a server object and all its dependencies
   *
   * @param connectionId ADT connection ID
   */
  constructor(connectionId: string) {
    const config = getRemoteList().filter(
      config => config.name.toLowerCase() === connectionId.toLowerCase()
    )[0]

    if (!config) throw new Error(`connection ${connectionId}`)

    this.connection = AdtConnection.fromRemote(config)
    //utility components
    this.creator = new AdtObjectCreator(this)
    this.activator = new AdtObjectActivator(this.connection)
    this.objectFinder = new AdtObjectFinder(this.connection)
    this.connection
      .connect()
      .then(pick("body"))
      .then(this.objectFinder.setTypes.bind(this))

    //root folder
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
  /**
   * Refresh a directory
   * Workaround for ADT bug: when a session is stateful, it caches package contents
   * to invalidate the cache, read contents of another package
   *
   * @param dir the directory to refresh
   */
  async refreshDirIfNeeded(dir: AbapNode) {
    if (dir.canRefresh()) {
      /* Workaround for ADT bug: when a session is stateful, it caches package contents
       * to invalidate the cache, read contents of another package
       * but only do that if it was the last package read*/
      if (this.connection.stateful) {
        if (isAbapNode(dir) && dir.abapObject.type === PACKAGE) {
          if (this.lastRefreshed === dir.abapObject.name) {
            this.connection.request(
              await this.connection.createUri(
                "/sap/bc/adt/repository/nodestructure",
                `parent_name=${this.lastRefreshed ? "SEU_ADT" : "%24TMP"}`
              ),
              "POST"
            )
          }

          this.lastRefreshed = dir.abapObject.name
        }
      } else this.lastRefreshed = undefined

      await dir.refresh(this.connection)
    }
  }

  /**
   * saves an ABAP object
   *
   * @param file the ABAP node being saved
   * @param content the source of the ABAP file
   */
  async saveFile(file: AbapNode, content: Uint8Array): Promise<void> {
    if (file.isFolder) throw FileSystemError.FileIsADirectory()
    if (!isAbapNode(file))
      throw FileSystemError.NoPermissions("Can only save source code")

    await file.abapObject.lock(this.connection)
    if (file.abapObject.transport === TransportStatus.REQUIRED) {
      const transport = await selectTransport(
        file.abapObject.getContentsUri(this.connection),
        "",
        this.connection
      )
      if (transport) file.abapObject.transport = transport
    }

    await file.abapObject.setContents(this.connection, content)

    await file.abapObject.unlock(this.connection)
    await file.stat(this.connection)
    //might have a race condition with user changing editor...
    commands.executeCommand("setContext", "abapfs:objectInactive", true)
  }

  /**
   * converts vscode URI to ADT URI
   * @see findNodeHierarcy for more details
   *
   * @param uri vscode URI
   */
  findNode(uri: Uri): AbapNode {
    return this.findNodeHierarcy(uri)[0]
  }

  /**
   * @summary Given a vs code URL, navigate the tree to find the ADT URI.
   * Returns a list of the nodes to traverse to get there from root,
   *   with the first element being the requested object, the last the FS root
   *
   * @abstract visual studio paths are hierarchic, adt ones aren't
   * so we need a way to translate the hierarchic ones to the original ones
   * this file is concerned with telling whether a path is a real ADT one or one from vscode
   * /sap/bc/adt/repository/nodestructure (with ampty query) is the root of both
   * also, several objects have namespaces.
   *  Class /foo/bar of package /foo/baz in code will have a path like
   *    /sap/bc/adt/repository/nodestructure/foo/baz/foo/bar
   *  the actual adt path would be something like:
   *    /sap/bc/adt/oo/classes/%2Ffoo%2Fbar
   *  so we need to do quite a bit of transcoding
   *
   * @param uri VSCode URI
   */
  findNodeHierarcy(uri: Uri): AbapNode[] {
    const parts = uriParts(uri)
    return parts.reduce(
      (current: AbapNode[], name) => {
        const folder = current[0]
        const child = folder.isFolder && folder.getChild(name)
        if (!child) throw FileSystemError.FileNotFound(uri)

        current.unshift(child)
        return current
      },
      [this.root]
    )
  }

  /**
   * converts a VSCode URI to an ADT one
   * similar to {@link findNode} but asynchronous.
   * When it fails to find a node child will try to refresh it from the server before raising an exception
   *
   * @param uri VSCode URI
   */
  async findNodePromise(uri: Uri): Promise<AbapNode> {
    let node: AbapNode = this.root
    let refreshable: AbapNode | undefined = node.canRefresh() ? node : undefined
    const parts = uriParts(uri)

    for (const part of parts) {
      let next: AbapNode | undefined = node.getChild(part)
      if (!next && refreshable) {
        //refreshable will tipically be the current node or its first abap parent (usually a package)
        await refreshable.refresh(this.connection)
        next = node.getChild(part)
      }
      if (next) {
        node = next
        if (node.canRefresh()) refreshable = node
      } else return Promise.reject(FileSystemError.FileNotFound(uri))
    }

    return node
  }
  /**
   * like {@link findNodePromise}, but raises an exception if the node is not an ABAP object
   *
   * @param uri VSCode URI
   */
  async findAbapObject(uri: Uri): Promise<AbapObject> {
    const node = await this.findNodePromise(uri)
    if (isAbapNode(node)) return node.abapObject
    return Promise.reject(new Error("Not an abap object"))
  }

  /**
   * finds the details of a node, and refreshes them from server if needed
   *
   * @param uri VSCode URI
   */
  async stat(uri: Uri) {
    const node = await this.findNodePromise(uri)
    if (node.canRefresh()) {
      if (node.type === FileType.Directory) await node.refresh(this.connection)
      else await node.stat(this.connection)
    }
    return node
  }

  /**
   * Activates an abap object
   *
   * @param subject Object or vscode URI to activate
   */
  async activate(subject: AbapObject | Uri) {
    const obj = this.getObject(subject)
    return this.activator.activate(obj)
  }

  /**
   * utility function to convert an URI to an abap object if needed
   * If passed an abap object it just returns it
   * If passed an URI it traverses the tree until it finds an abap object and returns it, or raises an exception
   *
   * @param subject Abap object or VSCode URI
   */
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
