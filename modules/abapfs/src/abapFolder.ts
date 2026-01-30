import { FileStat, FileSystemError } from "vscode"
import { AbapObject, PACKAGE, fromNode, convertSlash } from "../../abapObject"
import { Folder, isFolder } from "./folder"
import {
  NodeStructure,
  Node,
  NodeObjectType,
  isCreatableTypeId
} from "abap-adt-api"
import { AbapFile, isAbapFile } from "./abapFile"
import { AbapFsService, isAbapStat } from "."

const tag = Symbol("abapFolder")

const strucType = (cont: NodeStructure, obj: AbapObject) => (node: Node) => {
  if (node.OBJECT_TYPE === PACKAGE || obj.type === "PROG/P") return
  return cont.objectTypes.find(t => t.OBJECT_TYPE === node.OBJECT_TYPE)
}

const strucCategory = (cont: NodeStructure) => (type?: NodeObjectType) =>
  type && cont.categories.find(c => c.CATEGORY === type.CATEGORY_TAG)

const subFolder = (parent: Folder, label?: string): Folder => {
  if (!label) return parent
  label = convertSlash(label)
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

  delete(lockId: string, transport: string) {
    if (!isCreatableTypeId(this.object.type))
      throw FileSystemError.NoPermissions(
        "Only allowed to delete abap objects can be created"
      )
    return this.object.delete(lockId, transport)
  }

  /** loads the children */
  async refresh() {
    const cont = await this.object.childComponents()
    const root = new Folder()
    const getType = strucType(cont, this.object)
    const getCat = strucCategory(cont)
    for (const node of cont.nodes) {
      const type = getType(node)
      const category = getCat(type)
      let folder = root
      if (category?.CATEGORY_LABEL !== type?.OBJECT_TYPE_LABEL)
        folder = subFolder(root, category?.CATEGORY_LABEL)
      folder = subFolder(folder, type?.OBJECT_TYPE_LABEL)
      const object = fromNode(node, this.object, this.service)
      const child = object.expandable
        ? new AbapFolder(object, folder, this.service)
        : new AbapFile(object, folder, this.service)

      folder.set(object.fsName, child, false)
    }
    this.merge([...root])
  }

  mainInclude(myPath: string) {
    if (this.object.type === PACKAGE) return
    let first
    for (const candidate of this.expandPath(myPath)) {
      const { file } = candidate
      if (!isAbapFile(file)) continue
      if (file.object.path.match("/source/main")) return candidate
      if (!first) first = candidate
    }
    return first
  }

  findAbapObject(type: string, name: string, url: string, pathPrefix: string) {
    for (const child of this.expandPath(pathPrefix))
      if (isAbapStat(child.file)) {
        const obj = child.file.object
        if (obj.path === url || (obj.type === type && obj.name === name))
          return child
      }
  }
}

export const isAbapFolder = (x: any): x is AbapFolder => !!x?.[tag]
