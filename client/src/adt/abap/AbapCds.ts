import { AbapObject } from "./AbapObject"

export class AbapCds extends AbapObject {
  public getExtension(): string {
    return ".cds.abap"
  }
}
