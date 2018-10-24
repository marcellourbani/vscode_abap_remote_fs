import { AbapObject } from "./AbapObject"
import { Uri } from "vscode"

export class AbapPackage extends AbapObject {
  isLeaf() {
    return false
  }
  getUri(base: Uri): Uri {
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)
    return base.with({
      path: "/sap/bc/adt/repository/nodestructure",
      query: `parent_name=${pname}&parent_tech_name=${pname}&parent_type=${ptype}&withShortDescriptions=true`
    })
  }
}
