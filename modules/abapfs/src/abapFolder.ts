import { FileStat } from "vscode"
import { AbapObject } from "../../abapObject"
import { Child } from "."

const tag = Symbol("abapFolder")

export class AbapFolder implements FileStat {
  [tag] = true
  type = 2 // FileType.Directory
  constructor(readonly object: AbapObject, readonly parent: FileStat) {}
  get ctime() {
    if (this.object.structure)
      return this.object.structure.metaData["adtcore:createdAt"]
    return 0
  }
  get mtime() {
    if (this.object.structure)
      return this.object.structure.metaData["adtcore:changedAt"]
    return 0
  }
  children = new Map<string, Child>()
  get size() {
    return this.children.size
  }
}

export const isAbapFolder = (x: any): x is AbapFolder => !!x?.[tag]
