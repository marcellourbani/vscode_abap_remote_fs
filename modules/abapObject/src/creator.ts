import { AbapObjectBase, AbapObjectConstructor } from "./AbapObject"
import { AbapObjectService } from "./AOService"
import { Node } from "abap-adt-api"

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
  client: AbapObjectService
) => {
  const cons = constructors.get(type) || AbapObjectBase
  return new cons(type, name, path, expandable, techName, client)
}

export const fromNode = (node: Node, client: AbapObjectService) =>
  create(
    node.OBJECT_TYPE,
    node.OBJECT_NAME,
    node.OBJECT_URI,
    !!node.EXPANDABLE,
    node.TECH_NAME,
    client
  )
