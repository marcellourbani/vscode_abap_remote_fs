import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapObject } from "../abap/AbapObject"
import { AbapMetaFolder } from "./AbapMetaFolder"
import { AdtConnection } from "../adt/AdtConnection"

//folders are only used to store other nodes
export class AbapObjectNode implements FileStat {
  abapObject: AbapObject
  type: FileType
  ctime: number = Date.now()
  mtime: number = Date.now()
  size: number = 0
  private children?: Map<string, AbapNode>

  constructor(abapObject: AbapObject) {
    if (abapObject.isLeaf()) this.type = FileType.File
    else {
      this.type = FileType.Directory
      this.children = new Map()
    }
    this.abapObject = abapObject
  }

  public isFolder() {
    return !!this.children
  }
  public getChild(name: string): AbapNode | undefined {
    if (!this.children) throw FileSystemError.FileNotADirectory(name)
    return this.children.get(name)
  }
  public setChild(name: string, child: AbapNode): void {
    if (!this.children) throw FileSystemError.FileNotFound(name)
    this.children.set(name, child)
  }
  public keys() {
    if (!this.children) throw FileSystemError.FileNotADirectory()
    return this.children.keys()
  }
  public fetchContents(): Promise<Uint8Array> {
    throw new Error("not yet implemented")
  }
  public refresh(connection: AdtConnection): Promise<AbapNode> {
    return Promise.resolve(this)
  }
}

export type AbapNode = AbapObjectNode | AbapMetaFolder
