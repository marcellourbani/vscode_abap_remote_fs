import { ADTClient } from "abap-adt-api"
import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapNode } from "./AbapNode"

//folders are only used to store other nodes
export class MetaFolder implements FileStat, Iterable<[string, AbapNode]> {
  type: FileType = FileType.Directory
  ctime: number = Date.now()
  mtime: number = Date.now()
  size: number = 0

  private children: Map<string, AbapNode> = new Map()

  public async stat(client: ADTClient): Promise<AbapNode> {
    return this
  }

  public get isFolder() {
    return true
  }

  public getChild(name: string): AbapNode | undefined {
    return this.children.get(name)
  }
  public save(client: ADTClient, contents: Uint8Array) {
    if (this.isFolder) throw FileSystemError.FileIsADirectory()
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

  public refresh(client: ADTClient): Promise<AbapNode> {
    return Promise.resolve(this)
  }
  public canRefresh() {
    return false
  }
  public fetchContents(client: ADTClient): Promise<Uint8Array> {
    throw FileSystemError.FileIsADirectory()
  }

  [Symbol.iterator]() {
    return this.children[Symbol.iterator]()
  }
}
