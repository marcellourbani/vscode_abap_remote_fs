import { AbapObject, AbapComponents } from "./AbapObject"
import { Uri } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { parseNodeStructure } from "../adt/AdtNodeStructParser"

export class AbapPackage extends AbapObject {
  isLeaf() {
    return false
  }
  getChildren(connection: AdtConnection): Promise<AbapComponents> {
    const base = this.getUri(Uri.parse("adt://" + connection.name))
    return connection.request(base, "POST").then(response => {
      return parseNodeStructure(response.body)
    })
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
