import { AbapObject } from "./AbapObject"
import { Uri } from "vscode"

export class AbapFunctionModule extends AbapObject {
  getUri(base: Uri): Uri {
    return base.with({ path: this.path + "/source/main" })
  }
}
