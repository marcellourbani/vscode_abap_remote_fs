import { AbapObjectCreator } from "../creator"
import { AbapObjectBase, AbapObject, AbapObjectService } from ".."
import { AbapObjectError, ObjectErrors } from "../AOError"
import { isAbapObject } from "../AbapObject"

const tag = Symbol("AbapFunction")
@AbapObjectCreator("FUGR/FF")
export class AbapFunction extends AbapObjectBase {
  [tag]: boolean
  get extension() {
    return ".fugr.abap"
  }
  constructor(
    type: string,
    name: string,
    path: string,
    expandable: boolean,
    techName: string,
    parent: AbapObject | undefined,
    client: AbapObjectService
  ) {
    super(type, name, path, expandable, techName, parent, client)
    if (parent?.type !== "FUGR/F")
      throw ObjectErrors.Invalid(
        this,
        "Parent function group is required for function modules"
      )
    if (!this.path.startsWith(parent.path))
      throw ObjectErrors.Invalid(
        this,
        `Function ${name} doesn't belong to group ${parent.name}`
      )

    this.parent = parent
  }
  readonly parent: AbapObject
}

export const isAbapFunction = (x: any): x is AbapFunction => !!x?.[tag]
