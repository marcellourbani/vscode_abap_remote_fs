import { RemoteManager, createClient } from "../config"
import { AFsService, Root } from "abapfs"
import { Uri, FileSystemError } from "vscode"
import { ADTClient } from "abap-adt-api"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()
const rootsP = new Map<string, Promise<Root>>()
const clientsP = new Map<string, Promise<ADTClient>>()

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

export const abapUri = (u: Uri) => u.scheme === ADTSCHEME

async function create(connId: string) {
  const manager = RemoteManager.get()
  const connection = await manager.byIdAsync(connId)
  if (!connection) throw Error(`Connection not found ${connId}`)
  let client
  if (connection.oauth || connection.password) {
    client = createClient(connection)
    await client.login() // raise exception for login issues
    await client.statelessClone.login()
  } else {
    connection.password = (await manager.askPassword(connection.name)) || ""
    if (!connection.password) throw Error("Can't connect without a password")
    client = await createClient(connection)
    await client.login() // raise exception for login issues
    await client.statelessClone.login()
    const { name, username, password } = connection
    await manager.savePassword(name, username, password)
  }
  return client
}

export async function getOrCreateClient(connId: string, clone = true) {
  let client = clients.get(connId)
  if (!client) {
    let clientP = clientsP.get(connId)
    if (!clientP) {
      clientP = create(connId)
      clientsP.set(connId, clientP)
    }
    client = await clientP
    clients.set(connId, client)
  }
  return clone ? client.statelessClone : client
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
  let rootP = rootsP.get(connId)
  if (!rootP) {
    rootP = new Promise(async resolve => {
      const client = await getOrCreateClient(connId, false)
      // @ts-ignore
      const service = new AFsService(client)
      const newRoot = new Root(connId, service)
      roots.set(connId, newRoot)
      resolve(newRoot)
    })
    rootsP.set(connId, rootP)
  }
  return rootP
}

export function hasLocks() {
  for (const root of roots.values())
    if (root.lockManager.lockedPaths().next().value) return true
}
export async function disconnect() {
  const connected = [...clients.values()]
  const main = connected.map(c => c.logout())
  const clones = connected
    .map(c => c.statelessClone)
    .filter(c => c.loggedin)
    .map(c => c.logout())
  await Promise.all([...main, ...clones])
  return
}
