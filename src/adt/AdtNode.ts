import { FileStat, FileType } from "vscode"
import { AdtFile } from "./AdtFile"
import { ObjectNode } from "./AdtParser"

export type AdtDirItem = AdtFile | AdtNode

export class AdtNode implements FileStat {
  static fromTreeContent(fromTreeContent: ObjectNode[]): AdtNode {
    const node = new AdtNode("")
    return node
  }
  type: FileType = FileType.Directory
  name: string
  ctime: number
  mtime: number
  size: number = 0
  entries: Map<string, AdtDirItem>
  constructor(
    name: string,
    ctime: number = Date.now(),
    mtime: number = Date.now()
  ) {
    this.name = name
    this.ctime = ctime
    this.mtime = mtime
    this.entries = new Map()
  }
  setChildrenFromTreeContent(children: ObjectNode[]): AdtNode {
    this.entries.clear()
    children.forEach(objnode => {
      this.entries.set(
        objnode.OBJECT_NAME,
        objnode.EXPANDABLE
          ? new AdtNode(objnode.OBJECT_NAME)
          : new AdtFile(objnode.OBJECT_NAME)
      )
    })
    return this
  }
}
