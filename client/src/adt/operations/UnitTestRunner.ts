import { Uri } from "vscode"
import { alertManagers } from "../../views/abapunit"
import { getClient, findAbapObject } from "../conections"

export async function abapUnit(uri: Uri) {
  const object = await findAbapObject(uri)
  const testClasses = await getClient(uri.authority).runUnitTest(object.path)
  alertManagers.get(uri.authority).update(testClasses, true)
}
