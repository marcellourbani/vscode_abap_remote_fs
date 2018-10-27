import { AbapObject } from "./AbapObject"

export class AbapSimpleObject extends AbapObject {}
export class AbapSimpleObjectXml extends AbapSimpleObject {
  getExtension() {
    return ".xml"
  }
}
