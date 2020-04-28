import { RemoteManager, createClient } from "../config"
import { AFsService, Root, isAbapStat, AbapStat } from "abapfs"
import { Uri, FileSystemError, workspace } from "vscode"
import { ADTClient } from "abap-adt-api"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()

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

export async function getOrCreateClient(connId: string, clone = true) {
  let client = clients.get(connId)
  if (!client) {
    client = await create(connId)
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
  const client = await getOrCreateClient(connId, false)
  const service = new AFsService(client)
  const newRoot = new Root(connId, service)
  roots.set(connId, newRoot)
  return newRoot
}
// export function restoreLocks() {
//   return Promise.all(
//     workspace.textDocuments.map(async doc => {
//       if (doc.uri.scheme !== ADTSCHEME || !doc.isDirty) return
//       return uriRoot(doc.uri).lockManager.requestLock(doc.uri.path)
//     })
//   )
// }
export function hasLocks() {
  for (const root of roots.values())
    if (root.lockManager.lockedPaths().next().value) return true
}
export function disconnect() {
  // TODO logout stateless too?
  return Promise.all([...clients.values()].map(c => c.logout()))
}

// TODO move
export function createUri(connId: string, path: string, query: string = "") {
  return Uri.parse("adt://" + connId).with({
    path,
    query
  })
}

export function findAbapObject(uri: Uri) {
  const file = uriRoot(uri).getNode(uri.path)
  if (isAbapStat(file)) return file.object
  throw new Error("Not an ABAP object")
}

export const pathSequence = (root: Root, uri: Uri | undefined): AbapStat[] => {
  if (uri)
    try {
      const parts = uri.path.split("/")
      let path = ""
      const nodes: AbapStat[] = []
      for (const part of parts) {
        path = `${path}/${part}`
        const hit = root.getNode(path)
        if (isAbapStat(hit)) nodes.push()
      }
      return nodes
    } catch (e) {
      // ignore
    }
  return []
}
