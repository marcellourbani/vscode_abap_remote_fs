import { AbapObject } from "./AbapObject"
import { SapGuiCommand } from "../sapgui/sapgui"

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
  public getExecutionCommand(): SapGuiCommand {
    return {
      type: "Transaction",
      command: "*SE38",
      parameters: [
        { name: "RS38M-PROGRAMM", value: this.name },
        { name: "DYNP_OKCODE", value: "SHOP" }
      ]
    }
  }
}
