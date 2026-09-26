import { AbapObjectBase, type AbapObject } from "../AbapObject.js"
import { type AbapObjectService } from "../AOService.js"
import { getObjectTypeConfig } from "../registry.js"
const tag = Symbol("AbapXml")

const extension = (type: string) => {
  const tpext = type === "MSAG/N" ? type.replace(/\//, "") : type.replace(/\/.*/, "")

  if (tpext === "XSLT") return ".xslt.source.xml"

  return `.${tpext.toLowerCase()}.xml`
}

export class AbapXml extends AbapObjectBase {
  public [tag] = true
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
  override get extension() {
    const config = getObjectTypeConfig(this.type)
    if (config?.extension) return config.extension
    return extension(this.type)
  }
  override get gui_objects(): "yes" | "no" | "better" {
    const config = getObjectTypeConfig(this.type)
    if (config) return config.gui_objects
    return "better"
  }
  override contentsPath() {
    if (this.type === "XSLT/VT") return super.contentsPath()
    return this.path
  }
}

export const isAbapXml = (x: any): x is AbapXml => !!x?.[tag]
