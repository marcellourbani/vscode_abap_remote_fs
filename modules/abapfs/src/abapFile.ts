import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapObject } from "../../abapObject"
import { AbapFsService } from "."
import { AbapFolder, isAbapFolder } from "./abapFolder"
import { isCreatableTypeId } from "abap-adt-api"
const tag = Symbol("AbapFile")

interface FileCache {
  mtime: number
  source: string
}

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

  private cache: FileCache | undefined
  private timer: NodeJS.Timeout | undefined

  async stat() {
    if (this.object.supported) await this.object.loadStructure()
  }

  size = 0
  async read() {
    if (!this.object.structure && this.object.supported)
      await this.object.loadStructure()
    if (this.cache?.mtime === this.mtime) return this.cache.source
    if (this.timer) clearTimeout(this.timer)
    const source = await this.object.read()
    this.cache = { source, mtime: this.mtime }
    this.timer = setTimeout(() => (this.cache = undefined), 3000)
    return source
  }

  write(contents: string, lockId: string, transportId = "") {
    if (!this.object.supported)
      throw new Error(`Object ${this.object.key} can't be written `)
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
