import { AbapObjectCreator } from "../creator"
import { AbapObjectBase, AbapObject } from ".."
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
    parent: AbapObject | undefined,
    client: AbapObjectService
  ) {
    path = path
    super(type, name, path, expandable, techName, parent, client)
    this[tag] = true
  }

  [tag]: boolean

  get extension() {
    return ".prog.abap"
  }
}

export const isAbapInclude = (x: any): x is AbapInclude => !!x?.[tag]
