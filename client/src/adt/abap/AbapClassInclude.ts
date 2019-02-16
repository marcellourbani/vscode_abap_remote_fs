import { ADTClient, AbapClassStructure } from "abap-adt-api"
import { AbapObject } from "./AbapObject"
import { AbapClass } from "./AbapClass"
import { FileSystemError } from "vscode"
import { SapGuiCommand } from "../sapgui/sapgui"
import { classIncludes } from "abap-adt-api"

export class AbapClassInclude extends AbapObject {
  public structure?: AbapClassStructure
  public parent?: AbapClass
  constructor(
    type: string,
    name: string,
    path: string,
    expandable?: string,
    techName?: classIncludes
  ) {
    super(type, name, path, expandable, techName)
  }
  public setParent(parent: AbapClass) {
    this.parent = parent
  }
  public getContentsUri(): string {
    if (!this.structure || !this.techName)
      throw FileSystemError.FileNotFound(this.path)
    const include = ADTClient.classIncludes(this.structure).get(this
      .techName as classIncludes)
    if (!include) throw FileSystemError.FileNotFound(this.path)
    return include
  }

  public getActivationSubject(): AbapObject {
    return this.parent || this
  }

  public getLockTarget(): AbapObject {
    return this.parent || this
  }

  get vsName(): string {
    const base = this.name.replace(/\..*/, "")
    return base.replace(/\//g, "／") + this.getExtension()
  }

  public getExecutionCommand(): SapGuiCommand | undefined {
    if (this.parent)
      return {
        type: "Transaction",
        command: "*SE24",
        parameters: [
          { name: "SEOCLASS-CLSNAME", value: this.parent.name },
          { name: "DYNP_OKCODE", value: "WB_DISPLAY" }
        ]
      }
  }

  public async loadMetadata(client: ADTClient): Promise<AbapObject> {
    if (this.parent) {
      await this.parent.loadMetadata(client)
      if (this.parent.structure)
        for (const incmeta of this.parent.structure.includes)
          if (incmeta["class:includeType"] === this.techName) {
            this.structure = this.parent.structure
            break
          }
    }
    return this
  }
}
export function isClassInclude(obj: AbapObject): obj is AbapClassInclude {
  return obj.type === "CLAS/I"
}
