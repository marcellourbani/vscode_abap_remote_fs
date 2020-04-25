import { AbapFsService } from "./AFsService"
import { create, PACKAGE, PACKAGEBASEPATH, TMPPACKAGE } from "../../abapObject"
import { AbapFolder } from "./abapFolder"
import { Folder } from "./folder"

const tag = Symbol("fsRoot")

export const TMPFOLDER = "$TMP"
export const LIBFOLDER = "System Library"
const createPkg = (name: string, service: AbapFsService) =>
  create(PACKAGE, name, PACKAGEBASEPATH, true, "", undefined, service)

export class Root extends Folder {
  [tag] = true
  constructor(readonly connId: string, service: AbapFsService) {
    super()
    const tmp = createPkg(TMPPACKAGE, service)
    this.set(TMPFOLDER, new AbapFolder(tmp, this, service), true)
    const main = createPkg("", service)
    this.set(LIBFOLDER, new AbapFolder(main, this, service), true)
  }
}

export function createRoot(connId: string, service: AbapFsService) {
  return new Root(connId, service)
}

export const isRoot = (x: any): x is Root => !!x?.[tag]
