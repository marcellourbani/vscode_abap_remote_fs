import { RemoteManager, createClient } from "../config"
import { AFsService, Root } from "abapfs"
import { Uri, FileSystemError } from "vscode"
import { ADTClient } from "abap-adt-api"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

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
  return client
}

async function getOrCreateClient(connId: string) {
  let client = clients.get(connId)
  if (!client) {
    client = await create(connId)
    clients.set(connId, client)
  }
  return client.statelessClone
}

export function getClient(connId: string) {
  const client = clients.get(connId)
  if (client) return client
  throw missing(connId)
}

export const getRoot = (connId: string) => {
  const root = roots.get(connId)
  if (root) return root
  throw missing(connId)
}

export const uriRoot = (uri: Uri) => {
  if (uri && uri.scheme === ADTSCHEME) return getRoot(uri.authority)
  throw missing(uri.toString())
}

export const getOrCreateRoot = async (connId: string) => {
  const root = roots.get(connId)
  if (root) return root
  const client = await getOrCreateClient(connId)
  const service = new AFsService(client)
  const newRoot = new Root(connId, service)
  roots.set(connId, newRoot)
  return newRoot
}

export function createUri(connId: string, path: string, query: string = "") {
  return Uri.parse("adt://" + connId).with({
    path,
    query
  })
}
