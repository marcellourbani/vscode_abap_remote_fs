import { AbapObjectBase, convertSlash } from "../AbapObject"
import { AbapObjectCreator } from "../creator"
import { AbapClass } from "."
import { ADTClient, classIncludes } from "abap-adt-api"
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
  public get structure() {
    return undefined
  }
  get expandable() {
    return false
  }
  set expandable(x: boolean) {
    //
  }
  readonly hasStructure = false
  public parent?: AbapClass
  public setParent(parent: AbapClass) {
    this.parent = parent
  }
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
