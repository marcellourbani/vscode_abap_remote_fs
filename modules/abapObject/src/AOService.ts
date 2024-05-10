import {
  MainInclude,
  AbapObjectStructure,
  NodeStructure,
  ADTClient,
  NodeParents,
  ObjectVersion
} from "abap-adt-api"

export interface AbapObjectService {
  mainPrograms: (path: string) => Promise<MainInclude[]>
  /** Loads the object metadata
   *    As will be called way too often, we will cache it for a second
   */
  objectStructure: (path: string, refresh?: boolean, version?: ObjectVersion) => Promise<AbapObjectStructure>
  /** invalidate structure cache
   *    to be invoked after changing operations.
   *    will happen automatically on write
   */
  invalidateStructCache: (uri: string) => void
  setObjectSource: (
    contentsPath: string,
    contents: string,
    lockId: string,
    transport: string
  ) => Promise<void>
  delete: (path: string, lockId: string, transport: string) => Promise<void>
  getObjectSource: (path: string, version?: ObjectVersion) => Promise<string>
  nodeContents: (type: NodeParents, name: string, owner?: string) => Promise<NodeStructure>
}

export class AOService implements AbapObjectService {
  constructor(protected client: ADTClient) { }

  private activeStructCache = new Map<string, Promise<AbapObjectStructure>>()

  delete(path: string, lockId: string, transport: string) {
    return this.client.deleteObject(path, lockId, transport)
  }

  invalidateStructCache(uri: string) {
    this.activeStructCache.delete(uri)
  }

  mainPrograms(path: string) {
    return this.client.statelessClone.mainPrograms(path)
  }

  objectStructure(path: string, refresh = false, version?: ObjectVersion) {
    if (refresh) this.activeStructCache.delete(path)
    let structure = this.activeStructCache.get(path)
    if (!structure) {
      structure = this.client.statelessClone.objectStructure(path, version)
      this.activeStructCache.set(path, structure)
      if (!version || version === "active")
        structure.finally(() =>
          setTimeout(() => this.invalidateStructCache(path), 800)
        )
    }
    return structure
  }

  setObjectSource(
    contentsPath: string,
    contents: string,
    lockId: string,
    transport: string
  ) {
    return this.client.setObjectSource(
      contentsPath,
      contents,
      lockId,
      transport
    )
  }

  getObjectSource(path: string, version?: ObjectVersion) {
    return this.client.statelessClone.getObjectSource(path, { version })
  }

  private contentsCache = new Map<string, Promise<NodeStructure>>()
  nodeContents(type: NodeParents, name: string, owner?: string) {
    const key = `${type} ${name}`
    let next = this.contentsCache.get(key)
    if (!next) {
      next = this.client.statelessClone.nodeContents(type, name, owner)
      this.contentsCache.set(key, next)
      next.finally(() => this.contentsCache.delete(key))
    }
    return next
  }
}
