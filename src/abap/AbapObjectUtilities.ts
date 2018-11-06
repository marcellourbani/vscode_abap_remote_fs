import { AbapObject, AbapNodeComponentByCategory } from "./AbapObject"
import { NodeStructure, ObjectNode } from "../adt/AdtNodeStructParser"
import { selectMap } from "../functions"
import { AbapProgram } from "./AbapProgram"
import { AbapClass } from "./AbapClass"
import { AbapInclude } from "./AbapInclude"
import { AbapClassInclude } from "./AbapClassInclude"

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
