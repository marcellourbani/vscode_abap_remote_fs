import { FileStat, FileType, Uri } from "vscode"
export class AdtNode implements FileStat {
  type: FileType
  ctime: number
  mtime: number
  size: number = 0
  entries: Map<string, AdtNode>
  uri: Uri
  fetched: boolean
  body: Buffer | undefined
  needRefresh(): any {
    return !this.fetched
  }
  constructor(path: Uri, isDirectory: boolean, fetched: boolean) {
    this.ctime = Date.now()
    this.mtime = Date.now()
    this.entries = new Map()
    this.uri = path
    this.type = isDirectory ? FileType.Directory : FileType.File
    this.fetched = fetched
  }

  childPath(childname: string): string {
    const sep = this.uri.path.match(/\/$/) || childname.match(/^\//) ? "" : "/"
    return this.uri.path + sep + childname
  }
  setContents(body: Buffer): void {
    this.body = body
    this.size = body.length
    this.fetched = true
  }
}
