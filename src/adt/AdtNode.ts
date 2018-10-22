import { FileStat, FileType, Uri } from "vscode"
import { ObjectNode } from "./AdtParser"
const lastPathEntry = (uri: Uri) =>
  uri.path.replace(/\/$/, "").replace(/.*\//, "")
export class AdtNode implements FileStat {
  type: FileType = FileType.Directory
  name: string
  ctime: number
  mtime: number
  size: number = 0
  entries: Map<string, AdtNode>
  path: Uri

  constructor(path: Uri, name?: string) {
    this.name = name ? name : lastPathEntry(path)
    this.ctime = Date.now()
    this.mtime = Date.now()
    this.entries = new Map()
    this.path = path
  }
  setChildrenFromTreeContent(children: ObjectNode[]): AdtNode {
    this.entries.clear()
    children.forEach(objnode => {
      this.entries.set(
        objnode.OBJECT_NAME,
        new AdtNode(
          this.path.with({ path: objnode.OBJECT_URI }),
          objnode.OBJECT_NAME
        )
      )
    })
    return this
  }
  escapeName = (n: string) => n.replace(/\//g, "_")

  childPath(childname: string): string {
    const sep = this.path.path.match(/\/$/) ? "" : "/"
    return this.path.path + sep + this.escapeName(childname)
  }
}
