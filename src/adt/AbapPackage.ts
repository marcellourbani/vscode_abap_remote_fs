import { AbapObject } from "./AbapObject"
import { Uri } from "vscode"

export class AbapPackage extends AbapObject {
  getUri(base: Uri): Uri {
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)
    return base.with({
      query: `parent_name=${pname}&parent_tech_name=${pname}&parent_type=${ptype}&withShortDescriptions=true`
    })
  }
}
