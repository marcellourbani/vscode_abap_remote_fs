import { AbapObject } from "./AbapObject"
import { SapGuiCommand } from "../sapgui/sapgui"

export class AbapFunction extends AbapObject {
  getExecutionCommand(): SapGuiCommand {
    return {
      type: "Transaction",
      command: "SE37",
      parameters: [{ name: "RS38L-NAME", value: this.name }]
    }
  }
}
