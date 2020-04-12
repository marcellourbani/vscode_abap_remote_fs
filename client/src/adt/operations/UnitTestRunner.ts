import { Uri } from "vscode"
import { fromUri } from "../AdtServer"
import { alertManagers } from "../../views/abapunit"

export async function abapUnit(uri: Uri) {
  const server = fromUri(uri)
  const object = await server.findAbapObject(uri)
  const testClasses = await server.client.runUnitTest(object.path)
  alertManagers.get(server.connectionId).update(testClasses, true)
}
