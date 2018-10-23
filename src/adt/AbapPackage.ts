import { AbapObject } from "./AbapObject"
import { Uri } from "vscode"

export class AbapPackage extends AbapObject {
  getUri(base: Uri): Uri {
    const ptype = encodeURIComponent(this.type)
    const pname = encodeURIComponent(this.name)
    const query = Uri.parse(
      "adt://npl/sap/bc/adt/repository/nodestructure?parent_name=%24ABAPGIT_GIT&parent_tech_name=%24ABAPGIT_GIT&user_name=MURBANI&parent_type=DEVC%2FK&withShortDescriptions=true"
    )
    if (query.path === "") console.log("dummy")
    return base.with({
      query: `parent_name=${pname}&parent_tech_name=${pname}&parent_type=${ptype}&withShortDescriptions=true`
    })
  }
}
