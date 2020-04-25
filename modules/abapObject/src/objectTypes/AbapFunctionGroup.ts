import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { NodeStructure } from "abap-adt-api"

const tag = Symbol("AbapFunctionGroup")
@AbapObjectCreator("FUGR/F")
export class AbapFunctionGroup extends AbapObjectBase {
  [tag]: boolean
  protected filterInvalid(original: NodeStructure): NodeStructure {
    const { nodes, objectTypes } = original
    const matchName = (n: string) =>
      n === this.name ||
      (n.startsWith(this.name) &&
        n.length === this.name.length + 3 &&
        n.match(/[A-Z][0-9][0-9]$/))
    const valid = nodes.filter(
      n =>
        n.OBJECT_NAME &&
        (n.OBJECT_TYPE === "FUGR/I" || n.OBJECT_TYPE === "FUGR/FF")
    )
    return { categories: [], objectTypes, nodes: valid }
  }
}

export const isAbapFunctionGroup = (x: any): x is AbapFunctionGroup =>
  !!x?.[tag]
