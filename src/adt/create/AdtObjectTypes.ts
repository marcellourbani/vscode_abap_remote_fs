import { sapEscape } from "../../functions"
import { window, QuickPickItem } from "vscode"

export interface NewObjectConfig {
  name: string
  parentName: string
  description: string
  devclass: string
}
function expand(template: string, values: any): string {
  return template.replace(/{([^}]+)}/g, (x, y) => values[y] || "")
}

export function objMap(fn: (x: any) => any): (o: Object) => Object
export function objMap(fn: (x: any) => any, orig?: Object): Object {
  function mapper(or: any) {
    return Object.keys(or).reduce(
      (retval, key) => {
        const mapped = fn(or[key])
        if (mapped !== undefined) retval[key] = mapped
        return retval
      },
      {} as any
    )
  }
  return orig ? mapper(orig) : mapper
}
const escapeObj = objMap(sapEscape)

export class ObjType implements QuickPickItem {
  constructor(
    public readonly type: string,
    public readonly label: string,
    public readonly parentType: string,
    public readonly rootName: string,
    public readonly nameSpace: string,
    public readonly pathTemplate: string,
    public readonly validateTemplate: string
  ) {}
  protected escapedValues(config: NewObjectConfig): any {
    return escapeObj({
      ...config,
      type: this.type,
      parentType: this.parentType
    })
  }
  getPath(config: NewObjectConfig): string {
    const conf = this.escapedValues(config)
    return expand(this.pathTemplate, conf) + "/" + conf.name
  }
  getBasePath(config: NewObjectConfig): string {
    return expand(this.pathTemplate, this.escapedValues(config))
  }

  getValidatePath(config: NewObjectConfig) {
    return expand(this.validateTemplate, this.escapedValues(config))
  }

  getCreatePayload(config: NewObjectConfig) {
    const parentRef =
      this.parentType === "DEVC/K"
        ? `<adtcore:packageRef adtcore:name="${config.parentName}"/>`
        : `<adtcore:containerRef adtcore:name="${
            config.parentName
          }" adtcore:type="${this.parentType}" adtcore:uri="${this.getBasePath(
            config
          )}"/>`

    const payload = `<?xml version="1.0" encoding="UTF-8"?>
<${this.rootName} ${
      this.nameSpace
    } xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${
      config.description
    }" adtcore:name="${config.name}" adtcore:type="${this.type}">
    ${parentRef}
  
</${this.rootName}>`
    return payload
  }
}
export async function selectObjectType(): Promise<ObjType | undefined> {
  return window.showQuickPick(OBJECTTYPES)
}

export const OBJECTTYPES: ObjType[] = [
  new ObjType(
    "PROG/I",
    "Include",
    "DEVC/K",
    "include:abapInclude",
    'xmlns:include="http://www.sap.com/adt/programs/includes"',
    "/sap/bc/adt/programs/includes",
    "/sap/bc/adt/includes/validation?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new ObjType(
    "INTF/OI",
    "Interface",
    "DEVC/K",
    "intf:abapInterface",
    'xmlns:intf="http://www.sap.com/adt/oo/interfaces"',
    "/sap/bc/adt/oo/interfaces",
    "/sap/bc/adt/oo/validation/objectname?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new ObjType(
    "FUGR/FF",
    "Function module",
    "FUGR/F",
    "fmodule:abapFunctionModule",
    'xmlns:fmodule="http://www.sap.com/adt/functions/fmodules"',
    "/sap/bc/adt/functions/groups/{parentName}/fmodules",
    "/sap/bc/adt/functions/validation?objtype={type}&objname={name}&fugrname={parentName}&description={description}"
  ),
  new ObjType(
    "FUGR/I",
    "Function group include",
    "FUGR/F",
    "finclude:abapFunctionGroupInclude",
    'xmlns:finclude="http://www.sap.com/adt/functions/fincludes"',
    "/sap/bc/adt/functions/groups/{parentName}/includes",
    "/sap/bc/adt/functions/validation?objtype={type}&objname={name}&fugrname={parentName}&description={description}"
  )
]
