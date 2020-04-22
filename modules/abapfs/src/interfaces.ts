import { FileStat, FileType } from "vscode"
import { AbapObjectService } from "../../abapObject"

type dir = FileType.Directory

export interface Child {
  file: FileStat
  manual: boolean
}

export interface Folder extends FileStat {
  children: Map<string, Child>
}
// tslint:disable-next-line:no-empty-interface
export interface AbapFsService extends AbapObjectService {}
