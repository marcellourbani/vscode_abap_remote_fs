import { AdtConnectionManager } from "./AdtConnectionManager"
import { AdtConnection } from "./AdtConnection"
import { AdtNode } from "./AdtNode"
import { Uri, FileSystemError, FileType } from "vscode"
import { AbapObject } from "../abap/AbapObject"
import { ObjectTypeNode, CategoryNode } from "./AdtParser"
// visual studio paths are hierarchic, adt ones aren't
// so we need a way to translate the hierarchic ones to the original ones
// this file is concerned with telling whether a path is a real ADT one or one from vscode
// /sap/bc/adt/repository/nodestructure (with ampty query) is the root of both
// also, several objects have namespaces.
//  Class /foo/bar of package /foo/baz in code will have a path like
//    /sap/bc/adt/repository/nodestructure/foo/baz/foo/bar
//  the actual adt path would be something like:
//    /sap/bc/adt/oo/classes/%2Ffoo%2Fbar
//  so we need to do quite a bit of transcoding
const isValid = (vsUri: Uri): boolean => {
  const matches = vsUri.path.match(
    /^\/sap\/bc\/adt\/repository\/nodestructure\/?(.*)/i
  )
  return !!(matches && !matches[1].match(/^\./))
}
const mappedProp = (
  map: Map<string, any>,
  property: string,
  name: string
): any => {
  const fn = (m: Map<string, any>, index: string) => {
    const record = m.get(index)
    return record && record[property]
  }
  if (name || name === "") return fn(map, name)
  return fn
}
const mapGetOrSet = (map: Map<any, any>, index: any, constr: any): any =>
  // let value: any = map.get(index)
  // if (!value) {
  //   value = new constr()
  //   map.set(index, value)
  // }
  // return value
  map.get(index) ? map.get(index) : map.set(index, new constr()).get(index)

export class AdtServer {
  readonly connectionId: string
  readonly connectionP: Promise<AdtConnection>
  private directories: Map<string, AdtNode> = new Map()
  private objectUris: Map<string, Uri> = new Map()

  actualUri(original: Uri): Uri {
    if (!isValid(original)) throw FileSystemError.FileNotFound(original)
    return this.objectUris.get(original.path) || original
  }

  addChildren(parent: AdtNode, objects: AbapObject[]) {
    objects.forEach(object => {
      const childname = parent.childPath(object.vsName())
      const child = new AdtNode(
        parent.uri.with({ path: childname }),
        !object.isLeaf(),
        false
      )
      parent.entries.set(object.vsName(), child)
      this.objectUris.set(childname, object.getUri(parent.uri))
      if (child.type === FileType.Directory)
        this.directories.set(childname, child)
    })
  }

  addNodes(
    parent: AdtNode,
    objects: AbapObject[],
    objectTypes: Map<string, ObjectTypeNode>,
    categories: Map<string, CategoryNode>
  ) {
    // addNodes(parent: AdtNode, objects: AbapObject[]) {
    this.directories.set(parent.uri.path, parent)
    const objectsByCategory = objects.reduce((objbytype, object) => {
      const typename =
        mappedProp(objectTypes, "OBJECT_TYPE_LABEL", object.type) || object.type
      const ocattag = mappedProp(objectTypes, "CATEGORY_TAG", object.type) || ""
      const ocatName = mappedProp(categories, "CATEGORY_LABEL", ocattag) || ""
      const category = mapGetOrSet(objbytype, ocatName, Map)
      const objtype = mapGetOrSet(category, typename, Map)
      objtype.set(object.name, object)
      return objbytype
    }, new Map<string, Map<string, AbapObject[]>>())
    for (const [category, types] of objectsByCategory) {
      if (category !== "") {
        const catpath = parent.childPath(category)
        const catNode = new AdtNode(
          parent.uri.with({ path: catpath }),
          true,
          true
        )
        for (const [typename, typeObjects] of types) {
          const typepath = catNode.childPath(typename)
          const typeNode = new AdtNode(
            catNode.uri.with({ path: typepath }),
            true,
            true
          )
          this.addChildren(typeNode, typeObjects)
          if (typeNode.entries.size > 0) {
            catNode.entries.set(typename, typeNode)
            this.directories.set(typepath, typeNode)
          }
        }
        if (catNode.entries.size > 0) {
          parent.entries.set(category, catNode)
          this.directories.set(catpath, catNode)
        }
      }
    }
    const nocat = objectsByCategory.get("")
    if (nocat) for (const entry of nocat) this.addChildren(parent, entry[1])
  }

  getDirectory(name: string): AdtNode | undefined {
    return this.directories.get(name)
  }

  constructor(connectionId: string) {
    this.connectionId = connectionId
    this.connectionP = AdtConnectionManager.getManager().findConn(connectionId)
  }
}
const servers = new Map<string, AdtServer>()
export const getServer = (connId: string): AdtServer => {
  let server = servers.get(connId)
  if (!server) {
    server = new AdtServer(connId)
    servers.set(connId, server)
  }
  return server
}
