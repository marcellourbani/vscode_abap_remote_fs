import { AbapObject, NodeStructureMapped } from "./AbapObject"
import { SapGuiCommand } from "../sapgui/sapgui"

export class AbapProgram extends AbapObject {
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

  protected filterNodeStructure(
    nodest: NodeStructureMapped
  ): NodeStructureMapped {
    const nodes = nodest.nodes.filter(
      x =>
        this.whiteListed(x.OBJECT_TYPE) &&
        (x.OBJECT_TYPE !== "PROG/I" || // keep includes only if they start with the program name
          x.OBJECT_NAME.length === this.name.length + 3) &&
        x.OBJECT_NAME.substr(0, this.name.length) === this.name
    )

    nodes.unshift(this.selfLeafNode())

    return {
      ...nodest,
      nodes
    }
  }
}
