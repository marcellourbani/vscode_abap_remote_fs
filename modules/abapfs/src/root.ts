import { AbapFsService } from "./interfaces"
// import { FileType } from "vscode"
import { create, PACKAGE, PACKAGEBASEPATH, TMPPACKAGE } from "../../abapObject"
import { AbapFolder } from "./abapFolder"
import { Folder } from "./folder"

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
    this.set(LIBFOLDER, new AbapFolder(tmp, this), true)
  }
}

export function createRoot(connId: string, service: AbapFsService) {
  return new Root(connId, service)
}

export const isRoot = (x: any): x is Root => !!x?.[tag]
