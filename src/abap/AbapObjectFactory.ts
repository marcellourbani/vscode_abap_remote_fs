import { ObjectNode } from "../adt/AdtParser"
import { AbapObject } from "./AbapObject"
import { AbapPackage } from "./AbapPackage"
import { AbapFunctionGroup } from "./AbapFunctionGroup"
import { AbapSimpleObjectXml } from "./AbapSimpleObject"

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
    case "DOMA/DT":
    case "DTEL/DE":
      objtype = AbapSimpleObjectXml
      break
  }
  return new objtype(node.OBJECT_TYPE, node.OBJECT_NAME, node.OBJECT_URI)
}
