import { AbapObjectBase } from "../AbapObject"
import { AbapObjectCreator } from ".."
const tag = Symbol("AbapClass")

@AbapObjectCreator("DDLS/DF", "DCLS/DL", "DDLX/EX", "BDEF/BDO")
export class AbapCds extends AbapObjectBase {
  [tag] = true
  get extension(): string {
    switch (this.type) {
      case "DDLS/DF":
        return ".ddls.asddls"
      case "DCLS/DL":
        return ".dcls.asdcls"
      case "DDLX/EX":
        return ".ddlx.asddlxs"
      case "BDEF/BDO":
        return ".bdef.asbdef"
    }
    return ".cds" // should never happen...
  }
  public async mainPrograms() {
    return []
  }
}
export const isAbapCds = (x: any): x is AbapCds => !!x?.[tag]
