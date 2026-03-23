import { RemoteManager, createClient } from "../config"
import { AFsService, Root } from "abapfs"
import { Uri, FileSystemError, workspace } from "vscode"
import { ADTClient } from "abap-adt-api"
import { LogOutPendingDebuggers } from "./debugger"
import { SapSystemValidator } from "../services/sapSystemValidator"
import { LocalFsProvider } from "../fs/LocalFsProvider"
import { log } from "../lib"
import { addLogEntry, updateLogEntry, isLogging } from "./adtCommLog"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()
const creations = new Map<string, Promise<void>>()

/** Serialize any payload to a string, returning undefined if empty. Caps at 2MB to avoid memory issues. */
const MAX_PAYLOAD_SIZE = 2 * 1024 * 1024
const serializePayload = (data: any): string | undefined => {
  if (data === undefined || data === null) return undefined
  try {
    const str = typeof data === "string" ? data : JSON.stringify(data)
    if (str.length > MAX_PAYLOAD_SIZE) {
      return str.substring(0, MAX_PAYLOAD_SIZE) + `\n\n--- TRUNCATED (${str.length} chars total, showing first ${MAX_PAYLOAD_SIZE}) ---`
    }
    return str
  } catch {
    return "[unserializable]"
  }
}

/** Extract all headers as a flat Record<string, string> */
const extractHeaders = (headers: any): Record<string, string> | undefined => {
  if (!headers || typeof headers !== "object") return undefined
  const result: Record<string, string> = {}
  // axios headers may be a plain object or an AxiosHeaders instance with a toJSON method
  const raw = typeof headers.toJSON === "function" ? headers.toJSON() : headers
  for (const [key, val] of Object.entries(raw)) {
    if (val !== undefined && val !== null) result[key] = String(val)
  }
  return Object.keys(result).length ? result : undefined
}

/** Monkey-patch the internal axios instance to log every ADT HTTP call */
const addLoggingInterceptor = (adtClient: ADTClient, connId: string) => {
  try {
    const httpClient = adtClient.httpClient as any
    if (
      httpClient &&
      typeof httpClient === "object" &&
      httpClient.httpclient &&
      typeof httpClient.httpclient === "object" &&
      httpClient.httpclient.axios &&
      typeof httpClient.httpclient.axios.interceptors === "object"
    ) {
      const axios = httpClient.httpclient.axios

      // ── Request interceptor: create log entry (only when comm-log panel is open) ──
      axios.interceptors.request.use((config: any) => {
        if (config && typeof config === "object") {
          config._adtLogStart = Date.now()
          if (!isLogging()) return config
          try {
            const method = (config.method || "GET").toUpperCase()
            const url = typeof config.url === "string" ? config.url : ""
            const params = config.params && typeof config.params === "object"
              ? { ...config.params }
              : undefined
            const requestBody = serializePayload(config.data)
            const requestHeaders = extractHeaders(config.headers)

            const entry = addLogEntry({
              connId, method, url, params, requestBody, requestHeaders,
              responseHeaders: undefined,
              status: undefined, responseBody: undefined,
              duration: undefined, startTime: config._adtLogStart, endTime: undefined, error: false
            })
            config._adtLogId = entry.id
          } catch { /* never break HTTP pipeline for logging */ }
        }
        return config
      })

      // ── Response interceptor: update log entry ──
      axios.interceptors.response.use(
        (response: any) => {
          if (response?.config && isLogging()) {
            try {
              const now = Date.now()
              const start = response.config._adtLogStart
              const duration = start ? now - start : undefined
              const status = response.status
              const responseBody = serializePayload(response.data)
              const responseHeaders = extractHeaders(response.headers)
              const logId: number | undefined = response.config._adtLogId

              if (logId !== undefined) {
                updateLogEntry(logId, { status, responseBody, responseHeaders, duration, endTime: now })
              } else {
                // Request was in-flight when webview opened — create entry from what we have
                const method = (response.config.method || "GET").toUpperCase()
                const url = response.config.url || ""
                const params = response.config.params && typeof response.config.params === "object"
                  ? { ...response.config.params } : undefined
                const requestBody = serializePayload(response.config.data)
                const requestHeaders = extractHeaders(response.config.headers)
                addLogEntry({
                  connId, method, url, params, requestBody, requestHeaders,
                  status, responseBody, responseHeaders,
                  duration, startTime: start, endTime: now, error: false
                })
              }
            } catch { /* never break HTTP pipeline for logging */ }
          }
          return response
        },
        (error: any) => {
          if (error?.config && isLogging()) {
            try {
              const now = Date.now()
              const start = error.config._adtLogStart
              const duration = start ? now - start : undefined
              const status = error.response?.status || "ERR"
              const responseBody = serializePayload(error.response?.data)
              const responseHeaders = extractHeaders(error.response?.headers)
              const logId: number | undefined = error.config._adtLogId

              if (logId !== undefined) {
                updateLogEntry(logId, { status, responseBody, responseHeaders, duration, endTime: now, error: true })
              } else {
                const method = (error.config.method || "GET").toUpperCase()
                const url = error.config.url || ""
                const params = error.config.params && typeof error.config.params === "object"
                  ? { ...error.config.params } : undefined
                const requestBody = serializePayload(error.config.data)
                const requestHeaders = extractHeaders(error.config.headers)
                addLogEntry({
                  connId, method, url, params, requestBody, requestHeaders,
                  status, responseBody, responseHeaders,
                  duration, startTime: start, endTime: now, error: true
                })
              }
            } catch { /* never break HTTP pipeline for logging */ }
          }
          return Promise.reject(error)
        }
      )
    }
  } catch (error) {
    log(`⚠️ Failed to add logging interceptor: ${error}`)
  }
}

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

