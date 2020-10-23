import { AbapObjectBase } from "../AbapObject"
import {
  AbapClassStructure,
  classIncludes,
  isClassStructure,
  NodeStructure,
  ADTClient,
  Node
} from "abap-adt-api"
import { ObjectErrors } from "../AOError"
import { AbapObjectCreator } from "../creator"
const tag = Symbol("AbapClass")

@AbapObjectCreator("CLAS/OC")
export class AbapClass extends AbapObjectBase {
  [tag] = true
  private _cstructure: AbapClassStructure | undefined
  public get structure(): AbapClassStructure | undefined {
    return this._cstructure
  }
  public set structure(value: AbapClassStructure | undefined) {
    this._cstructure = value
  }
  public findInclude(name: classIncludes) {
    return this.structure?.includes.find(i => i["class:includeType"] === name)
  }

  async loadStructure(): Promise<AbapClassStructure> {
    const structure = await super.loadStructure()
    if (!isClassStructure(structure)) throw ObjectErrors.NotSupported(this)
    this.structure = structure
    return this.structure
  }

  public async childComponents(): Promise<NodeStructure> {
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
