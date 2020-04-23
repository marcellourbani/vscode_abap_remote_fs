import { FileStat, FileSystemError } from "vscode"
import { AbapObject, PACKAGE, fromNode } from "../../abapObject"
import { Folder, isFolder } from "./folder"
import { NodeStructure, Node, NodeObjectType, NodeCategory } from "abap-adt-api"
import { AbapFsService } from "./interfaces"
import { AbapFile } from "./abapFile"

const tag = Symbol("abapFolder")

const strucType = (cont: NodeStructure) => (node: Node) =>
  cont.objectTypes.find(t => t.OBJECT_TYPE === node.OBJECT_TYPE)

const strucCategory = (cont: NodeStructure) => (type?: NodeObjectType) =>
  type && cont.categories.find(c => c.CATEGORY === type.CATEGORY_TAG)

const subFolder = (parent: Folder, label?: string): Folder => {
  if (!label) return parent
  const child = parent.get(label)
  if (isFolder(child)) return child
  if (child)
    throw FileSystemError.FileNotADirectory("Name clash between abap objects")
  const newChild = new Folder()
  parent.set(label, newChild, false)
  return newChild
}

export class AbapFolder extends Folder {
  [tag] = true
  type = 2 // FileType.Directory
  constructor(
    readonly object: AbapObject,
    readonly parent: FileStat,
    private service: AbapFsService
  ) {
    super()
  }
  get ctime() {
    if (this.object.structure)
      return this.object.structure.metaData["adtcore:createdAt"]
    return 0
  }
  get mtime() {
    if (this.object.structure)
      return this.object.structure.metaData["adtcore:changedAt"]
    return 0
  }
  /** loads the children */
  async refresh() {
    const cont = await this.object.childComponents()
    const root = new Folder()
    const getType = strucType(cont)
    const getCat = strucCategory(cont)
    const nodeIsValid = (n: Node) =>
      n.OBJECT_TYPE === PACKAGE || !n.OBJECT_TYPE.match(/DEVC\//)
    const validNodes = cont.nodes.filter(nodeIsValid)
    for (const node of cont.nodes) {
      const type = getType(node)
      const category = getCat(type)
      let folder = subFolder(root, category?.CATEGORY_LABEL)
      folder = subFolder(folder, type?.OBJECT_TYPE_LABEL)
      const object = fromNode(node, this.service)
      const child = object.expandable
        ? new AbapFolder(object, folder, this.service)
        : new AbapFile(object, folder, this.service)

      folder.set(object.fsName, child)
    }
  }
}

export const isAbapFolder = (x: any): x is AbapFolder => !!x?.[tag]
