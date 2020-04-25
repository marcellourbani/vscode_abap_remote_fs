import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."

const tag = Symbol("AbapInterface")
@AbapObjectCreator("INTF/OI")
export class AbapInterface extends AbapObjectBase {
  [tag]: boolean
  get extension() {
    return ".intf.abap"
  }
}

export const isAbapInterface = (x: any): x is AbapInterface => !!x?.[tag]
