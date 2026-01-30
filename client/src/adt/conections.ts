import { RemoteManager, createClient } from "../config"
import { AFsService, Root } from "abapfs"
import { Uri, FileSystemError, workspace } from "vscode"
import { ADTClient } from "abap-adt-api"
import { LogOutPendingDebuggers } from "./debugger"
import { SapSystemValidator } from "../services/sapSystemValidator"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()
const creations = new Map<string, Promise<void>>()

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

export const abapUri = (u?: Uri) => u?.scheme === ADTSCHEME

async function create(connId: string) {
  const manager = RemoteManager.get()
  const connection = await manager.byIdAsync(connId)
  if (!connection) throw Error(`Connection not found ${connId}`)
  
  // 🔐 VALIDATE SYSTEM ACCESS BEFORE CLIENT CREATION
  console.log(`🔍 Validating SAP system access for connection: ${connId}`);
  const validator = SapSystemValidator.getInstance();
  await validator.validateSystemAccess(connection.url, connection.sapGui?.server, connection.username);
  console.log(`✅ SAP system validation passed for: ${connId}`);
  
  let client
  if (connection.oauth || connection.password) {
    client = createClient(connection)
    await client.login() // raise exception for login issues
    await client.statelessClone.login()
    
    // Fix LIKE issue: Add Content-Type header for SQL queries
    const addContentTypeInterceptor = (adtClient: ADTClient) => {
      try {
        // Safely access the internal axios instance with proper error handling
        const httpClient = adtClient.httpClient as any;
        if (httpClient && 
            typeof httpClient === 'object' && 
            httpClient.httpclient && 
            typeof httpClient.httpclient === 'object' &&
            httpClient.httpclient.axios &&
            typeof httpClient.httpclient.axios.interceptors === 'object') {
          
          httpClient.httpclient.axios.interceptors.request.use((config: any) => {
            // Validate config object structure
            if (!config || typeof config !== 'object') {
              return config;
            }
            
            // Only modify specific datapreview requests
            if (typeof config.url === 'string' && config.url.includes('/datapreview/freestyle')) {
              config.headers = config.headers || {};
              config.headers['Content-Type'] = 'text/plain';
            }
            return config;
          });
        }
      } catch (error) {
        // Log error but don't break connection establishment
        console.log(`⚠️ Failed to add Content-Type interceptor: ${error}`);
      }
    };
    
    addContentTypeInterceptor(client);
    addContentTypeInterceptor(client.statelessClone);
  } else {
    const password = (await manager.askPassword(connection.name)) || ""
    if (!password) throw Error("Can't connect without a password")
    client = await createClient({ ...connection, password })
    await client.login() // raise exception for login issues
    await client.statelessClone.login()
    connection.password = password
    const { name, username } = connection
    await manager.savePassword(name, username, password)
    
    // Fix LIKE issue: Add Content-Type header for SQL queries
    const addContentTypeInterceptor = (adtClient: ADTClient) => {
      try {
        // Safely access the internal axios instance with proper error handling
        const httpClient = adtClient.httpClient as any;
        if (httpClient && 
            typeof httpClient === 'object' && 
            httpClient.httpclient && 
            typeof httpClient.httpclient === 'object' &&
            httpClient.httpclient.axios &&
            typeof httpClient.httpclient.axios.interceptors === 'object') {
          
          httpClient.httpclient.axios.interceptors.request.use((config: any) => {
            // Validate config object structure
            if (!config || typeof config !== 'object') {
              return config;
            }
            
            // Only modify specific datapreview requests
            if (typeof config.url === 'string' && config.url.includes('/datapreview/freestyle')) {
              config.headers = config.headers || {};
              config.headers['Content-Type'] = 'text/plain';
            }
            return config;
          });
        }
      } catch (error) {
        // Log error but don't break connection establishment
        console.log(`⚠️ Failed to add Content-Type interceptor: ${error}`);
      }
    };
    
    addContentTypeInterceptor(client);
    addContentTypeInterceptor(client.statelessClone);
  }
  
  // @ts-ignore
  const service = new AFsService(client)
  const newRoot = new Root(connId, service)
  roots.set(connId, newRoot)
  clients.set(connId, client)
}

function createIfMissing(connId: string) {
  if (roots.get(connId)) return
  let creation = creations.get(connId)
  if (!creation) {
    creation = create(connId)
    creations.set(connId, creation)
    creation.finally(() => creations.delete(connId))
  }
  return creation
}

export async function getOrCreateClient(connId: string, clone = true) {
  if (!clients.has(connId)) {
    try {
      await createIfMissing(connId)
    } catch (error) {
      // Re-throw validation errors with original message instead of generic "missing" error
      throw error; // Preserve the original validation error message
    }
  }
  return getClient(connId, clone)
}

export function getClient(connId: string, clone = true) {
  const client = clients.get(connId)
  if (client) return clone ? client.statelessClone : client
  
  // If client doesn't exist, this means validation failed or connection was never established
  // Instead of generic "missing" error, provide more helpful feedback
  throw new Error(`SAP system '${connId}' is not accessible. This may be due to whitelist restrictions or connection issues. Check the extension logs for validation details.`);
}

export const getRoot = (connId: string) => {
  const root = roots.get(connId)
  if (root) return root
  throw missing(connId)
}

export const uriRoot = (uri: Uri) => {
  if (abapUri(uri)) return getRoot(uri.authority)
  throw missing(uri.toString())
}

export const getOrCreateRoot = async (connId: string) => {
  if (!roots.has(connId)) await createIfMissing(connId)
  return getRoot(connId)
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
  await Promise.all([...main, ...clones, ...LogOutPendingDebuggers()])
  return
}

export const rootIsConnected = (connId: string) =>
  !!workspace.workspaceFolders?.find(f => f.uri.scheme === ADTSCHEME && f.uri.authority === connId?.toLowerCase())
