import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."

const tag = Symbol("AbapFunction")
@AbapObjectCreator("FUGR/FF")
export class AbapFunction extends AbapObjectBase {
  [tag]: boolean
  get extension() {
    return ".fugr.abap"
  }
}

export const isAbapFunction = (x: any): x is AbapFunction => !!x?.[tag]
