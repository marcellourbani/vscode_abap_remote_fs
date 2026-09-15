import { AbapObjectBase } from "../AbapObject.js"
const tag = Symbol("AbapCds")

export class AbapCds extends AbapObjectBase {
  public [tag] = true
  override get extension(): string {
    switch (this.type) {
      case "DDLS/DF":
        return ".ddls.asddls"
      case "DCLS/DL":
        return ".dcls.asdcls"
      case "DDLX/EX":
        return ".ddlx.asddlxs"
      case "BDEF/BDO":
        return ".bdef.asbdef"
      case "SRVD/SRV": // not properly cds but similar syntax
        return ".srvd.srvdsrv"
    }
    return ".cds" // should never happen...
  }
  override get expandable() {
    return false
  }
  override set expandable(_: boolean) {
    // ignore
  }
  public override async mainPrograms() {
    return []
  }
}
export const isAbapCds = (x: any): x is AbapCds => !!x?.[tag]
