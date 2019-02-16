import { Uri, FileSystemError, FileType, commands, window } from "vscode"
import { MetaFolder } from "../fs/MetaFolder"
import { AbapObjectNode, AbapNode, isAbapNode } from "../fs/AbapNode"
import { AbapObject, TransportStatus, isAbapObject } from "./abap/AbapObject"
import { createClient, configFromId } from "../config"
import { selectTransport } from "./AdtTransports"
import { AdtObjectActivator } from "./operations/AdtObjectActivator"
import { AdtObjectFinder } from "./operations/AdtObjectFinder"
import { AdtObjectCreator, PACKAGE } from "./operations/AdtObjectCreator"
import { LockManager } from "./operations/LockManager"
import { SapGui } from "./sapgui/sapgui"
import { ADTClient, adtException, isCreatableTypeId } from "abap-adt-api"
import { isString } from "util"
export const ADTBASEURL = "/sap/bc/adt/repository/nodestructure"
export const ADTSCHEME = "adt"
/**
 * Split a vscode URI. Parts will then be used to navigate the path
 *
 * @param uri vscode URI
 */
const uriParts = (uri: Uri): string[] =>
  uri.path
    .split("/")
    .filter((v, idx, arr) => (idx > 0 && idx < arr.length - 1) || v) // ignore empty at beginning or end
/**
 * centralizes most API accesses
 * some will be delegated/provided from members or ABAP object nodes
 */
export class AdtServer {
  public readonly root: MetaFolder
  public readonly objectFinder: AdtObjectFinder
  public readonly creator: AdtObjectCreator
  public readonly lockManager: LockManager
  public readonly sapGui: SapGui
  public readonly client: ADTClient
  public readonly activator: AdtObjectActivator
  private lastRefreshed?: string

