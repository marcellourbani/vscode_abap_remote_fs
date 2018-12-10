import {
  AbapObject,
  AbapNodeComponentByCategory,
  AbapSimpleObject,
  AbapXmlObject
} from "./AbapObject"
import { NodeStructure, ObjectNode } from "../parsers/AdtNodeStructParser"
import { selectMap } from "../../functions"
import { AbapProgram } from "./AbapProgram"
import { AbapClass } from "./AbapClass"
import { AbapInclude } from "./AbapInclude"
import { AbapClassInclude } from "./AbapClassInclude"
import { AbapNode, isAbapNode } from "../../fs/AbapNode"

export interface NodePath {
  path: string
  node: AbapNode
}

export function aggregateNodes(
  cont: NodeStructure
): Array<AbapNodeComponentByCategory> {
  const catLabel = selectMap(cont.categories, "CATEGORY_LABEL", "")
  const typeCat = selectMap(cont.objectTypes, "CATEGORY_TAG", "")
  const typeLabel = selectMap(cont.objectTypes, "OBJECT_TYPE_LABEL", "")

  const components: Array<AbapNodeComponentByCategory> = []
  const findById = <T>(
    arr: Array<T>,
    prop: string,
    value: string
  ): T | undefined => {
    return arr.find((x: any) => x[prop] === value)
  }

  cont.nodes.forEach(node => {
    const categoryTag = typeCat(node.OBJECT_TYPE)
    const categoryLabel = catLabel(categoryTag)
    let catNode = findById(components, "category", categoryTag)
    if (!catNode) {
      catNode = {
        category: categoryTag,
        name: categoryLabel,
        types: []
      }
      components.push(catNode)
    }
    let typeNode = findById(catNode.types, "type", node.OBJECT_TYPE)
    if (!typeNode) {
      typeNode = {
        name: typeLabel(node.OBJECT_TYPE),
        type: node.OBJECT_TYPE,
        objects: []
      }
      catNode.types.push(typeNode)
    }
    typeNode.objects.push(abapObjectFromNode(node))
  })

  return components
}

export function abapObjectFromNode(node: ObjectNode): AbapObject {
  let objtype = AbapObject
  switch (node.OBJECT_TYPE) {
    case "PROG/P":
      objtype = AbapProgram
      break
    case "CLAS/OC":
      objtype = AbapClass
      break
    case "CLAS/I":
      objtype = AbapClassInclude
      break
    case "XSLT/VT":
      objtype = AbapXmlObject
      break
    case "INTF/OI":
      objtype = AbapSimpleObject
      break
    case "PROG/I":
    case "FUGR/I":
      objtype = AbapInclude
      break
  }
  return new objtype(
    node.OBJECT_TYPE,
    node.OBJECT_NAME,
    node.OBJECT_URI,
    node.EXPANDABLE,
    node.TECH_NAME
  )
}
export function findObjectInNode(
  folder: AbapNode,
  type: string,
  name: string
): NodePath | undefined {
  const children = [...folder]
  for (const [path, node] of children) {
    if (isAbapNode(node)) {
      const o = node.abapObject
      if (o.type === type && o.name === name)
        return { path: o.vsName || path, node }
    } else {
      const part = findObjectInNode(node, type, name)
      if (part) return { ...part, path: `${path}/${part.path}` }
    }
  }
}

export function allChildren(o: NodePath): NodePath[] {
  if (o.node.numChildren === 0) return []
  const children: NodePath[] = [...o.node].map(x => {
    return { path: o.path + "/" + x[0], node: x[1] }
  })

  let all = children
  for (const child of children) {
    all = [...all, ...allChildren(child)]
  }
  return all
}

export function findMainInclude(o: NodePath) {
  const candidates = allChildren(o).filter(
    x => isAbapNode(x.node) && !x.node.isFolder
  )
  const main = candidates.find(
    x => isAbapNode(x.node) && !!x.node.abapObject.path.match("/source/main")
  )
  return main || candidates[0]
}
