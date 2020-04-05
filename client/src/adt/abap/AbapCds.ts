import { AbapObject } from "./AbapObject"
import { ADTClient } from "abap-adt-api"

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
  public async getMainPrograms(client: ADTClient) {
    return []
  }
}
