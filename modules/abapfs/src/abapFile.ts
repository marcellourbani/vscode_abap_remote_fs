import { FileStat, FileType } from "vscode"
import { AbapObject } from "../../abapObject"
import { AbapFsService } from "."

export class AbapFile implements FileStat {
  type = FileType.File
  constructor(
    readonly object: AbapObject,
    readonly parent: FileStat,
    private service: AbapFsService
  ) {}
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

  size = 0
}
