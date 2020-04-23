import { AbapFsService } from "./interfaces"
// import { FileType } from "vscode"
import { create, PACKAGE, PACKAGEBASEPATH, TMPPACKAGE } from "../../abapObject"
import { AbapFolder } from "./abapFolder"
import { Folder, isFolder } from "./folder"
import { FileStat } from "vscode"

const tag = Symbol("fsRoot")
const refTime = new Date().getMilliseconds()

export const TMPFOLDER = "$TMP"
export const LIBFOLDER = "System Library"

export class Root extends Folder {
  [tag] = true
  constructor(readonly connId: string, private service: AbapFsService) {
    super()
    const tmp = create(PACKAGE, TMPPACKAGE, PACKAGEBASEPATH, true, "", service)
    this.set(TMPFOLDER, new AbapFolder(tmp, this), true)
    const main = create(PACKAGE, "", PACKAGEBASEPATH, true, "", service)
    this.set(LIBFOLDER, new AbapFolder(main, this), true)
  }

  byPath(path: string) {
    const parts = path.split("/")
    let current: FileStat | undefined = this
    for (const part of parts) {
      if (!part) continue
      if (isFolder(current)) current = current.get(part)
      else current = undefined
      if (!current) break
    }
    return current
  }
}

export function createRoot(connId: string, service: AbapFsService) {
  return new Root(connId, service)
}

export const isRoot = (x: any): x is Root => !!x?.[tag]
