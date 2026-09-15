import { type AbapObject, AbapObjectBase } from "../AbapObject.js"
import { type AbapObjectService } from "../AOService.js"

const tag = Symbol("AbapInterface")
export class AbapInterface extends AbapObjectBase {
  [tag] = true
  override get extension() {
    return ".intf.abap"
  }
  constructor(
    type: string,
    name: string,
    path: string,
    _expandable: boolean,
    techName: string,
    parent: AbapObject | undefined,
    sapGuiUri: string,
    service: AbapObjectService,
    owner?: string
  ) {
    super(type, name, path, false, techName, parent, sapGuiUri, service, owner)
  }
}

export const isAbapInterface = (x: any): x is AbapInterface => !!x?.[tag]
