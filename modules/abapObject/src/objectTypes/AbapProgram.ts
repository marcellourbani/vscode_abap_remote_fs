import { AbapObjectCreator } from "../creator"
import { AbapObjectBase } from ".."
import { NodeStructure, ADTClient } from "abap-adt-api"
import { ObjectErrors } from "../AOError"

const tag = Symbol("AbapProgram")

@AbapObjectCreator("PROG/P")
export class AbapProgram extends AbapObjectBase {
  [tag] = true
  protected filterInvalid(original: NodeStructure, includeIncludes?: boolean): NodeStructure {
    if (!this.structure)
      throw ObjectErrors.noStructure(
        this,
        `metadata not loaded for ${this.key}`
      )
    
    const { nodes } = original
    
    // Main program node - always include this
    const mainProgramNode = {
      OBJECT_TYPE: "PROG/P",
      OBJECT_NAME: `${this.name}`,
      TECH_NAME: "",
      OBJECT_URI: this.path,
      EXPANDABLE: "",
      OBJECT_VIT_URI: this.sapGuiUri
    }
    
    // If includeIncludes is true (called from activator), return includes + main program
    if (includeIncludes) {
      const includeNodes = nodes.filter(
        n => n.OBJECT_TYPE === "PROG/I" &&
             n.OBJECT_NAME &&
             n.OBJECT_URI
      )
      // Return main program + all includes
      return { categories: [], objectTypes: [], nodes: [mainProgramNode, ...includeNodes] }
    }
    
    // Otherwise (filesystem operations), return only the program itself
    return { categories: [], objectTypes: [], nodes: [mainProgramNode] }
  }

  get extension() {
    return this.expandable ? "" : ".prog.abap"
  }

  async childComponents(includeIncludes?: boolean) {
    if (!this.structure) await this.loadStructure()
    if (!this.expandable) return { nodes: [], categories: [], objectTypes: [] }
    return super.childComponents(includeIncludes)
  }
}

export const isAbapProgram = (x: any): x is AbapProgram => !!x?.[tag]
