import { AbapObject } from "./AbapObject"

export class AbapInclude extends AbapObject {
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: string
  ) {
    path = path.replace(/\/source\/main.*/, "")
    super(type, name, path, expandable, techName)
  }
}
