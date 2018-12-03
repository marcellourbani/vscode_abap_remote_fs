import { AbapObject, AbapMetaData } from "./AbapObject"
import { AdtConnection } from "../adt/AdtConnection"
import { AbapClass } from "./AbapClass"
import { Uri, FileSystemError } from "vscode"
export interface ClassIncludeMeta extends AbapMetaData {
  includeType: string
  type: string
}
export class AbapClassInclude extends AbapObject {
  metaData?: ClassIncludeMeta
  parent?: AbapClass
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    super(type, name, path, expandable, techName)
  }
  setParent(parent: AbapClass) {
    this.parent = parent
  }
  getContentsUri(connection: AdtConnection): Uri {
    if (!this.metaData) throw FileSystemError.FileNotFound(this.path)
    return this.getUri(connection).with({
      query: `version=${this.metaData.version}`
    })
  }

  getActivationSubject(): AbapObject {
    return this.parent || this
  }

  async loadMetadata(connection: AdtConnection): Promise<AbapObject> {
    if (this.parent) {
      await this.parent.loadMetadata(connection)
      if (this.parent.metaData)
        for (const incmeta of this.parent.metaData.includes)
          if (incmeta.includeType === this.techName) {
            this.metaData = incmeta
            break
          }
    }
    return this
  }
}
export function isClassInclude(obj: AbapObject): obj is AbapClassInclude {
  return obj.type === "CLAS/I"
}
