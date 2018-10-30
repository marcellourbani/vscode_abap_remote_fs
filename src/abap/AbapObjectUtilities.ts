import { AbapObject, AbapNodeComponentByCategory } from "./AbapObject"
import { NodeStructure, ObjectNode } from "../adt/AdtNodeStructParser"
// import { selectMap, GroupArray } from "../functions"
import { AbapProgram } from "./AbapProgram"
import { AbapClass } from "./AbapClass"

export function aggregateNodes(
  cont: NodeStructure
): Array<AbapNodeComponentByCategory> {
  // const catLabel = selectMap(cont.categories, "CATEGORY_LABEL", "")
  // const typeLabel = selectMap(cont.objectTypes, "OBJECT_TYPE_LABEL", "")

  // const types = GroupArray("OBJECT_TYPE")(cont.nodes)
  // const catTypes = GroupArray("CATEGORY_TAG")([...cont.objectTypes.values()])

  const components: Array<AbapNodeComponentByCategory> = []
  const nullcat = {
    CATEGORY: "",
    CATEGORY_LABEL: ""
  }
  const findById = <T>(
    arr: Array<T>,
    prop: string,
    value: string
  ): T | undefined => {
    return arr.find((x: any) => x[prop] === value)
  }

  cont.nodes.forEach(node => {
    let typerec = cont.objectTypes.get(node.OBJECT_TYPE)
    let catrec
    if (typerec) {
      catrec = cont.categories.get(typerec.CATEGORY_TAG)! || nullcat
    } else {
      catrec = nullcat
      typerec = {
        OBJECT_TYPE: "",
        CATEGORY_TAG: "",
        OBJECT_TYPE_LABEL: "",
        NODE_ID: ""
      }
    }

    let catNode = findById(components, "category", catrec.CATEGORY)
    if (!catNode) {
      catNode = {
        category: catrec.CATEGORY,
        name: catrec.CATEGORY_LABEL,
        types: []
      }
      components.push(catNode)
    }
    let typeNode = findById(catNode.types, "type", typerec.OBJECT_TYPE)
    if (!typeNode) {
      typeNode = {
        name: typerec.OBJECT_TYPE_LABEL,
        type: typerec.OBJECT_TYPE,
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
  }
  return new objtype(
    node.OBJECT_TYPE,
    node.OBJECT_NAME,
    node.OBJECT_URI,
    node.EXPANDABLE,
    node.TECH_NAME
  )
}
