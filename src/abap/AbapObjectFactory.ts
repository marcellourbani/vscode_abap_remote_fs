import { AbapObject } from "./AbapObject"
import { AbapPackage } from "./AbapPackage"
import { AbapSimpleObjectXml, AbapGenericObject } from "./AbapSimpleObject"
import { ObjectNode } from "../adt/AdtNodeStructParser"
import { AbapFunctionGroup } from "./AbapFunctionGroup"

export function fromObjectNode(node: ObjectNode): AbapObject {
  let objtype = AbapObject
  switch (node.OBJECT_TYPE) {
    case "DEVC/K":
      objtype = AbapPackage
      break
    case "FUGR/F":
      objtype = AbapFunctionGroup
      break
    case "TABL/DT":
    case "DOMA/DD":
    case "DTEL/DE":
    case "TTYP/DA":
      objtype = AbapSimpleObjectXml
      break
    default:
      return new AbapGenericObject(
        node.OBJECT_TYPE,
        node.OBJECT_NAME,
        node.OBJECT_URI,
        node.EXPANDABLE
      )
  }
  return new objtype(node.OBJECT_TYPE, node.OBJECT_NAME, node.OBJECT_URI)
}
