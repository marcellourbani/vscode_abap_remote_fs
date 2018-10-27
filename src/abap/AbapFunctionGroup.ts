import {
  AbapObject,
  AbapObjectName,
  AbapNodeComponentByCategory
} from "./AbapObject"
import { Uri } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { pick } from "../functions"
import { parseNodeStructure } from "../adt/AdtNodeStructParser"

export class AbapFunctionGroup extends AbapObject {
  isLeaf() {
    return false
  }

  getChildren(
    connection: AdtConnection
  ): Promise<Array<AbapNodeComponentByCategory>> {
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)
    const abapname = new AbapObjectName(this.name)
    const techname = encodeURIComponent(
      abapname.namespace === ""
        ? "SAPL" + abapname.name
        : `/${abapname.namespace}/SAPL${abapname.name}`
    )

    const uri = Uri.parse("adt://" + connection.name).with({
      path: "/sap/bc/adt/repository/nodestructure",
      query: `parent_name=${pname}&parent_tech_name=${techname}&parent_type=${ptype}&withShortDescriptions=true`
    })
    return connection
      .request(uri, "POST")
      .then(pick("body"))
      .then(parseNodeStructure)
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
