import { FileStat, FileType } from "vscode"
import { AbapObject } from "../../abapObject"
import { AbapFsService } from "."
import { AbapFolder, isAbapFolder } from "./abapFolder"
const tag = Symbol("AbapFile")

export class AbapFile implements FileStat {
  [tag] = true
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

export const isAbapFile = (x: any): x is AbapFile => !!x?.[tag]
export type AbapStat = AbapFile | AbapFolder
export const isAbapStat = (x: any): x is AbapStat =>
  isAbapFile(x) || isAbapFolder(x)
