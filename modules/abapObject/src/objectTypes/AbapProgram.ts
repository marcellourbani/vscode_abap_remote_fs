import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { NodeStructure, ADTClient } from "abap-adt-api"
import { ObjectErrors } from "../AOError"

const tag = Symbol("AbapProgram")
@AbapObjectCreator("PROG/P")
export class AbapProgram extends AbapObjectBase {
  [tag] = true
  protected filterInvalid(original: NodeStructure): NodeStructure {
    const { nodes } = original
    const matchName = (n: string) =>
      n === this.name ||
      (n.startsWith(this.name) &&
        n.length === this.name.length + 3 &&
        n.match(/[A-Z][0-9][0-9]$/))
    const valid = nodes.filter(
      n => n.OBJECT_TYPE === "PROG/I" && matchName(n.OBJECT_NAME)
    )
    if (!this.structure)
      throw ObjectErrors.noStructure(
        this,
        `metadata not loaded for ${this.key}`
      )
    valid.unshift({
      OBJECT_TYPE: "PROG/P",
      OBJECT_NAME: `${this.name}`,
      TECH_NAME: "",
      OBJECT_URI: this.path,
      EXPANDABLE: "",
      OBJECT_VIT_URI: this.sapGuiUri
    })
    return { categories: [], objectTypes: [], nodes: valid }
  }

  get extension() {
    return this.expandable ? "" : ".prog.abap"
  }

  async childComponents() {
    if (!this.structure) await this.loadStructure()
    if (!this.expandable) return { nodes: [], categories: [], objectTypes: [] }
    return super.childComponents()
  }
}

export const isAbapProgram = (x: any): x is AbapProgram => !!x?.[tag]
