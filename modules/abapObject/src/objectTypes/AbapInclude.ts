import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { AbapObjectService } from "../AOService"

const tag = Symbol("AbapInclude")
@AbapObjectCreator("PROG/I", "FUGR/I")
export class AbapInclude extends AbapObjectBase {
  constructor(
    type: string,
    name: string,
    path: string,
    expandable: boolean,
    techName: string,
    client: AbapObjectService
  ) {
    path = path.replace(/\/source\/main.*/, "")
    super(type, name, path, expandable, techName, client)
    this[tag] = true
  }
  [tag]: boolean
}

export const isAbapInclude = (x: any): x is AbapInclude => !!x?.[tag]
