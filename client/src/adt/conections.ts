import { RemoteManager, createClient, createAuthenticatedClient, formatKey } from "../config"
import { AFsService, Root } from "abapfs"
import { Uri, FileSystemError, CancellationError, workspace } from "vscode"
import { ADTClient, session_types } from "abap-adt-api"
import {
  isBrowserSsoSessionExpired,
  loginWithBrowserSsoCookies,
  onBrowserSsoAuthFailure,
  replaceBrowserSsoCookies
} from "vscode-abap-remote-fs-sharedapi"
import { LogOutPendingDebuggers } from "./debugger"
import { SapSystemValidator } from "../services/sapSystemValidator"
import { LocalFsProvider } from "../fs/LocalFsProvider"
import {
  cancelAllBrowserSsoCaptures,
  cancelBrowserSsoCapture,
  captureBrowserSsoCookies,
  clearSsoCookies,
  getSsoCookies
} from "../auth/browserSso"
import { log } from "../lib"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()
const browserSsoConnections = new Set<string>()
const removedConnections = new Set<string>()
const cancelledLogins = new Set<string>()
const creations = new Map<string, Promise<void>>()
const connectionGenerations = new Map<string, number>()
const disconnects = new Map<string, Promise<void>>()
const ssoRecoveries = new Map<string, Promise<boolean>>()
const cloneSsoRecoveries = new Map<string, Promise<boolean>>()
const cookieRefreshes = new Map<string, Promise<boolean>>()
// Connections whose SSO login was rejected and not yet renewed; the client stays registered.
const expiredBrowserSso = new Set<string>()
// No new Browser SSO logins while Disconnect or shutdown is cleaning up
let disconnecting = 0
let browserSsoLoginListener: ((connId: string) => void) | undefined

export function onBrowserSsoLogin(listener: (connId: string) => void) {
  browserSsoLoginListener = listener
}

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

function notConnected(connectionKey: string) {
  const error = new CancellationError()
  error.message = cancelledLogins.has(connectionKey)
    ? `Login to SAP system ${connectionKey} was cancelled. Run Connect to log in again.`
    : `SAP system ${connectionKey} is not connected. Run Connect to reconnect.`
  return error
}

export const abapUri = (u?: Uri) => u?.scheme === ADTSCHEME && !LocalFsProvider.useLocalStorage(u)

// End SAP sessions of a client nobody will use; never throws
function discardClient(connectionKey: string, client: ADTClient) {
  void (async () => {
    const loggedIn = [client, client.statelessClone].filter(c => c.loggedin)
    await Promise.all(loggedIn.map(c => c.logout()))
  })().catch(error =>
    log(`[disconnect] Logout of abandoned ${connectionKey} client failed: ${error}`)
  )
}

async function create(connId: string) {
  const connectionKey = formatKey(connId)
  const generation = connectionGenerations.get(connectionKey) ?? 0
  const wasRemoved = () =>
    removedConnections.has(connectionKey) ||
    (connectionGenerations.get(connectionKey) ?? 0) !== generation
  const stopIfRemoved = (client: ADTClient) => {
    if (!wasRemoved()) return
    discardClient(connectionKey, client)
    throw new CancellationError()
  }
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
  if (wasRemoved()) throw new CancellationError()
  log(`✅ SAP system validation passed for: ${connId}`)

  const authMethod = (connection as any).authMethod || "basic"
  const validAuthMethods = ["basic", "cert", "kerberos", "browser_sso", "oauth_onprem"]
  if (!validAuthMethods.includes(authMethod)) {
    log(`⚠️ Unknown authMethod '${authMethod}' for ${connId} — falling back to basic auth`)
  }
  log.debug(
    `[connect] Creating client for ${connId}: authMethod=${authMethod}, hasOAuth=${!!connection.oauth}, hasPassword=${!!connection.password}`
  )
  let client: ADTClient

  if (authMethod !== "basic" && validAuthMethods.includes(authMethod)) {
    log.debug(`[connect] Using createAuthenticatedClient for ${connId} (${authMethod})`)
    client = await createAuthenticatedClient(connection)
    stopIfRemoved(client)
    await client.login()
    stopIfRemoved(client)
    log.debug(`[connect] client.login() succeeded for ${connId}`)
    await client.statelessClone.login()
    log.debug(`[connect] statelessClone.login() succeeded for ${connId}`)
  } else if (connection.oauth || connection.password) {
    client = createClient(connection)
    await client.login() // raise exception for login issues
    await client.statelessClone.login()
  } else {
    const password = (await manager.askPassword(connection.name)) || ""
    if (!password) throw Error("Can't connect without a password")
    client = await createClient({ ...connection, password })
    await client.login() // raise exception for login issues
    await client.statelessClone.login()
    connection.password = password
    const { name, username } = connection
    await manager.savePassword(name, username, password)
  }

  stopIfRemoved(client)
  // @ts-ignore
  const service = new AFsService(client)
  const newRoot = new Root(connId, service)
  roots.set(connectionKey, newRoot)
  clients.set(connectionKey, client)
  if (authMethod === "browser_sso") {
    browserSsoConnections.add(connectionKey)
    registerBrowserSsoRecovery(connectionKey, client)
    browserSsoLoginListener?.(connectionKey)
  }
}

