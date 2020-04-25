import { AbapObjectBase, AbapObjectConstructor, AbapObject } from "./AbapObject"
import { AbapObjectService } from "./AOService"
import { Node } from "abap-adt-api"
import { AbapObjectError } from "./AOError"
import {} from "./objectTypes"

const constructors = new Map<string, AbapObjectConstructor>()
export const AbapObjectCreator = (...types: string[]) => (
  target: AbapObjectConstructor
) => {
  for (const t of types) constructors.set(t, target)
}

export const create = (
  type: string,
  name: string,
  path: string,
  expandable: boolean,
  techName: string,
  parent: AbapObject | undefined,
  client: AbapObjectService
) => {
  if (!type || !path)
    throw new AbapObjectError(
      "Invalid",
      undefined,
      "Abap Object can't be created without a type and path"
    )
  const cons = constructors.get(type) || AbapObjectBase
  return new cons(type, name, path, expandable, techName, parent, client)
}

export const fromNode = (
  node: Node,
  parent: AbapObject | undefined,
  client: AbapObjectService
) =>
  create(
    node.OBJECT_TYPE,
    node.OBJECT_NAME,
    node.OBJECT_URI,
    !!node.EXPANDABLE,
    node.TECH_NAME,
    parent,
    client
  )
