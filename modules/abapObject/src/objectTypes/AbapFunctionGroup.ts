import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { NodeStructure } from "abap-adt-api"

const tag = Symbol("AbapFunctionGroup")
@AbapObjectCreator("FUGR/F")
export class AbapFunctionGroup extends AbapObjectBase {
  [tag] = true
  protected filterInvalid(original: NodeStructure): NodeStructure {
    const { nodes, objectTypes } = original
    const prefix = `${this.nameSpace}L${this.baseName}`
    const valid = nodes.filter(
      n =>
        n.OBJECT_NAME &&
        ((n.OBJECT_TYPE === "FUGR/I" && n.OBJECT_NAME.startsWith(prefix)) ||
          n.OBJECT_TYPE === "FUGR/FF")
    )
    return { categories: [], objectTypes, nodes: valid }
  }
}

export const isAbapFunctionGroup = (x: any): x is AbapFunctionGroup =>
  !!x?.[tag]