// Track connections that failed with non-retryable errors (e.g. SSO timeout, auth rejection)
// to prevent VS Code filesystem from triggering infinite retry loops
const failedConnections = new Map<string, string>() // connId → error message

function retryConnectionMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/run connect again to retry/i.test(message)) return `Connection failed: ${message}`
  return `Connection failed: ${message.replace(/[.!?]+$/, "")}. Run Connect again to retry.`
}

// Login problems that repeat until the user acts; network errors are worth retrying
function needsUserAction(error: unknown) {
  const msg = String((error as Error)?.message || error)
  return (
    msg.includes("timed out") ||
    msg.includes("SSO") ||
    msg.includes("authentication") ||
    msg.includes("OAuth") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("cancelled") ||
    msg.includes("Can't connect without a password")
  )
}

export async function recoverBrowserSsoConnection(
  connId: string,
  error: unknown
): Promise<boolean> {
  if (!isBrowserSsoSessionExpired(error)) return false
  return retryBrowserSsoLogin(connId)
}

async function retryBrowserSsoLogin(connId: string): Promise<boolean> {
  const connectionKey = formatKey(connId)
  if (
    disconnecting ||
    removedConnections.has(connectionKey) ||
    cancelledLogins.has(connectionKey) ||
    failedConnections.has(connectionKey)
  )
    return false
  const pending = ssoRecoveries.get(connectionKey)
  if (pending) return pending
  const cloneRecovery = cloneSsoRecoveries.get(connectionKey)
  if (cloneRecovery) {
    await cloneRecovery.catch(() => false)
    if (
      disconnecting ||
      removedConnections.has(connectionKey) ||
      cancelledLogins.has(connectionKey) ||
      failedConnections.has(connectionKey)
    )
      return false
  }
  if (!browserSsoConnections.has(connectionKey)) {
    const connection = await RemoteManager.get()
      .byIdAsync(connectionKey)
      .catch(() => undefined)
    if (connection?.authMethod !== "browser_sso") return false
  }
  return reauthenticateBrowserSso(connId)
}

// Requests that fail while a renewal is running wait for it and are then repeated.
function registerBrowserSsoRecovery(connectionKey: string, client: ADTClient) {
  onBrowserSsoAuthFailure(client, () => retryBrowserSsoLogin(connectionKey))
  onBrowserSsoAuthFailure(client.statelessClone, () => retryBrowserSsoClone(connectionKey, client))
}

function retryBrowserSsoClone(connectionKey: string, client: ADTClient) {
  if (
    disconnecting ||
    removedConnections.has(connectionKey) ||
    cancelledLogins.has(connectionKey) ||
    failedConnections.has(connectionKey)
  )
    return Promise.resolve(false)
  const mainRecovery = ssoRecoveries.get(connectionKey)
  if (mainRecovery) return mainRecovery
  let recovery = cloneSsoRecoveries.get(connectionKey)
  if (!recovery) {
    recovery = recoverBrowserSsoClone(connectionKey, client).finally(() => {
      if (cloneSsoRecoveries.get(connectionKey) === recovery)
        cloneSsoRecoveries.delete(connectionKey)
    })
    cloneSsoRecoveries.set(connectionKey, recovery)
  }
  return recovery
}

