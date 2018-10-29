import { AbapObject } from "./AbapObject"
import { Uri } from "vscode"
import { AdtConnection } from "../adt/AdtConnection"
import { parseNode, NodeStructure } from "../adt/AdtNodeStructParser"
import { pick } from "../functions"

export class AbapPackage extends AbapObject {
  isLeaf() {
    return false
  }
  getChildren(connection: AdtConnection): Promise<NodeStructure> {
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)
    const query = `parent_name=${pname}&parent_tech_name=${pname}&parent_type=${ptype}&withShortDescriptions=true`

    const uri = Uri.parse("adt://" + connection.name).with({
      path: "/sap/bc/adt/repository/nodestructure",
      query: this.name ? query : "" //hack for root of object tree, modeled as a nameless package
    })
    return connection
      .request(uri, "POST")
      .then(pick("body"))
      .then(parseNode)
  }
}
