import { AbapObject, AbapObjectName } from "./AbapObject"
import { Uri } from "vscode"

export class AbapFunctionGroup extends AbapObject {
  isLeaf() {
    return false
  }
  getUri(base: Uri): Uri {
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)
    const abapname = new AbapObjectName(this.name)
    const techname = encodeURIComponent(
      abapname.namespace === ""
        ? "SAPL" + abapname.name
        : `/${abapname.namespace}/SAPL${abapname.name}`
    )
    return base.with({
      path: "/sap/bc/adt/repository/nodestructure",
      query: `parent_name=${pname}&parent_tech_name=${techname}&parent_type=${ptype}&withShortDescriptions=true`
    })
  }
}
