import { AbapObjectBase, AbapObjectConstructor } from "./AbapObject"
import { AbapObjectService } from "./AOService"

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
