import { AbapObject, XML_EXTENSION } from "./AbapObject"

export class AbapSimpleObject extends AbapObject {}
export class AbapSimpleObjectXml extends AbapSimpleObject {
  getExtension() {
    return XML_EXTENSION
  }
}
