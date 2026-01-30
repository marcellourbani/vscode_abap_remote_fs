import {
  AbapObjectCreator,
  AbapObjectBase,
  AbapObject,
  AbapObjectService
} from ".."
const tag = Symbol("AbapSimple")

@AbapObjectCreator("TABL/DT", "TABL/DS", "SRFC", "TRAN/T", "PARA/R")
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
}

export const isAbapSimple = (x: any): x is AbapSimple => !!x?.[tag]
