import { sapEscape } from "../../functions"
import { window, QuickPickItem } from "vscode"
import { ObjectNode } from "../parsers/AdtNodeStructParser"

export const PACKAGE = "DEVC/K"

export interface NewObjectConfig {
  name: string
  parentName: string
  description: string
  devclass: string
  responsible: string
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

export class CreatableObjectType implements QuickPickItem {
  protected _parentType: string
  get parentType() {
    return this._parentType
  }
  constructor(
    public readonly type: string,
    public readonly label: string,
    public readonly rootName: string,
    public readonly nameSpace: string,
    public readonly pathTemplate: string,
    public readonly validateTemplate: string
  ) {
    this._parentType = PACKAGE
  }
  protected escapedValues(config: NewObjectConfig): any {
    return escapeObj({
      ...config,
      type: this.type,
      parentType: this._parentType
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

  objNode(newObj: NewObjectConfig): ObjectNode {
    return {
      OBJECT_TYPE: this.type,
      OBJECT_NAME: newObj.name.toLowerCase(),
      TECH_NAME: newObj.name.toLowerCase(),
      OBJECT_URI: this.getPath(newObj),
      OBJECT_VIT_URI: "",
      EXPANDABLE: ""
    }
  }

  getCreatePayload(config: NewObjectConfig) {
    const payload = `<?xml version="1.0" encoding="UTF-8"?>
    <${this.rootName} ${this.nameSpace} 
      xmlns:adtcore="http://www.sap.com/adt/core" 
      adtcore:description="${config.description}" 
      adtcore:name="${config.name}" adtcore:type="${this.type}" 
      adtcore:responsible="${config.responsible}">
        <adtcore:packageRef adtcore:name="${config.parentName}"/>
    </${this.rootName}>`
    return payload
  }
}

class FGObjectType extends CreatableObjectType {
  constructor(
    public readonly type: string,
    public readonly label: string,
    public readonly rootName: string,
    public readonly nameSpace: string,
    public readonly pathTemplate: string,
    public readonly validateTemplate: string
  ) {
    super(type, label, rootName, nameSpace, pathTemplate, validateTemplate)
    this._parentType = "FUGR/F"
  }
  getCreatePayload(config: NewObjectConfig) {
    const payload = `<?xml version="1.0" encoding="UTF-8"?>
<${this.rootName} ${this.nameSpace} 
   xmlns:adtcore="http://www.sap.com/adt/core" 
   adtcore:description="${config.description}" 
   adtcore:name="${config.name}" adtcore:type="${this.type}" 
   adtcore:responsible="${config.responsible}"> 
     <adtcore:containerRef adtcore:name="${config.parentName}" 
       adtcore:type="${this._parentType}" 
       adtcore:uri="${this.getBasePath(config)}"/>
</${this.rootName}>`

    return payload
  }
}

export function getObjectType(type: string): CreatableObjectType | undefined {
  return OBJECTTYPES.find(t => t.type === type)
}
export async function selectObjectType(
  parentType?: string
): Promise<CreatableObjectType | undefined> {
  const types = parentType
    ? OBJECTTYPES.filter(t => t.parentType === parentType)
    : OBJECTTYPES
  return window.showQuickPick(types.length > 0 ? types : OBJECTTYPES)
}

export const OBJECTTYPES: CreatableObjectType[] = [
  new CreatableObjectType(
    "PROG/P",
    "Program",
    "program:abapProgram",
    'xmlns:program="http://www.sap.com/adt/programs/programs"',
    "/sap/bc/adt/programs/programs",
    "/sap/bc/adt/programs/validation?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new CreatableObjectType(
    "CLAS/OC",
    "Class",
    "class:abapClass",
    'xmlns:class="http://www.sap.com/adt/oo/classes"',
    "/sap/bc/adt/oo/classes",
    "/sap/bc/adt/oo/validation/objectname?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new CreatableObjectType(
    "INTF/OI",
    "Interface",
    "intf:abapInterface",
    'xmlns:intf="http://www.sap.com/adt/oo/interfaces"',
    "/sap/bc/adt/oo/interfaces",
    "/sap/bc/adt/oo/validation/objectname?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new CreatableObjectType(
    "FUGR/F",
    "Function Group",
    "group:abapFunctionGroup",
    'xmlns:group="http://www.sap.com/adt/functions/groups"',
    "/sap/bc/adt/functions/groups",
    "/sap/bc/adt/functions/validation?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new FGObjectType(
    "FUGR/FF",
    "Function module",
    "fmodule:abapFunctionModule",
    'xmlns:fmodule="http://www.sap.com/adt/functions/fmodules"',
    "/sap/bc/adt/functions/groups/{parentName}/fmodules",
    "/sap/bc/adt/functions/validation?objtype={type}&objname={name}&fugrname={parentName}&description={description}"
  ),
  new CreatableObjectType(
    "PROG/I",
    "Include",
    "include:abapInclude",
    'xmlns:include="http://www.sap.com/adt/programs/includes"',
    "/sap/bc/adt/programs/includes",
    "/sap/bc/adt/includes/validation?objtype={type}&objname={name}&packagename={parentName}&description={description}"
  ),
  new FGObjectType(
    "FUGR/I",
    "Function group include",
    "finclude:abapFunctionGroupInclude",
    'xmlns:finclude="http://www.sap.com/adt/functions/fincludes"',
    "/sap/bc/adt/functions/groups/{parentName}/includes",
    "/sap/bc/adt/functions/validation?objtype={type}&objname={name}&fugrname={parentName}&description={description}"
  )
]
