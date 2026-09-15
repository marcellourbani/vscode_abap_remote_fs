import { AbapObjectBase } from "../AbapObject"
import {
  type AbapClassStructure,
  type classIncludes,
  isClassStructure,
  type NodeStructure,
  ADTClient,
  type Node
} from "abap-adt-api"
import { ObjectErrors } from "../AOError"
const tag = Symbol("AbapClass")

export class AbapClass extends AbapObjectBase {
  [tag] = true
  private _cstructure: AbapClassStructure | undefined
  public override get structure(): AbapClassStructure | undefined {
    return this._cstructure
  }
  public override set structure(value: AbapClassStructure | undefined) {
    this._cstructure = value
  }
  public findInclude(name: classIncludes) {
    return this.structure?.includes.find(i => i["class:includeType"] === name)
  }

  override async loadStructure(refresh = false): Promise<AbapClassStructure> {
    const structure = await super.loadStructure(refresh)
    if (!isClassStructure(structure)) throw ObjectErrors.NotSupported(this)
    this.structure = structure
    return this.structure
  }

  public override async childComponents(includeIncludes?: boolean): Promise<NodeStructure> {
    const nodes: Node[] = []
    const structure = this.structure || (await this.loadStructure())
    const sources = ADTClient.classIncludes(structure)
    for (const include of structure.includes) {
      const inclType = include["class:includeType"]
      const node = {
        OBJECT_NAME: `${this.name}.${inclType}`,
        OBJECT_TYPE: include["adtcore:type"],
        TECH_NAME: inclType, // bit of a hack, used to match include metadata
        OBJECT_URI: sources.get(inclType) || "",
        OBJECT_VIT_URI: this.sapGuiUri,
        EXPANDABLE: ""
      }
      if (include["abapsource:sourceUri"] === "source/main") nodes.unshift(node)
      else nodes.push(node)
    }
    return { categories: [], objectTypes: [], nodes }
  }
}

export const isAbapClass = (x: any): x is AbapClass => !!x?.[tag]
