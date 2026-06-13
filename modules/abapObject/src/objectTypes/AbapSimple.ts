import { AbapObjectBase, AbapObject } from "../AbapObject"
import { AbapObjectService } from "../AOService"
import { getObjectTypeConfig } from "../registry"
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
  get gui_objects(): "yes" | "no" | "better" {
    const config = getObjectTypeConfig(this.type)
    if (config) return config.gui_objects
    return "yes"
  }
}

export const isAbapSimple = (x: any): x is AbapSimple => !!x?.[tag]
