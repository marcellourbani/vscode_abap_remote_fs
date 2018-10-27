import { FileStat, FileType, FileSystemError } from "vscode"
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

  public setChild(name: string, child: AbapNode): AbapNode {
    this.children.set(name, child)
    return child
  }
  public deleteChild(name: string): void {
    this.children.delete(name)
  }
  public numChildren(): number {
    return this.children.size
  }

  public refresh(connection: AdtConnection): Promise<AbapNode> {
    return Promise.resolve(this)
  }
  public canRefresh() {
    return false
  }
  public fetchContents(connection: AdtConnection): Promise<Uint8Array> {
    throw FileSystemError.FileIsADirectory()
  }

  [Symbol.iterator]() {
    return this.children[Symbol.iterator]()
  }
}
