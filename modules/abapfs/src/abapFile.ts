import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapObject } from "../../abapObject"
import { AbapFsService } from "."
import { AbapFolder, isAbapFolder } from "./abapFolder"
import { ObjectVersion, isCreatableTypeId } from "abap-adt-api"
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
  ) { }
  get ctime() {
    return this.object.structure?.metaData["adtcore:createdAt"] ?? 0
  }
  get mtime() {
    return this.object.modtime
  }

  get version(): ObjectVersion | undefined {
    return this.object.version
  }

  private cache: FileCache | undefined
  private timer: NodeJS.Timeout | undefined

  async stat() {
    if (this.object.supported) {
      await this.object.loadStructure()
      const inactive = this.object.structure?.links?.find(l => l.rel === "http://www.sap.com/adt/relations/objectstates")
      if (inactive) await this.object.loadStructure(true, "inactive")
    }
  }

  size = 0
  async read() {
    if (!this.object.structure && this.object.supported)
      await this.stat()
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
