import { FileStat, FileType } from "vscode"

export class AdtFile implements FileStat {
  type: FileType = FileType.File
  name: string
  ctime: number
  mtime: number
  size: number = 0
  data: any
  constructor(
    name: string,
    ctime: number = Date.now(),
    mtime: number = Date.now()
  ) {
    this.name = name
    this.ctime = ctime
    this.mtime = mtime
  }
}