  /**
   * Creates a server object and all its dependencies
   *
   * @param connectionId ADT connection ID
   */
  constructor(readonly connectionId: string) {
    const config = configFromId(connectionId)

    if (!config) throw new Error(`connection ${connectionId}`)
    this.client = createClient(config)
    // utility components
    this.creator = new AdtObjectCreator(this)
    this.activator = new AdtObjectActivator(this.client)
    this.objectFinder = new AdtObjectFinder(this)
    this.lockManager = new LockManager(this.client)
    this.sapGui = SapGui.create(config)

    // root folder
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
  public async delete(uri: Uri) {
    const file = this.findNode(uri)
    if (isAbapNode(file)) {
      const obj = file.abapObject
      if (!isCreatableTypeId(obj.type))
        throw FileSystemError.NoPermissions(
          "Only allowed to delete abap objects can be created"
        )

      try {
        await this.lockManager.lock(obj)
        const transport = await this.selectTransportIfNeeded(obj)
        if (!transport.cancelled)
          await this.client.deleteObject(
            obj.path,
            this.lockManager.getLockId(obj),
            transport.transport
          )
      } finally {
        await this.lockManager.unlock(obj)
      }
    } else
      throw FileSystemError.NoPermissions("Only abap objects can be deleted")
  }
  /**
   * Refresh a directory
   * Workaround for ADT bug: when a session is stateful, it caches package contents
   * to invalidate the cache, read contents of another package
   *
   * @param dir the directory to refresh
   */
  public async refreshDirIfNeeded(dir: AbapNode) {
    if (dir.canRefresh()) {
      /* Workaround for ADT bug: when a session is stateful, it caches package contents
       * to invalidate the cache, read contents of another package
       * but only do that if it was the last package read*/
      if (this.client.isStateful) {
        if (isAbapNode(dir) && dir.abapObject.type === PACKAGE) {
          if (this.lastRefreshed === dir.abapObject.name) {
            await this.client.nodeContents(
              PACKAGE,
              this.lastRefreshed === "$TMP" ? "SEU_ADT" : "$TMP"
            )
          }

          this.lastRefreshed = dir.abapObject.name
        }
      } else this.lastRefreshed = undefined

      await dir.refresh(this.client)
    }
  }

  public createUri(path: string, query: string = "") {
    return Uri.parse("adt://" + this.connectionId).with({
      path,
      query
    })
  }

  /**
   * saves an ABAP object
   *
   * @param file the ABAP node being saved
   * @param content the source of the ABAP file
   */
  public async saveFile(file: AbapNode, content: Uint8Array): Promise<void> {
    if (file.isFolder) throw FileSystemError.FileIsADirectory()
    if (!isAbapNode(file))
      throw FileSystemError.NoPermissions("Can only save source code")

    const obj = file.abapObject
    // check file is locked
    if (!this.lockManager.isLocked(obj))
      throw adtException(`Object not locked ${obj.type} ${obj.name}`)

    const transport = await this.selectTransportIfNeeded(obj)

    if (!transport.cancelled) {
      const lockId = this.lockManager.getLockId(obj)
      await obj.setContents(this.client, content, lockId)

      await file.stat(this.client)
      await this.lockManager.unlock(obj)
      // might have a race condition with user changing editor...
      commands.executeCommand("setContext", "abapfs:objectInactive", true)
    }
  }

  /**
   * converts vscode URI to ADT URI
   * @see findNodeHierarchy for more details
   *
   * @param uri vscode URI
   */
  public findNode(uri: Uri): AbapNode {
    return this.findNodeHierarchy(uri)[0]
  }

  /**
   * @summary Given a vs code URL, navigate the tree to find the ADT URI.
   * Returns a list of the nodes to traverse to get there from root,
   *   with the first element being the requested object, the last the FS root
   *
   * @abstract visual studio paths are hierarchic, adt ones aren't
   * so we need a way to translate the hierarchic ones to the original ones
   * this file is concerned with telling whether a path is a real ADT one or one from vscode
   * /sap/bc/adt/repository/nodestructure (with empty query) is the root of both
   * also, several objects have namespaces.
   *  Class /foo/bar of package /foo/baz in code will have a path like
   *    /sap/bc/adt/repository/nodestructure/foo/baz/foo/bar
   *  the actual adt path would be something like:
   *    /sap/bc/adt/oo/classes/%2Ffoo%2Fbar
   *  so we need to do quite a bit of transcoding
   *
   * @param uri VSCode URI
   */
  public findNodeHierarchy(uri: Uri): AbapNode[] {
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
  public async findNodePromise(uri: Uri): Promise<AbapNode> {
    let node: AbapNode = this.root
    let refreshable: AbapNode | undefined = node.canRefresh() ? node : undefined
    const parts = uriParts(uri)

    for (const part of parts) {
      let next: AbapNode | undefined = node.getChild(part)
      if (!next && refreshable) {
        // refreshable will typically be the current node or its first abap parent (usually a package)
        await refreshable.refresh(this.client)
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
  public async findAbapObject(uri: Uri): Promise<AbapObject> {
    const node = await this.findNodePromise(uri)
    if (isAbapNode(node)) return node.abapObject
    return Promise.reject(new Error("Not an abap object"))
  }

  /**
   * finds the details of a node, and refreshes them from server if needed
   *
   * @param uri VSCode URI
   */
  public async stat(uri: Uri) {
    const node = await this.findNodePromise(uri)
    if (node.canRefresh()) {
      if (node.type === FileType.Directory) await node.refresh(this.client)
      else await node.stat(this.client)
    }
    return node
  }

  /**
   * Activates an abap object
   *
   * @param subject Object or vscode URI to activate
   */
  public async activate(subject: AbapObject | Uri) {
    const obj = this.getObject(subject)
    return this.activator.activate(obj)
  }

  public async getReentranceTicket() {
    return this.client.reentranceTicket()
  }

  private async selectTransportIfNeeded(obj: AbapObject) {
    if (obj.transport === TransportStatus.REQUIRED) {
      const transport = await selectTransport(
        obj.getContentsUri(),
        "",
        this.client
      )
      if (transport.transport) obj.transport = transport.transport
      return transport
    }
    return {
      transport: isString(obj.transport) ? obj.transport : "",
      cancelled: false
    }
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
export async function disconnect() {
  const promises: Array<Promise<any>> = []
  let haslocks = false
  for (const server of servers) {
    if (server[1].lockManager.lockedObjects.length > 0) haslocks = true
    promises.push(server[1].client.dropSession())
  }
  if (haslocks)
    window.showInformationMessage("All locked files will be unlocked")
  await Promise.all(promises)
}
export function lockedFiles() {
  return [...servers]
    .map(s => ({
      connectionId: s[0],
      locked: s[1].lockManager.lockedObjects.length
    }))
    .filter(f => f.locked > 0)
}
