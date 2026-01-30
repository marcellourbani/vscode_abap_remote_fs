import { AbapObjectCreator } from "../creator"
import { AbapObjectBase, AbapObject, AbapObjectService } from ".."
import { ObjectErrors } from "../AOError"

const tag = Symbol("AbapFunction")
@AbapObjectCreator("FUGR/FF")
export class AbapFunction extends AbapObjectBase {
  [tag] = true
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
    sapGuiUri: string,
    client: AbapObjectService
  ) {
    super(type, name, path, expandable, techName, parent, sapGuiUri, client)
    if (parent?.type !== "FUGR/F")
      throw ObjectErrors.Invalid(
        this,
        "Parent function group is required for function modules"
      )
    if (!this.path.toLowerCase().startsWith(parent.path.toLowerCase()))
      throw ObjectErrors.Invalid(
        this,
        `Function ${name} doesn't belong to group ${parent.name}`
      )

    this.parent = parent
  }
  readonly parent: AbapObject
}

export const isAbapFunction = (x: any): x is AbapFunction => !!x?.[tag]
