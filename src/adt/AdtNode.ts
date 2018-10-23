import { FileStat, FileType, Uri } from "vscode"
export class AdtNode implements FileStat {
  type: FileType = FileType.Directory
  ctime: number
  mtime: number
  size: number = 0
  entries: Map<string, AdtNode>
  uri: Uri
  needRefresh(): any {
    return this.type === FileType.Directory && this.entries.size === 0
  }
  constructor(path: Uri) {
    this.ctime = Date.now()
    this.mtime = Date.now()
    this.entries = new Map()
    this.uri = path
  }

  childPath(childname: string): string {
    const sep = this.uri.path.match(/\/$/) || childname.match(/^\//) ? "" : "/"
    return this.uri.path + sep + childname
  }
}
