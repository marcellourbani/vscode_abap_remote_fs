import { AdtSymLinkCollection } from "./AdtSymbolicLinks"
import { Uri, FileSystemError, FileType, window, EventEmitter } from "vscode"
import { MetaFolder } from "../fs/MetaFolder"
import { AbapObjectNode, AbapNode, isAbapNode } from "../fs/AbapNode"
import { AbapObject, TransportStatus, isAbapObject } from "./abap/AbapObject"
import { selectTransport, trSel } from "./AdtTransports"
import { AdtObjectActivator } from "./operations/AdtObjectActivator"
import { AdtObjectFinder } from "./operations/AdtObjectFinder"
import {
  AdtObjectCreator,
  PACKAGE,
  TMPPACKAGE
} from "./operations/AdtObjectCreator"
import {
  LockManager,
  isExpired,
  reconnectExpired
} from "./operations/LockManager"
import { SapGui } from "./sapgui/sapgui"
import {
  ADTClient,
  adtException,
  isCreatableTypeId,
  session_types
} from "abap-adt-api"
import { isString } from "../lib"
import {
  findObjectInNodeByPath,
  abapObjectFromNode
} from "./abap/AbapObjectUtilities"
import { activationStateListener } from "../listeners"
import { CancellationTokenSource } from "vscode-jsonrpc"
import { RemoteManager, RemoteConfig, formatKey, createClient } from "../config"
export const ADTBASEURL = "/sap/bc/adt/repository/nodestructure"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//
const LOCKEXPIRED = "ExceptionResourceInvalidLockHandle"
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
  public readonly sapGui: SapGui
  public readonly client: ADTClient
  public readonly activator: AdtObjectActivator
  private symLinks = new AdtSymLinkCollection()
  private activationStatusEmitter = new EventEmitter<Uri>()
  private lastRefresh?: { node: AbapNode; current: Promise<AbapNode> }

  /**
   * Creates a server object and all its dependencies
   *
   * @param connectionId ADT connection ID
   */
  constructor(
    readonly connectionId: string,
    private mainClient: ADTClient,
    config: RemoteConfig
  ) {
    this.client = this.mainClient.statelessClone
    this.activationStatusEmitter.event(activationStateListener)

    // utility components
    this.creator = new AdtObjectCreator(this)
    this.activator = new AdtObjectActivator(this.client)
    this.objectFinder = new AdtObjectFinder(this)
    this.sapGui = SapGui.create(config)

    // root folder
    this.root = new MetaFolder()
    this.root.setChild(
      TMPPACKAGE,
      new AbapObjectNode(new AbapObject(PACKAGE, TMPPACKAGE, ADTBASEURL, "X"))
    )
    this.root.setChild(
      "System Library",
      new AbapObjectNode(new AbapObject(PACKAGE, "", ADTBASEURL, "X"))
    )
  }

  // used by runInSession
  private currentCall = Promise.resolve()
  private currentCancel = new CancellationTokenSource()

  /**
   * Runs the given callback in a (possibly) stateful session
   * All callbacks are queued
   *
   * @template T the callback's promised payload
   * @param {(client: ADTClient) => Promise<T>} callback
   * @returns {Promise<T>}
   * @memberof AdtServer
   */
  public async runInSession<T>(
    callback: (client: ADTClient) => Promise<T>
  ): Promise<T> {
    const token = this.currentCancel.token
    return new Promise((resolve, reject) => {
      this.currentCall = this.currentCall.then(async () => {
        try {
          if (token.isCancellationRequested) reject("Cancelled")
          // if the callback resolves so will thhe returned promise
          resolve(await callback(this.mainClient))
        } catch (error) {
          // reject the external promise, the inner one will always resolve
          reject(error)
        }
      })
    })
  }

  public async relogin() {
    this.currentCancel.cancel()
    this.currentCancel = new CancellationTokenSource()
    this.currentCall = Promise.resolve()
    if (this.mainClient.stateful === session_types.stateful) {
      try {
        this.mainClient.stateful = session_types.stateless
        // juts in case I have pending locks...
        await this.mainClient.logout()
      } catch (error) {
        // ignore
      }
      await this.mainClient.login()
    }
  }

  public async delete(uri: Uri) {
    const hier = this.findNodeHierarchy(uri)
    const file = hier && hier[0]
    if (isAbapNode(file)) {
      const obj = file.abapObject
      if (!isCreatableTypeId(obj.type))
        throw FileSystemError.NoPermissions(
          "Only allowed to delete abap objects can be created"
        )

      const lm = LockManager.get()
      try {
        await lm.lock(uri)
        const transport = await this.selectTransportIfNeeded(
          obj,
          lm.getTransport(uri)
        )
        if (transport.cancelled)
          throw new Error("A transport is required to perform the deletion")
        await this.runInSession(client =>
          client.deleteObject(obj.path, lm.getLockId(uri), transport.transport)
        )
        await lm.unlock(uri)

        // refresh parent node to prevent open editors to lock the object forever
        const parent = hier.find(p => p !== file && isAbapNode(p))
        if (parent && parent.canRefresh()) await this.refresh(parent)
      } catch (e) {
        await lm.unlock(uri)
        throw e
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
    if (dir.canRefresh() && isAbapNode(dir)) {
      await this.refresh(dir)
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
  public async saveFile(
    file: AbapNode,
    content: Uint8Array,
    uri: Uri
  ): Promise<void> {
    if (file.isFolder) throw FileSystemError.FileIsADirectory()
    if (!isAbapNode(file))
      throw FileSystemError.NoPermissions("Can only save source code")

    const obj = file.abapObject
    if (!obj.structure) await file.stat(this.client)
    const lm = LockManager.get()

    // check file is locked. Waits if locking is in progress
    if (!(await lm.getFinalStatus(uri)))
      throw adtException(`Object not locked ${obj.type} ${obj.name}`)

    const transport = await this.selectTransportIfNeeded(
      obj,
      lm.getTransport(uri)
    )

    if (!transport.cancelled) {
      let lockId = lm.getLockId(uri)
      try {
        await this.runInSession(client =>
          obj.setContents(client, content, lockId, transport.transport)
        )
      } catch (e) {
        if (isExpired(e) || e.type === LOCKEXPIRED) {
          if (await reconnectExpired(uri)) {
            lockId = lm.getLockId(uri)
            await this.runInSession(client =>
              obj.setContents(client, content, lockId, transport.transport)
            )
          } else throw e
        } else throw e
      }

      await file.stat(this.client)
      await lm.unlock(uri)
    } else throw adtException("Object can't be saved without a transport")
  }

  /**
   * converts vscode URI to ADT URI
   * @see findNodeHierarchy for more details
   *
   * @param uri vscode URI
   */
  public findNode(uri: Uri): AbapNode {
    if (this.symLinks.isSymlink(uri)) {
      const linked = this.symLinks.getRealNode(uri)
      if (linked) return linked
    }
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

    const retv = parts.reduce(
      (current: AbapNode[], name) => {
        const folder = current[0]
        const child = folder.isFolder && folder.getChild(name)
        if (!child) throw FileSystemError.FileNotFound(uri)

        current.unshift(child)
        return current
      },
      [this.root]
    )
    return retv
  }

  private refresh(node: AbapNode) {
    if (this.lastRefresh && this.lastRefresh.node === node)
      return this.lastRefresh.current
    const current = node.refresh(this.client)
    this.lastRefresh = { node, current }
    setTimeout(() => {
      this.lastRefresh = undefined
    }, 500)
    return current
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
        await this.refresh(refreshable)
        next = node.getChild(part)
        // hack for orphaned local packages
        if (
          !next &&
          part.match(/^\$/) &&
          isAbapNode(node) &&
          node.abapObject.name === TMPPACKAGE
        ) {
          const obj = abapObjectFromNode({
            EXPANDABLE: "X",
            OBJECT_NAME: part,
            OBJECT_TYPE: PACKAGE,
            OBJECT_URI: `/sap/bc/adt/vit/wb/object_type/devck/object_name/${part}`,
            OBJECT_VIT_URI:
              "/sap/bc/adt/vit/wb/object_type/devck/object_name/${part}",
            TECH_NAME: part
          })
          const child = new AbapObjectNode(obj)
          node.setChild(part, child, true)
          await this.refresh(child)
          next = child
        }
      }
      if (next) {
        node = next
        if (node.canRefresh()) refreshable = node
      } else return Promise.reject(FileSystemError.FileNotFound(uri))
    }

    return node
  }
  /**
   * like {@link findNodePromise}, but returns an abap object and raises an exception if the node is not an ABAP object
   *
   * @param uri VSCode URI
   */
  public async findAbapObject(uri: Uri): Promise<AbapObject> {
    const linked = this.symLinks.getRealNode(uri)
    if (linked) return linked.abapObject

    const node = await this.findNodePromise(uri)
    if (isAbapNode(node)) return node.abapObject
    return Promise.reject(new Error("Not an abap object"))
  }

  private isLocked(uri: Uri) {
    return !!LockManager.get().getLockId(uri)
  }

  /**
   * finds the details of a node, and refreshes them from server if needed
   *
   * @param uri VSCode URI
   */
  public async stat(uri: Uri) {
    const linked = await this.statSymlink(uri)
    const getVersion = (nd: AbapNode) => {
      if (!isAbapNode(nd)) return ""
      const str = nd.abapObject.structure
      return str ? str.metaData["adtcore:version"] : ""
    }
    if (linked) return linked
    const node = await this.findNodePromise(uri)
    if (node.canRefresh() && this.isLocked(uri)) {
      if (node.type === FileType.Directory) await this.refresh(node)
      else {
        const oldvers = getVersion(node)
        await node.stat(this.client)
        const version = getVersion(node)
        if (version !== oldvers && isAbapNode(node))
          this.activationStatusEmitter.fire(uri)
      }
    }
    return node
  }

  public async getReentranceTicket() {
    return this.client.reentranceTicket()
  }

  /**
   * Usually symlinks are ADT urls, try to resolve the correct include and stat it
   * then return a symlink to it
   *
   * @param {Uri} uri
   * @returns
   * @memberof AdtServer
   */
  private async statSymlink(uri: Uri) {
    let node
    if (this.symLinks.isSymlink(uri)) {
      const realPath = uri.path.replace(/\.abap/, "")
      const linked = this.symLinks.getRealNode(uri)
      if (linked) await linked.stat(this.client)
      let link = this.symLinks.getNode(uri)
      if (!link) {
        const steps = await this.objectFinder.findObjectPath(realPath)
        const path = await this.objectFinder.locateObject(steps)
        if (path && isAbapNode(path.node)) {
          const obj = path.node.abapObject
          if (obj.path === realPath) node = path.node
          else if (path.node.isFolder) {
            let pnode = findObjectInNodeByPath(path.node, realPath)
            if (!pnode) await this.refresh(path.node)
            pnode = findObjectInNodeByPath(path.node, realPath)
            if (pnode && isAbapNode(pnode.node)) node = pnode.node
          }
        }
        if (node) {
          await node.stat(this.client)
          this.symLinks.updateLink(uri, node)
          link = this.symLinks.getNode(uri)
        }
      }
      if (!link) throw FileSystemError.FileNotFound(uri)
      return link
    }
  }

  private async selectTransportIfNeeded(
    obj: AbapObject,
    transport: string | TransportStatus
  ) {
    // no need for transports for local objects
    if (transport === TransportStatus.LOCAL) return trSel("")
    // I might already have a transport number, but might be stale
    let current: string | TransportStatus = ""
    if (isString(transport)) current = transport
    if (!obj.structure) await obj.loadMetadata(this.client)
    const uri = obj.getContentsUri()
    return selectTransport(uri, "", this.client, false, current)
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
const serverPromises = new Map<string, Promise<AdtServer>>()

export const getServer = (connId: string): AdtServer => {
  const server = servers.get(formatKey(connId))
  if (!server) throw Error(`No ABAP server connection active for ${connId}`)
  return server
}

export const fromUri = (uri: Uri) => {
  if (uri && uri.scheme === ADTSCHEME) return getServer(uri.authority)
  throw Error(`No ABAP server defined for ${uri.toString()}`)
}

async function getOrCreateServerInt(connId: string) {
  let server = servers.get(connId)
  if (!server) {
    const manager = RemoteManager.get()
    const connection = await manager.byIdAsync(connId)
    if (!connection) throw Error(`Connection not found ${connId}`)
    let client
    if (connection.oauth || connection.password) {
      client = createClient(connection)
      await client.login() // raise exception for login issues
    } else {
      connection.password = (await manager.askPassword(connection.name)) || ""
      if (!connection.password) throw Error("Can't connect without a password")
      client = await createClient(connection)
      await client.login() // raise exception for login issues
      const { name, username, password } = connection
      await manager.savePassword(name, username, password)
    }
    server = new AdtServer(connId, client, connection)
    servers.set(connId, server)
  }
  return server
}

export async function getOrCreateServer(connId: string) {
  connId = formatKey(connId)
  let serverPromise = serverPromises.get(connId)
  if (!serverPromise) {
    try {
      serverPromise = getOrCreateServerInt(connId)
      serverPromises.set(connId, serverPromise)
      await serverPromise
    } catch (e) {
      serverPromises.delete(connId)
      throw e
    }
  }
  return serverPromise
}

export async function disconnect() {
  const promises: Promise<any>[] = []
  if (LockManager.get().hasLocks())
    window.showInformationMessage("All locked files will be unlocked")
  for (const server of servers) {
    const promise = server[1].runInSession(async (client: ADTClient) => {
      return client.logout()
    })

    promises.push(promise)
  }
  await Promise.all(promises)
}
