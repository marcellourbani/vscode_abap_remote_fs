import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { NodeStructure } from "abap-adt-api"

const tag = Symbol("AbapFunctionGroup")
@AbapObjectCreator("FUGR/F")
export class AbapFunctionGroup extends AbapObjectBase {
  [tag] = true
  readonly type = "FUGR/F"
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

  async childComponents(includeIncludes?: boolean): Promise<NodeStructure> {
    try {
      const unfiltered = await this.service.nodeContents(this.type, this.name, this.owner)
      return this.filterInvalid(unfiltered)
    } catch (error) {
      // workaround for error expanding function groups in some systems
      // get the root node and the relevant children only
      const root = await this.service.nodeContents(this.type, this.name, this.owner, [0])
      const parents = root.objectTypes.filter(t => t.OBJECT_TYPE === "FUGR/FF" || t.OBJECT_TYPE === "FUGR/I").map(t => Number.parseInt(t.NODE_ID))
      const unfiltered = await this.service.nodeContents(this.type, this.name, this.owner, parents)
      unfiltered.objectTypes = root.objectTypes // for some reason it gets better descriptions like this
      return this.filterInvalid(unfiltered)

    }
  }
}

export const isAbapFunctionGroup = (x: any): x is AbapFunctionGroup =>
  !!x?.[tag]
