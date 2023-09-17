import {
  AbapObjectCreator,
  AbapObjectBase,
  AbapObject,
  AbapObjectService
} from ".."
const tag = Symbol("AbapXml")

const extension = (type: string) => {
  const tpext =
    type === "MSAG/N" ? type.replace(/\//, "") : type.replace(/\/.*/, "")

  if (tpext === "XSLT") return ".xslt.source.xml"

  return `.${tpext.toLowerCase()}.xml`
}

@AbapObjectCreator("MSAG/N", "XSLT/VT", "HTTP", "SRVB/SVB", "SUSO/B", "AUTH", "SUSH", "DTEL/DE", "SIA6")
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
  get extension() {
    return extension(this.type)
  }
  contentsPath() {
    if (this.type === "XSLT/VT") return super.contentsPath()
    return this.path
  }
}

export const isAbapXml = (x: any): x is AbapXml => !!x?.[tag]
