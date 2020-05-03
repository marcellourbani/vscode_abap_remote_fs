import {
  AbapObjectCreator,
  AbapObjectBase,
  AbapObject,
  AbapObjectService
} from ".."
const tag = Symbol("AbapXml")

@AbapObjectCreator("MSAG/N")
export class AbapXml extends AbapObjectBase {
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
  get extension() {
    return `.${this.type.replace(/\//, "").toLowerCase()}.xml`
  }
  contentsPath() {
    return this.path
  }
}

export const isAbapXml = (x: any): x is AbapXml => !!x?.[tag]
