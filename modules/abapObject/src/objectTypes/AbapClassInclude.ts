import { AbapObjectBase, convertSlash, AbapObject } from "../AbapObject"
import { AbapObjectCreator } from "../creator"
import { AbapClass } from "."
import { ADTClient, classIncludes } from "abap-adt-api"
import { isAbapClass } from "./AbapClass"
import { AbapObjectService } from ".."
import { AbapObjectError, ObjectErrors } from "../AOError"
const tag = Symbol("AbapClassInclude")
const CLASSINCLUDES: any = {
  testclasses: ".testclasses",
  definitions: ".locals_def",
  implementations: ".locals_imp",
  macros: ".macros",
  main: ""
}

@AbapObjectCreator("CLAS/I")
export class AbapClassInclude extends AbapObjectBase {
  [tag] = true
  constructor(
    type: string,
    name: string,
    path: string,
    expandable: boolean,
    techName: string,
    parent: AbapObject | undefined,
    client: AbapObjectService
  ) {
    super(type, name, path, expandable, techName, parent, client)
    if (!isAbapClass(parent))
      throw ObjectErrors.Invalid(
        this,
        "Parent class is required for class includes"
      )
    if (!this.name.startsWith(parent.name))
      throw ObjectErrors.Invalid(
        this,
        `Class include ${name} doesn't belong to class ${parent.name}`
      )
    this.parent = parent
  }
  public get structure() {
    return undefined
  }
  get expandable() {
    return false
  }
  set expandable(x: boolean) {
    //
  }
  get lockObject() {
    return this.parent
  }
  readonly hasStructure = false
  readonly parent: AbapClass
  get extension() {
    const type = CLASSINCLUDES[this.name.replace(/.*\./, "")] || ""
    return `.clas${type}.abap`
  }
  get fsName(): string {
    const baseName = this.name.replace(/\..*/, "")
    return this.name ? `${convertSlash(baseName)}${this.extension}` : ""
  }
  contentsPath() {
    const str = this.parent?.structure
    if (str) {
      const include = ADTClient.classIncludes(str).get(
        this.techName as classIncludes
      )
      return include || this.path
    }
    return this.path
  }
}

export const isAbapClassInclude = (x: any): x is AbapClassInclude => !!x?.[tag]
