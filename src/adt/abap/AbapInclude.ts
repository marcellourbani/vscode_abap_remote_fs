import { AbapObject } from "./AbapObject"
export function isAbapInclude(o: AbapObject): o is AbapInclude {
  return o.type === "FUGR/I" || o.type === "PROG/I"
}
export class AbapInclude extends AbapObject {
  private parent?: AbapObject
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
  public getActivationSubject(): AbapObject {
    return (this.type === "FUGR/I" && this.parent) || this
  }

  public getLockTarget(): AbapObject {
    return (this.type === "FUGR/I" && this.parent) || this
  }
  public setParent(parent: AbapObject) {
    this.parent = parent
  }
}
