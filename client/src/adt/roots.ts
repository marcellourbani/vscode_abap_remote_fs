import { RemoteManager, createClient } from "../config"
import { AFsService, Root } from "../../../modules/abapfs"
import { Uri, FileSystemError } from "vscode"
import { ADTSCHEME } from "./AdtServer"

const roots = new Map<string, Root>()

async function create(connId: string) {
  const manager = RemoteManager.get()
  const connection = await manager.byIdAsync(connId)
  if (!connection) throw Error(`Connection not found ${connId}`)
  let client
  if (connection.oauth || connection.password) {
    client = createClient(connection)
    await client.login() // raise exception for login issues
  } else {
    connection.password = (await manager.askPassword(connection.name)) || ""
    if (!connection.password) throw Error("Can't connect without a password")
    client = await createClient(connection)
    await client.login() // raise exception for login issues
    const { name, username, password } = connection
    await manager.savePassword(name, username, password)
  }
  const service = new AFsService(client)
  return new Root(connId, service)
}

export const missing = (connId: string) => {
  throw FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

export const getRoot = (connId: string) => {
  const root = roots.get(connId)
  if (root) return root
  missing(connId)
}

export const uriRoot = (uri: Uri) => {
  if (uri && uri.scheme === ADTSCHEME) return getRoot(uri.authority)
  missing(uri.toString())
}

export const getOrCreateRoot = (connId: string) => {
  const root = roots.get(connId)
  if (root) return root
  missing(connId)
}
