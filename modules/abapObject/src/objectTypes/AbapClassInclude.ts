import { AbapObjectBase, convertSlash, AbapObject } from "../AbapObject"
import { AbapObjectCreator } from "../creator"
import { AbapClass } from "."
import { ADTClient, classIncludes } from "abap-adt-api"
import { isAbapClass } from "./AbapClass"
import { AbapObjectService } from ".."
import { ObjectErrors } from "../AOError"
import { AbapSimpleStructure } from "abap-adt-api/build/api"
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
    sapGuiUri: string,
    client: AbapObjectService
  ) {
    super(type, name, path, expandable, techName, parent, sapGuiUri, client)
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
    const { includes, metaData } = this.parent.structure || {}
    const include = includes?.find(
      i => i["class:includeType"] === this.techName
    )
    if (!include || !metaData) return
    const { links, ...meta } = include
    const structure: AbapSimpleStructure = {
      objectUrl: "",
      links: include.links,
      metaData: {
        "abapsource:activeUnicodeCheck":
          metaData["abapsource:activeUnicodeCheck"],
        "abapsource:fixPointArithmetic":
          metaData["abapsource:fixPointArithmetic"],
        "adtcore:description": metaData["adtcore:description"],
        "adtcore:descriptionTextLimit":
          metaData["adtcore:descriptionTextLimit"],
        "adtcore:language": metaData["adtcore:language"],
        "adtcore:masterLanguage": metaData["adtcore:masterLanguage"],
        "adtcore:masterSystem": metaData["adtcore:masterSystem"],
        "adtcore:responsible": meta["adtcore:createdBy"],
        ...meta
      }
    }

    return structure
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

  readonly parent: AbapClass
  get extension() {
    let type = CLASSINCLUDES[this.techName]
    if (!type && this.techName !== "main")
      type = CLASSINCLUDES[this.name.replace(/.*\./, "")] || `.${this.techName}`
    return `.clas${type}.abap`
  }
  async loadStructure() {
    await this.parent.loadStructure()
    return this.structure!
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
