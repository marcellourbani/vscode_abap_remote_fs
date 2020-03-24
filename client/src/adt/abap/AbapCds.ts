import { AbapObject } from "./AbapObject"

export class AbapCds extends AbapObject {
  public getExtension(): string {
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
}
