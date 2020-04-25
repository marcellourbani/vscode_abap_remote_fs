import {
  MainInclude,
  AbapObjectStructure,
  NodeStructure,
  ADTClient,
  NodeParents
} from "abap-adt-api"

export interface AbapObjectService {
  mainPrograms: (path: string) => Promise<MainInclude[]>
  objectStructure: (path: string) => Promise<AbapObjectStructure>
  setObjectSource: (
    contentsPath: string,
    contents: string,
    lockId: string,
    transport: string
  ) => Promise<void>
  getObjectSource: (path: string) => Promise<string>
  nodeContents: (type: NodeParents, name: string) => Promise<NodeStructure>
}

export class AOService implements AbapObjectService {
  constructor(protected client: ADTClient) {}
  mainPrograms(path: string) {
    return this.client.statelessClone.mainPrograms(path)
  }
  objectStructure(path: string) {
    return this.client.statelessClone.objectStructure(path)
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
  nodeContents(type: NodeParents, name: string) {
    return this.client.statelessClone.nodeContents(type, name)
  }
}
