import { ObjectNode } from "../adt/AdtParser"
import { AbapObject } from "./AbapObject"
import { AbapPackage } from "./AbapPackage"

export function fromObjectNode(node: ObjectNode): AbapObject {
  switch (node.OBJECT_TYPE) {
    case "DEVC/K":
      return new AbapPackage(
        node.OBJECT_TYPE,
        node.OBJECT_NAME,
        node.OBJECT_URI
      )
    default:
      return new AbapObject(node.OBJECT_TYPE, node.OBJECT_NAME, node.OBJECT_URI)
  }
}
