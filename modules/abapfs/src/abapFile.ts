import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapObject } from "../../abapObject"
import { AbapFsService } from "."
import { AbapFolder, isAbapFolder } from "./abapFolder"
import { isCreatableTypeId } from "abap-adt-api"
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

  get version() {
    return this.object.structure?.metaData["adtcore:version"]
  }

  async stat() {
    await this.object.loadStructure()
  }

  size = 0
  async read() {
    if (!this.object.structure) await this.object.loadStructure()
    return this.object.read()
  }
  write(contents: string, lockId: string, transportId = "") {
    return this.object.write(contents, lockId, transportId)
  }

  delete(lockId: string, transport: string) {
    if (!isCreatableTypeId(this.object.type))
      throw FileSystemError.NoPermissions(
        "Only allowed to delete abap objects can be created"
      )
    return this.object.delete(lockId, transport)
  }
}

export const isAbapFile = (x: any): x is AbapFile => !!x?.[tag]
export type AbapStat = AbapFile | AbapFolder
export const isAbapStat = (x: any): x is AbapStat =>
  isAbapFile(x) || isAbapFolder(x)
