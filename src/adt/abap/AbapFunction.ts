import { AbapObject } from "./AbapObject"
import { SapGuiCommand } from "../sapgui/sapgui"

export function isAbapFunction(o: AbapObject): o is AbapFunction {
  return o.type === "FUGR/F"
}

export class AbapFunction extends AbapObject {
  public getExecutionCommand(): SapGuiCommand {
    return {
      type: "Transaction",
      command: "*SE37",
      parameters: [
        { name: "RS38L-NAME", value: this.name },
        { name: "DYNP_OKCODE", value: "WB_DISPLAY" }
      ]
    }
  }
}