async function recoverBrowserSsoClone(connectionKey: string, client: ADTClient) {
  try {
    const renewed = await renewBrowserSsoClone(connectionKey, client)
    if (renewed) {
      cancelledLogins.delete(connectionKey)
      failedConnections.delete(connectionKey)
    }
    return renewed
  } catch (error) {
    if (removedConnections.has(connectionKey) || clients.get(connectionKey) !== client) return false
    if (error instanceof CancellationError) {
      cancelledLogins.add(connectionKey)
      throw notConnected(connectionKey)
    }
    if (needsUserAction(error))
      failedConnections.set(connectionKey, retryConnectionMessage(error))
    throw error
  }
}

function reauthenticateBrowserSso(connId: string): Promise<boolean> {
  const connectionKey = formatKey(connId)
  const pending = ssoRecoveries.get(connectionKey)
  if (pending) return pending
  const recovery = renewBrowserSsoLogin(connId).finally(() => ssoRecoveries.delete(connectionKey))
  ssoRecoveries.set(connectionKey, recovery)
  return recovery
}

async function renewBrowserSsoLogin(connId: string) {
  const connectionKey = formatKey(connId)
  const generation = connectionGenerations.get(connectionKey) ?? 0
  const wasRemoved = () =>
    removedConnections.has(connectionKey) ||
    (connectionGenerations.get(connectionKey) ?? 0) !== generation
  log.debug(`[browser-sso] Re-authenticating ${connectionKey} after session failure`)
  const client = clients.get(connectionKey)
  if (client) expiredBrowserSso.add(connectionKey)
  try {
    if (client) await renewBrowserSsoClient(connectionKey, client, wasRemoved)
    else {
      await clearSsoCookies(connectionKey)
      await create(connId)
    }
  } catch (error) {
    if (wasRemoved()) throw notConnected(connectionKey)
    if (error instanceof CancellationError) {
      cancelledLogins.add(connectionKey)
      throw notConnected(connectionKey)
    }
    if (needsUserAction(error)) failedConnections.set(connectionKey, retryConnectionMessage(error))
    throw error
  }
  expiredBrowserSso.delete(connectionKey)
  failedConnections.delete(connectionKey)
  return true
}

async function renewBrowserSsoClone(connectionKey: string, client: ADTClient) {
  const generation = connectionGenerations.get(connectionKey) ?? 0
  const isCurrent = () =>
    clients.get(connectionKey) === client &&
    !removedConnections.has(connectionKey) &&
    (connectionGenerations.get(connectionKey) ?? 0) === generation
  let loggedIn = await loginBrowserSsoClient(
    client.statelessClone,
    await getSsoCookies(connectionKey)
  )
  if (!isCurrent()) return false
  if (!loggedIn) {
    const connection = await RemoteManager.get().byIdAsync(connectionKey)
    if (!connection || !isCurrent()) return false
    const cookies = await captureBrowserSsoCookies(
      connection.name,
      connection.url,
      connection.client
    )
    if (!isCurrent()) return false
    loggedIn = await loginBrowserSsoClient(client.statelessClone, cookies)
  }
  if (!loggedIn) throw new Error("SAP rejected the new Browser SSO login")
  if (isCurrent()) browserSsoLoginListener?.(connectionKey)
  return isCurrent()
}

async function loginBrowserSsoClient(client: ADTClient, cookies: readonly string[]) {
  if (!cookies.some(cookie => cookie.includes("="))) return false
  replaceBrowserSsoCookies(client, cookies)
  try {
    await client.login()
    return true
  } catch (error) {
    if (isBrowserSsoSessionExpired(error)) return false
    throw error
  }
}

