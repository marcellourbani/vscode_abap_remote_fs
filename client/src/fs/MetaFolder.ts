import { ADTClient } from "abap-adt-api"
import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapNode } from "./AbapNode"

// folders are only used to store other nodes
export class MetaFolder implements FileStat, Iterable<[string, AbapNode]> {
  public type: FileType = FileType.Directory
  public ctime: number = Date.now()
  public mtime: number = Date.now()
  public size: number = 0

  private children: Map<string, AbapNode> = new Map()
  public manualChildren?: Map<string, AbapNode>

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
  public setChild(name: string, child: AbapNode, manual = false): AbapNode {
    this.children.set(name, child)
    if (manual) {
      if (!this.manualChildren) this.manualChildren = new Map()
      this.manualChildren.set(name, child)
    }
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

  public [Symbol.iterator]() {
    return this.children[Symbol.iterator]()
  }
}
