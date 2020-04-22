import { Folder, AbapFsService, Child } from "./interfaces"
import { FileType, FileStat } from "vscode"
import { create, PACKAGE, PACKAGEBASEPATH, TMPPACKAGE } from "../../abapObject"
import { AbapFolder } from "./abapFolder"

const tag = Symbol("fsRoot")
const refTime = new Date().getMilliseconds()

export const TMPFOLDER = "$TMP"
export const LIBFOLDER = "System Library"

export class Root implements Folder {
  [tag] = true
  get type() {
    return FileType.Directory
  }

  constructor(readonly connId: string, private service: AbapFsService) {
    const tmp = create(PACKAGE, TMPPACKAGE, PACKAGEBASEPATH, true, "", service)
    this.children.set(TMPFOLDER, {
      manual: true,
      file: new AbapFolder(tmp, this)
    })
    const main = create(PACKAGE, "", PACKAGEBASEPATH, true, "", service)
    this.children.set(LIBFOLDER, {
      manual: true,
      file: new AbapFolder(tmp, this)
    })
  }
  get ctime() {
    return refTime
  }
  get mtime() {
    return refTime
  }

  children = new Map<string, Child>()
  get size() {
    return this.children.size
  }
}

export function createRoot(connId: string, service: AbapFsService) {
  return new Root(connId, service)
}

export const isRoot = (x: any): x is Root => !!x?.[tag]