// Features keep references to the client, so a renewed login reuses it instead of replacing it.
async function renewBrowserSsoClient(
  connectionKey: string,
  client: ADTClient,
  wasRemoved: () => boolean
) {
  const connection = await RemoteManager.get().byIdAsync(connectionKey)
  if (!connection) throw Error(`Connection not found ${connectionKey}`)
  // Locks belonged to the expired SAP session
  roots.get(connectionKey)?.lockManager.dropall(true)
  client.stateful = session_types.stateless
  // The saved login often still works when only the SAP session timed out
  let loggedIn = await loginWithBrowserSsoCookies(client, await getSsoCookies(connectionKey))
  if (wasRemoved()) {
    discardClient(connectionKey, client)
    throw new CancellationError()
  }
  if (!loggedIn) {
    const cookies = await captureBrowserSsoCookies(
      connection.name,
      connection.url,
      connection.client
    )
    if (wasRemoved()) throw new CancellationError()
    loggedIn = await loginWithBrowserSsoCookies(client, cookies)
    if (wasRemoved()) {
      discardClient(connectionKey, client)
      throw new CancellationError()
    }
  }
  if (!loggedIn) throw new Error("SAP rejected the new Browser SSO login")
  browserSsoLoginListener?.(connectionKey)
}

/** Capture new cookies for the language server or debugger without restarting editor sessions. */
export async function refreshBrowserSsoCookies(connId: string): Promise<boolean> {
  const connectionKey = formatKey(connId)
  if (
    disconnecting ||
    removedConnections.has(connectionKey) ||
    cancelledLogins.has(connectionKey) ||
    failedConnections.has(connectionKey)
  )
    return false
  const renewal = ssoRecoveries.get(connectionKey)
  if (renewal) return renewal.catch(() => false)
  const cloneRenewal = cloneSsoRecoveries.get(connectionKey)
  if (cloneRenewal) return cloneRenewal.catch(() => false)
  let refresh = cookieRefreshes.get(connectionKey)
  if (!refresh) {
    refresh = captureFreshBrowserSsoCookies(connectionKey).finally(() =>
      cookieRefreshes.delete(connectionKey)
    )
    cookieRefreshes.set(connectionKey, refresh)
  }
  return refresh
}

async function captureFreshBrowserSsoCookies(connectionKey: string) {
  const generation = connectionGenerations.get(connectionKey) ?? 0
  const connection = await RemoteManager.get()
    .byIdAsync(connectionKey)
    .catch(() => undefined)
  if (
    removedConnections.has(connectionKey) ||
    (connectionGenerations.get(connectionKey) ?? 0) !== generation
  )
    return false
  if (connection?.authMethod !== "browser_sso") return false
  try {
    await captureBrowserSsoCookies(connection.name, connection.url, connection.client)
  } catch (error) {
    log(`[browser-sso] Login for ${connectionKey} did not complete: ${error}`)
    return false
  }
  const current =
    !removedConnections.has(connectionKey) &&
    (connectionGenerations.get(connectionKey) ?? 0) === generation
  if (current) browserSsoLoginListener?.(connectionKey)
  return current
}

/** Tell the language server to try again; used when the user asks to connect. */
export function announceBrowserSsoLogin(connId: string) {
  const connectionKey = formatKey(connId)
  if (browserSsoConnections.has(connectionKey)) browserSsoLoginListener?.(connectionKey)
}

