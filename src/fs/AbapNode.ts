import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapObject, AbapComponents } from "../abap/AbapObject"
import { AbapMetaFolder } from "./AbapMetaFolder"
import { AdtConnection } from "../adt/AdtConnection"

const addObjects = (node: AbapObjectNode, components: AbapComponents): void => {
  components.forEach(category => {
    const catFolder = !category.name
      ? node
      : node.getChild(category.name) ||
        node.setChild(category.name, new AbapMetaFolder())
    category.types.forEach(otype => {
      const typeFolder = !otype.name
        ? catFolder
        : catFolder.getChild(otype.name) ||
          catFolder.setChild(otype.name, new AbapMetaFolder())

      otype.objects.forEach(obj =>
        typeFolder.setChild(obj.vsName(), new AbapObjectNode(obj))
      )
    })
  })
}

//folders are only used to store other nodes
export class AbapObjectNode implements FileStat, Iterable<[string, AbapNode]> {
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
  public setChild(name: string, child: AbapNode): AbapNode {
    if (!this.children) throw FileSystemError.FileNotFound(name)
    this.children.set(name, child)
    return child
  }
  public fetchContents(): Promise<Uint8Array> {
    throw new Error("not yet implemented")
  }
  public refresh(connection: AdtConnection): Promise<AbapNode> {
    return this.abapObject.getChildren(connection).then(objects => {
      addObjects(this, objects)
      return this
    })
  }
  public canRefresh() {
    return true
  }
  [Symbol.iterator]() {
    if (!this.children) throw FileSystemError.FileNotADirectory()
    return this.children[Symbol.iterator]()
  }
}

export type AbapNode = AbapObjectNode | AbapMetaFolder
