import { FileStat, FileType, FileSystemError } from "vscode"
import { AbapObject, AbapNodeComponentByCategory } from "../abap/AbapObject"
import { AbapMetaFolder } from "./AbapMetaFolder"
import { AdtConnection } from "../adt/AdtConnection"
import { flatMap, pick } from "../functions"

const getNodeHierarchyByType = (
  components: Array<AbapNodeComponentByCategory>
): AbapMetaFolder => {
  const newNode = new AbapMetaFolder()
  const flatComp = flatMap(components, pick("types"))
  flatComp.forEach(otype => {
    const curNode = otype.name
      ? newNode.setChild(otype.name, new AbapMetaFolder())
      : newNode
    otype.objects.forEach(o =>
      curNode.setChild(o.vsName(), new AbapObjectNode(o))
    )
  })
  return newNode
}

const getNodeHierarchy = (
  components: Array<AbapNodeComponentByCategory>
): AbapMetaFolder => {
  const newNode = new AbapMetaFolder()
  components.forEach(category => {
    let categFolder: AbapMetaFolder
    category.types.forEach(otype => {
      let tpFolder: AbapNode
      if (otype.type.match("DEVC") || otype.type === "") tpFolder = newNode
      else {
        categFolder = categFolder || new AbapMetaFolder()
        tpFolder =
          !otype.name || otype.name === category.name
            ? categFolder
            : categFolder.setChild(otype.name, new AbapMetaFolder())
      }
      otype.objects.forEach(obj =>
        tpFolder.setChild(obj.vsName(), new AbapObjectNode(obj))
      )
      if (categFolder) newNode.setChild(category.name, categFolder)
    })
  })
  return newNode
}
const refreshObjects = (
  node: AbapObjectNode,
  components: Array<AbapNodeComponentByCategory>
): void => {
  //create a new structure, then will match it with the node's
  const newFolder = node.abapObject.type.match(/DEVC/)
    ? getNodeHierarchy(components)
    : getNodeHierarchyByType(components)

  function reconcile(current: AbapNode, newNode: AbapNode) {
    for (const [name, value] of [...newNode]) {
      const oldChild = current.getChild(name)
      if (!oldChild) current.setChild(name, value)
      else if (oldChild.isFolder()) reconcile(oldChild, value)
    }
  }

  reconcile(node, newFolder)
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
  public deleteChild(name: string): void {
    if (!this.children) throw FileSystemError.FileNotFound(name)
    this.children.delete(name)
  }
  public fetchContents(connection: AdtConnection): Promise<Uint8Array> {
    if (this.isFolder()) throw FileSystemError.FileIsADirectory()
    return this.abapObject.getContents(connection).then(response => {
      const buf = Buffer.from(response)
      this.size = buf.length
      return buf
    })
  }
  numChildren(): number {
    return this.children ? this.children.size : 0
  }
  public refresh(connection: AdtConnection): Promise<AbapNode> {
    return this.abapObject.getChildren(connection).then(objects => {
      refreshObjects(this, objects)
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
