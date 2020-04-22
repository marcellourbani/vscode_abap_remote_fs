import { FileStat } from "vscode"
import { AbapObject } from "../../abapObject"
import { Folder } from "./folder"

const tag = Symbol("abapFolder")

export class AbapFolder extends Folder {
  [tag] = true
  type = 2 // FileType.Directory
  constructor(readonly object: AbapObject, readonly parent: FileStat) {
    super()
  }
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
}

export const isAbapFolder = (x: any): x is AbapFolder => !!x?.[tag]
