import {
  MainInclude,
  AbapObjectStructure,
  NodeStructure,
  ADTClient,
  NodeParents
} from "abap-adt-api"

export interface AbapObjectService {
  mainPrograms: (path: string) => Promise<MainInclude[]>
  /** Loads the object metadata
   *    As will be called way too often, we will cache it for a second
   */
  objectStructure: (path: string) => Promise<AbapObjectStructure>
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
  getObjectSource: (path: string) => Promise<string>
  nodeContents: (type: NodeParents, name: string) => Promise<NodeStructure>
}

export class AOService implements AbapObjectService {
  constructor(protected client: ADTClient) { }

  private structCache = new Map<string, Promise<AbapObjectStructure>>()

  delete(path: string, lockId: string, transport: string) {
    return this.client.deleteObject(path, lockId, transport)
  }

  invalidateStructCache(uri: string) {
    this.structCache.delete(uri)
  }

  mainPrograms(path: string) {
    return this.client.statelessClone.mainPrograms(path)
  }

  objectStructure(path: string) {
    let structure = this.structCache.get(path)
    if (!structure) {
      structure = this.client.statelessClone.objectStructure(path)
      this.structCache.set(path, structure)
      structure.then(() =>
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

  getObjectSource(path: string) {
    return this.client.statelessClone.getObjectSource(path)
  }

  private contentsCache = new Map<string, Promise<NodeStructure>>()
  nodeContents(type: NodeParents, name: string) {
    const key = `${type} ${name}`
    let next = this.contentsCache.get(key)
    if (!next) {
      next = this.client.statelessClone.nodeContents(type, name)
      this.contentsCache.set(key, next)
      next.then(() => this.contentsCache.delete(key))
    }
    return next
  }
}
