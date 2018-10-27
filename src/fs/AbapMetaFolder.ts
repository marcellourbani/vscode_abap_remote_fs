import { FileStat, FileType } from "vscode"
import { AbapNode } from "./AbapNode"
import { AdtConnection } from "../adt/AdtConnection"

//folders are only used to store other nodes
export class AbapMetaFolder implements FileStat, Iterable<[string, AbapNode]> {
  type: FileType = FileType.Directory
  ctime: number = Date.now()
  mtime: number = Date.now()
  size: number = 0

  private children: Map<string, AbapNode> = new Map()

  public isFolder() {
    return true
  }

  public getChild(name: string): AbapNode | undefined {
    return this.children.get(name)
  }

  public setChild(name: string, child: AbapNode) {
    this.children.set(name, child)
  }

  public refresh(connection: AdtConnection): Promise<AbapNode> {
    return Promise.resolve(this)
  }

  public keys() {
    return this.children.keys()
  }
  [Symbol.iterator]() {
    return this.children[Symbol.iterator]()
  }
}