function createIfMissing(connId: string) {
  const connectionKey = formatKey(connId)
  // The user removed the folder or cancelled the login: stay away until Connect.
  if (removedConnections.has(connectionKey) || cancelledLogins.has(connectionKey)) {
    return Promise.reject(notConnected(connectionKey))
  }
  // If connection previously failed with a non-retryable error, don't retry
  const failReason = failedConnections.get(connectionKey)
  if (failReason) {
    return Promise.reject(new Error(failReason))
  }
  if (expiredBrowserSso.has(connectionKey)) {
    return reauthenticateBrowserSso(connId).then(() => undefined)
  }
  if (roots.get(connectionKey)) return
  let creation = creations.get(connectionKey)
  if (!creation) {
    const generation = connectionGenerations.get(connectionKey) ?? 0
    creation = create(connId).catch(async err => {
      if (
        removedConnections.has(connectionKey) ||
        (connectionGenerations.get(connectionKey) ?? 0) !== generation
      )
        throw notConnected(connectionKey)
      if (err instanceof CancellationError) {
        cancelledLogins.add(connectionKey)
        throw notConnected(connectionKey)
      }
      if (await recoverBrowserSsoConnection(connId, err)) return
      // Mark as permanently failed if it's an interactive/auth error
      // so VS Code filesystem doesn't keep triggering retry loops
      if (needsUserAction(err)) {
        log.debug(
          `[connect] Marking ${connectionKey} as failed (no auto-retry): ${String(err?.message || err).substring(0, 100)}`
        )
        failedConnections.set(connectionKey, retryConnectionMessage(err))
      }
      throw err
    })
    creations.set(connectionKey, creation)
    void creation.then(
      () => {
        if (creations.get(connectionKey) === creation) creations.delete(connectionKey)
      },
      () => {
        if (creations.get(connectionKey) === creation) creations.delete(connectionKey)
      }
    )
  }
  return creation
}

/** Clear the failed state for a connection (called on disconnect/reconnect). */
export async function clearConnectionFailure(connId: string) {
  const connectionKey = formatKey(connId)
  await disconnects
    .get(connectionKey)
    ?.catch(error => log(`[disconnect] Cleanup failed for ${connectionKey}: ${error}`))
  failedConnections.delete(connectionKey)
  removedConnections.delete(connectionKey)
  cancelledLogins.delete(connectionKey)
}

export async function getOrCreateClient(connId: string, clone = true) {
  await createIfMissing(connId)
  return getClient(connId, clone)
}

export function getClient(connId: string, clone = true) {
  connId = formatKey(connId)
  if (removedConnections.has(connId) || cancelledLogins.has(connId)) throw notConnected(connId)
  const client = clients.get(connId)
  if (client) return clone ? client.statelessClone : client

  // If client doesn't exist, this means validation failed or connection was never established
  // Instead of generic "missing" error, provide more helpful feedback
  throw new Error(
    `SAP system '${connId}' is not accessible. This may be due to whitelist restrictions or connection issues. Check the extension logs for validation details.`
  )
}

export const getRoot = (connId: string) => {
  const root = roots.get(formatKey(connId))
  if (root) return root
  throw missing(connId)
}

export const uriRoot = (uri: Uri) => {
  if (abapUri(uri)) return getRoot(uri.authority)
  throw missing(uri.toString())
}

export const getOrCreateRoot = async (connId: string) => {
  await createIfMissing(connId)
  return getRoot(connId)
}

export function hasLocks() {
  for (const root of roots.values()) if (root.lockManager.lockedPaths().next().value) return true
}

async function logoutClient(connId: string, client: ADTClient) {
  log.debug(`[disconnect] Logging out SAP client ${connId}`)
  await Promise.all([
    client.logout(),
    ...(client.statelessClone.loggedin ? [client.statelessClone.logout()] : [])
  ])
}

async function logoutClientWithTimeout(connId: string, client: ADTClient) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      logoutClient(connId, client),
      new Promise<void>(resolve => {
        timer = setTimeout(() => {
          log(`[disconnect] SAP logout timed out for ${connId}`)
          resolve()
        }, 5000)
      })
    ])
  } catch (error) {
    log(`[disconnect] SAP logout failed for ${connId}: ${error}`)
  } finally {
    clearTimeout(timer)
  }
}

async function clearBrowserSsoCookies(connId: string) {
  const connectionKey = formatKey(connId)
  if (browserSsoConnections.has(connectionKey)) {
    await clearSsoCookies(connectionKey)
    return
  }
  const connection = await RemoteManager.get()
    .byIdAsync(connectionKey)
    .catch(() => undefined)
  if (connection?.authMethod === "browser_sso") await clearSsoCookies(connectionKey)
}

