import { AbapObject } from "./AbapObject"
import { Uri } from "vscode"

export class AbapSimpleObject extends AbapObject {
  getUri(base: Uri): Uri {
    return base.with({ path: this.path })
  }
}
