import { AbapObjectBase, convertSlash, type AbapObject } from "../AbapObject.js"
import { AbapClass } from "./AbapClass.js"
import { ADTClient, type classIncludes } from "abap-adt-api"
import { isAbapClass } from "./AbapClass.js"
import { type AbapObjectService } from "../AOService.js"
import { ObjectErrors } from "../AOError.js"
import type { AbapSimpleStructure } from "abap-adt-api/build/api/objectstructure.js"
const tag = Symbol("AbapClassInclude")
const CLASSINCLUDES: any = {
  testclasses: ".testclasses",
  definitions: ".locals_def",
  implementations: ".locals_imp",
  macros: ".macros",
  main: ""
}

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
      throw ObjectErrors.Invalid(this, "Parent class is required for class includes")
    if (!this.name.startsWith(parent.name))
      throw ObjectErrors.Invalid(
        this,
        `Class include ${name} doesn't belong to class ${parent.name}`
      )
    this.parent = parent
  }
  public override get structure() {
    const { includes, metaData } = this.parent.structure || {}
    const include = includes?.find(i => i["class:includeType"] === this.techName)
    if (!include || !metaData) return
    const { links, ...meta } = include
    const structure: AbapSimpleStructure = {
      objectUrl: "",
      links: include.links,
      metaData: {
        "abapsource:activeUnicodeCheck": metaData["abapsource:activeUnicodeCheck"],
        "abapsource:fixPointArithmetic": metaData["abapsource:fixPointArithmetic"],
        "adtcore:description": metaData["adtcore:description"],
        "adtcore:descriptionTextLimit": metaData["adtcore:descriptionTextLimit"],
        "adtcore:language": metaData["adtcore:language"],
        "adtcore:masterLanguage": metaData["adtcore:masterLanguage"],
        "adtcore:masterSystem": metaData["adtcore:masterSystem"],
        "adtcore:responsible": meta["adtcore:createdBy"],
        ...meta
      }
    }

    return structure
  }
  override get expandable() {
    return false
  }
  override set expandable(x: boolean) {
    //
  }
  override get lockObject() {
    return this.parent
  }

  override readonly parent: AbapClass
  override get extension() {
    let type = CLASSINCLUDES[this.techName]
    if (!type && this.techName !== "main")
      type = CLASSINCLUDES[this.name.replace(/.*\./, "")] || `.${this.techName}`
    return `.clas${type}.abap`
  }
  override async loadStructure(refresh = false) {
    await this.parent.loadStructure(refresh)
    return this.structure!
  }
  override get fsName(): string {
    const baseName = this.name.replace(/\..*/, "")
    return this.name ? `${convertSlash(baseName)}${this.extension}` : ""
  }
  override contentsPath() {
    const str = this.parent?.structure
    if (str) {
      const include = ADTClient.classIncludes(str).get(this.techName as classIncludes)
      return include || this.path
    }
    return this.path
  }
}

export const isAbapClassInclude = (x: any): x is AbapClassInclude => !!x?.[tag]
