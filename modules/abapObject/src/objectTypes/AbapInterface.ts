import { AbapObject, AbapObjectBase } from "../AbapObject"
import { AbapObjectService } from "../AOService"

const tag = Symbol("AbapInterface")
export class AbapInterface extends AbapObjectBase {
  [tag] = true
  get extension() {
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
