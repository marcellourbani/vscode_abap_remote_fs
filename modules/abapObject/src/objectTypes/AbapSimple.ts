import { AbapObjectBase, type AbapObject } from "../AbapObject.js"
import { type AbapObjectService } from "../AOService.js"
import { getObjectTypeConfig } from "../registry.js"
const tag = Symbol("AbapSimple")

export class AbapSimple extends AbapObjectBase {
  [tag] = true
  constructor(
    type: string,
    name: string,
    path: string,
    expandable: boolean,
    techName: string,
    parent: AbapObject | undefined,
    sapGuiUri: string,
    client: AbapObjectService
  ) {
    super(type, name, path, false, techName, parent, sapGuiUri, client)
  }
  override get gui_objects(): "yes" | "no" | "better" {
    const config = getObjectTypeConfig(this.type)
    if (config) return config.gui_objects
    return "yes"
  }
}

export const isAbapSimple = (x: any): x is AbapSimple => !!x?.[tag]
