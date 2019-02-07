import { AbapObject } from "./AbapObject"
import { SapGuiCommand } from "../sapgui/sapgui"

export function isAbapFunction(o: AbapObject): o is AbapFunction {
  return o.type === "FUGR/F"
}

export class AbapFunction extends AbapObject {
  private parent?: AbapObject
  public getExecutionCommand(): SapGuiCommand {
    return {
      type: "Transaction",
      command: "SE37",
      parameters: [{ name: "RS38L-NAME", value: this.name }]
    }
  }
  public getActivationSubject(): AbapObject {
    return this.parent || this
  }

  public getLockTarget(): AbapObject {
    return this.parent || this
  }
  public setParent(parent: AbapObject) {
    this.parent = parent
  }
}