export const abapUri = (u?: Uri) => u?.scheme === ADTSCHEME && !LocalFsProvider.useLocalStorage(u)

async function create(connId: string) {
  const manager = RemoteManager.get()
  const connection = await manager.byIdAsync(connId)
  if (!connection) throw Error(`Connection not found ${connId}`)

  // 🔐 VALIDATE SYSTEM ACCESS BEFORE CLIENT CREATION
  log(`🔍 Validating SAP system access for connection: ${connId}`)
  const validator = SapSystemValidator.getInstance()
  await validator.validateSystemAccess(
    connection.url,
    connection.sapGui?.server,
    connection.username
  )
  log(`✅ SAP system validation passed for: ${connId}`)

  let client
  if (connection.oauth || connection.password) {
    client = createClient(connection)
    await client.login() // raise exception for login issues
    await client.statelessClone.login()

    // Fix LIKE issue: Add Content-Type header for SQL queries
    const addContentTypeInterceptor = (adtClient: ADTClient) => {
      try {
        // Safely access the internal axios instance with proper error handling
        const httpClient = adtClient.httpClient as any
        if (
          httpClient &&
          typeof httpClient === "object" &&
          httpClient.httpclient &&
          typeof httpClient.httpclient === "object" &&
          httpClient.httpclient.axios &&
          typeof httpClient.httpclient.axios.interceptors === "object"
        ) {
          httpClient.httpclient.axios.interceptors.request.use((config: any) => {
            // Validate config object structure
            if (!config || typeof config !== "object") {
              return config
            }

            // Only modify specific datapreview requests
            if (typeof config.url === "string" && config.url.includes("/datapreview/freestyle")) {
              config.headers = config.headers || {}
              config.headers["Content-Type"] = "text/plain"
            }
            return config
          })
        }
      } catch (error) {
        // Log error but don't break connection establishment
        log(`⚠️ Failed to add Content-Type interceptor: ${error}`)
      }
    }

    addContentTypeInterceptor(client)
    addContentTypeInterceptor(client.statelessClone)
    addLoggingInterceptor(client, connId)
    addLoggingInterceptor(client.statelessClone, connId)
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
        const httpClient = adtClient.httpClient as any
        if (
          httpClient &&
          typeof httpClient === "object" &&
          httpClient.httpclient &&
          typeof httpClient.httpclient === "object" &&
          httpClient.httpclient.axios &&
          typeof httpClient.httpclient.axios.interceptors === "object"
        ) {
          httpClient.httpclient.axios.interceptors.request.use((config: any) => {
            // Validate config object structure
            if (!config || typeof config !== "object") {
              return config
            }

            // Only modify specific datapreview requests
            if (typeof config.url === "string" && config.url.includes("/datapreview/freestyle")) {
              config.headers = config.headers || {}
              config.headers["Content-Type"] = "text/plain"
            }
            return config
          })
        }
      } catch (error) {
        // Log error but don't break connection establishment
        log(`⚠️ Failed to add Content-Type interceptor: ${error}`)
      }
    }

    addContentTypeInterceptor(client)
    addContentTypeInterceptor(client.statelessClone)
    addLoggingInterceptor(client, connId)
    addLoggingInterceptor(client.statelessClone, connId)
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
      throw error // Preserve the original validation error message
    }
  }
  return getClient(connId, clone)
}

export function getClient(connId: string, clone = true) {
  const client = clients.get(connId)
  if (client) return clone ? client.statelessClone : client

  // If client doesn't exist, this means validation failed or connection was never established
  // Instead of generic "missing" error, provide more helpful feedback
  throw new Error(
    `SAP system '${connId}' is not accessible. This may be due to whitelist restrictions or connection issues. Check the extension logs for validation details.`
  )
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
  for (const root of roots.values()) if (root.lockManager.lockedPaths().next().value) return true
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
  !!workspace.workspaceFolders?.find(
    f => f.uri.scheme === ADTSCHEME && f.uri.authority === connId?.toLowerCase()
  )
