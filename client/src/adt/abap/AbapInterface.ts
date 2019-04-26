import { AbapObject } from "./AbapObject"
import { SapGuiCommand } from "../sapgui/sapgui"

export function isAbapInterface(o: AbapObject): o is AbapInterface {
  return o.type === "CLAS/OI"
}

export class AbapInterface extends AbapObject {
  public getExecutionCommand(): SapGuiCommand {
    return {
      type: "Transaction",
      command: "*SE24",
      parameters: [
        { name: "SEOCLASS-CLSNAME", value: this.name },
        { name: "DYNP_OKCODE", value: "WB_DISPLAY" }
      ]
    }
  }
}
