import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { NodeStructure } from "abap-adt-api"

const tag = Symbol("AbapProgram")
@AbapObjectCreator("PROG/P")
export class AbapProgram extends AbapObjectBase {
  [tag]: boolean
  protected filterInvalid(original: NodeStructure): NodeStructure {
    const { nodes } = original
    const matchName = (n: string) =>
      n === this.name ||
      (n.startsWith(this.name) &&
        n.length === this.name.length + 3 &&
        n.match(/[A-Z][0-9][0-9]$/))
    const valid = nodes.filter(
      n => n.OBJECT_TYPE === "PROG/I" && matchName(n.OBJECT_NAME)
    )
    valid.unshift({
      OBJECT_TYPE: "PROG/I",
      OBJECT_NAME: `${this.name}`,
      TECH_NAME: "",
      OBJECT_URI: `${this.path}/main`,
      EXPANDABLE: "",
      OBJECT_VIT_URI: ""
    })
    return { categories: [], objectTypes: [], nodes: valid }
  }
}

export const isAbapProgram = (x: any): x is AbapProgram => !!x?.[tag]
