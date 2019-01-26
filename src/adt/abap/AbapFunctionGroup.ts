import { AbapObject } from "./AbapObject"

export class AbapFunctionGroup extends AbapObject {
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    super(type, name, path, expandable, techName)
    this.pExpandable = !!expandable
  }
}
