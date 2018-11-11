import { AdtConnection } from "./adt/AdtConnection"
import { workspace, Uri } from "vscode"
import { fromUri } from "./adt/AdtServer"
import { selectRemote, pickAdtRoot } from "./config"

export async function connectAdtServer(selector: any) {
  const connectionID = selector && selector.connection
  const remote = await selectRemote(connectionID)
  const connection = AdtConnection.fromRemote(remote)

  await connection.connect() // if connection raises an exception don't mount any folder

  workspace.updateWorkspaceFolders(0, 0, {
    uri: Uri.parse("adt://" + remote.name),
    name: remote.name + "(ABAP)"
  })
}

export async function activateCurrent(selector: Uri) {
  const server = fromUri(selector)
  const obj = await server.findAbapObject(selector)
  server.activate(obj)
}

export async function searchAdtObject() {
  //find the adt relevant namespace roots, and let the user pick one if needed
  const root = await pickAdtRoot()
  const server = root && fromUri(root.uri)
  const object = server && (await server.objectFinder.findObject())
  const path = object && (await server!.objectFinder.findObjectPath(object))
  console.log(path)
  server!.objectFinder.locateObject(path!)
}