export async function disconnectConnection(connId: string) {
  connId = formatKey(connId)
  const pending = disconnects.get(connId)
  if (pending) return pending
  removedConnections.add(connId)
  connectionGenerations.set(connId, (connectionGenerations.get(connId) ?? 0) + 1)
  cancelledLogins.delete(connId)
  const client = clients.get(connId)
  const browserSso = browserSsoConnections.has(connId)
  clients.delete(connId)
  roots.delete(connId)
  browserSsoConnections.delete(connId)
  expiredBrowserSso.delete(connId)
  failedConnections.delete(connId)
  creations.delete(connId)
  const cleanup = (async () => {
    await cancelBrowserSsoCapture(connId)
    if (client) await logoutClientWithTimeout(connId, client)
    if (browserSso) await clearSsoCookies(connId)
    else await clearBrowserSsoCookies(connId)
  })()
  disconnects.set(connId, cleanup)
  void cleanup.then(
    () => {
      if (disconnects.get(connId) === cleanup) disconnects.delete(connId)
    },
    () => {
      if (disconnects.get(connId) === cleanup) disconnects.delete(connId)
    }
  )
  return cleanup
}

export async function disconnect(
  workspaceConnectionIds: string[] = [],
  preserveBrowserSso = false
) {
  disconnecting++
  try {
    await disconnectAll(workspaceConnectionIds, preserveBrowserSso)
  } finally {
    disconnecting--
  }
}

async function disconnectAll(workspaceConnectionIds: string[], preserveBrowserSso: boolean) {
  log.debug(`[disconnect] preserveBrowserSso=${preserveBrowserSso}, clients=${clients.size}`)
  const workspaceIds = new Set(workspaceConnectionIds.map(formatKey))
  const blockedNow = [...new Set([...clients.keys(), ...creations.keys(), ...workspaceIds])].filter(
    id => !removedConnections.has(id)
  )
  // Requests must not rebuild a connection while it is being logged out
  for (const id of blockedNow) {
    removedConnections.add(id)
    connectionGenerations.set(id, (connectionGenerations.get(id) ?? 0) + 1)
    // Do not let a later Connect join work that this disconnect just invalidated.
    // The old promise is still generation-guarded and will discard any client it creates.
    creations.delete(id)
  }
  await cancelAllBrowserSsoCaptures()
  const failures: unknown[] = []
  const collectFailures = (results: PromiseSettledResult<unknown>[]) => {
    for (const result of results) if (result.status === "rejected") failures.push(result.reason)
  }
  const ssoIds = new Set(browserSsoConnections)
  if (preserveBrowserSso) {
    collectFailures(
      await Promise.allSettled(
        [...roots]
          .filter(([id]) => ssoIds.has(id))
          .flatMap(([, root]) =>
            [...root.lockManager.lockedPaths()].map(path =>
              root.lockManager.requestUnlock(path, true)
            )
          )
      )
    )
  }
  // A Browser SSO logout only ends this window's SAP sessions, so it is safe even when preserving
  const connected = [...clients.entries()]
  collectFailures(
    await Promise.allSettled([
      ...connected.map(([connectionId, client]) => logoutClientWithTimeout(connectionId, client)),
      ...LogOutPendingDebuggers()
    ])
  )
  const cookieIds = [...new Set([...connected.map(([id]) => id), ...workspaceIds])].filter(
    id => !preserveBrowserSso || !ssoIds.has(id)
  )
  collectFailures(await Promise.allSettled(cookieIds.map(clearBrowserSsoCookies)))
  log.debug(`[disconnect] Completed; logged out ${connected.length} SAP client(s)`)
  clients.clear()
  roots.clear()
  browserSsoConnections.clear()
  expiredBrowserSso.clear()
  // Clear all failure states so reconnect is possible
  failedConnections.clear()
  cancelledLogins.clear()
  // Systems without a folder may reconnect on demand, as before
  for (const id of blockedNow) if (!workspaceIds.has(id)) removedConnections.delete(id)
  for (const failure of failures) log(`[disconnect] Cleanup step failed: ${failure}`)
  if (failures.length) throw failures[0]
}

export const rootIsConnected = (connId: string) =>
  !!workspace.workspaceFolders?.find(
    f => f.uri.scheme === ADTSCHEME && f.uri.authority === connId?.toLowerCase()
  )
