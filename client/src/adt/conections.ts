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

/**
 * Mutable lifecycle state for one normalized connection ID.
 *
 * Keeping these values together is important: connection creation, SSO recovery, and disconnect
 * can overlap. A stable state object lets those operations observe the same flags and generation
 * instead of coordinating several independent maps.
 */
interface ConnectionState {
  readonly key: string
  // Resources currently exposed to the rest of the extension.
  root?: Root
  client?: ADTClient

  // Connection status that controls whether automatic work may continue.
  browserSso: boolean
  removed: boolean
  cancelled: boolean
  // Incremented whenever existing asynchronous work must no longer publish its result.
  generation: number

  // Shared in-flight operations. Concurrent callers wait for the same promise.
  creation?: Promise<void>
  disconnect?: Promise<void>
  ssoRecovery?: Promise<boolean>
  cloneSsoRecovery?: Promise<boolean>
  cookieRefresh?: Promise<boolean>

  // The SSO login was rejected and has not been renewed; the client stays registered.
  expiredBrowserSso: boolean
  // Failures requiring user action are retained to prevent repeated automatic login prompts.
  failure?: string
}

const connectionStates = new Map<string, ConnectionState>()

function stateFor(connId: string) {
  const key = formatKey(connId)
  let state = connectionStates.get(key)
  if (!state) {
    // Keep this object for the lifetime of the extension. In-flight operations hold references to
    // it, while the generation prevents an old operation from reviving an invalid connection.
    state = {
      key,
      browserSso: false,
      removed: false,
      cancelled: false,
      generation: 0,
      expiredBrowserSso: false
    }
    connectionStates.set(key, state)
  }
  return state
}

// No new Browser SSO logins while Disconnect or shutdown is cleaning up
let disconnecting = 0
let browserSsoLoginListener: ((connId: string) => void) | undefined

export function onBrowserSsoLogin(listener: (connId: string) => void) {
  browserSsoLoginListener = listener
}

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

function notConnected(state: ConnectionState) {
  const error = new CancellationError()
  error.message = state.cancelled
    ? `Login to SAP system ${state.key} was cancelled. Run Connect to log in again.`
    : `SAP system ${state.key} is not connected. Run Connect to reconnect.`
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
  const state = stateFor(connId)
  const generation = state.generation
  const wasRemoved = () => state.removed || state.generation !== generation
  const stopIfRemoved = (client: ADTClient) => {
    if (!wasRemoved()) return
    discardClient(state.key, client)
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
  state.root = newRoot
  state.client = client
  if (authMethod === "browser_sso") {
    state.browserSso = true
    registerBrowserSsoRecovery(state, client)
    browserSsoLoginListener?.(state.key)
  }
}

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
  const state = stateFor(connId)
  if (disconnecting || state.removed || state.cancelled || state.failure) return false
  const pending = state.ssoRecovery
  if (pending) return pending
  const cloneRecovery = state.cloneSsoRecovery
  if (cloneRecovery) {
    await cloneRecovery.catch(() => false)
    if (disconnecting || state.removed || state.cancelled || state.failure) return false
  }
  if (!state.browserSso) {
    const connection = await RemoteManager.get()
      .byIdAsync(state.key)
      .catch(() => undefined)
    if (connection?.authMethod !== "browser_sso") return false
  }
  return reauthenticateBrowserSso(connId)
}

// Requests that fail while a renewal is running wait for it and are then repeated.
function registerBrowserSsoRecovery(state: ConnectionState, client: ADTClient) {
  onBrowserSsoAuthFailure(client, () => retryBrowserSsoLogin(state.key))
  onBrowserSsoAuthFailure(client.statelessClone, () => retryBrowserSsoClone(state, client))
}

function retryBrowserSsoClone(state: ConnectionState, client: ADTClient) {
  if (disconnecting || state.removed || state.cancelled || state.failure)
    return Promise.resolve(false)
  const mainRecovery = state.ssoRecovery
  if (mainRecovery) return mainRecovery
  let recovery = state.cloneSsoRecovery
  if (!recovery) {
    recovery = recoverBrowserSsoClone(state, client).finally(() => {
      if (state.cloneSsoRecovery === recovery) state.cloneSsoRecovery = undefined
    })
    state.cloneSsoRecovery = recovery
  }
  return recovery
}

async function recoverBrowserSsoClone(state: ConnectionState, client: ADTClient) {
  try {
    const renewed = await renewBrowserSsoClone(state, client)
    if (renewed) {
      state.cancelled = false
      state.failure = undefined
    }
    return renewed
  } catch (error) {
    if (state.removed || state.client !== client) return false
    if (error instanceof CancellationError) {
      state.cancelled = true
      throw notConnected(state)
    }
    if (needsUserAction(error)) state.failure = retryConnectionMessage(error)
    throw error
  }
}

function reauthenticateBrowserSso(connId: string): Promise<boolean> {
  const state = stateFor(connId)
  const pending = state.ssoRecovery
  if (pending) return pending
  const recovery = renewBrowserSsoLogin(connId, state).finally(() => {
    if (state.ssoRecovery === recovery) state.ssoRecovery = undefined
  })
  state.ssoRecovery = recovery
  return recovery
}

async function renewBrowserSsoLogin(connId: string, state: ConnectionState) {
  const generation = state.generation
  const wasRemoved = () => state.removed || state.generation !== generation
  log.debug(`[browser-sso] Re-authenticating ${state.key} after session failure`)
  const { client } = state
  if (client) state.expiredBrowserSso = true
  try {
    if (client) await renewBrowserSsoClient(state, client, wasRemoved)
    else {
      await clearSsoCookies(state.key)
      await create(connId)
    }
  } catch (error) {
    if (wasRemoved()) throw notConnected(state)
    if (error instanceof CancellationError) {
      state.cancelled = true
      throw notConnected(state)
    }
    if (needsUserAction(error)) state.failure = retryConnectionMessage(error)
    throw error
  }
  state.expiredBrowserSso = false
  state.failure = undefined
  return true
}

async function renewBrowserSsoClone(state: ConnectionState, client: ADTClient) {
  const generation = state.generation
  const isCurrent = () =>
    state.client === client && !state.removed && state.generation === generation
  let loggedIn = await loginBrowserSsoClient(client.statelessClone, await getSsoCookies(state.key))
  if (!isCurrent()) return false
  if (!loggedIn) {
    const connection = await RemoteManager.get().byIdAsync(state.key)
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
  if (isCurrent()) browserSsoLoginListener?.(state.key)
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
  state: ConnectionState,
  client: ADTClient,
  wasRemoved: () => boolean
) {
  const connection = await RemoteManager.get().byIdAsync(state.key)
  if (!connection) throw Error(`Connection not found ${state.key}`)
  // Locks belonged to the expired SAP session
  state.root?.lockManager.dropall(true)
  client.stateful = session_types.stateless
  // The saved login often still works when only the SAP session timed out
  let loggedIn = await loginWithBrowserSsoCookies(client, await getSsoCookies(state.key))
  if (wasRemoved()) {
    discardClient(state.key, client)
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
      discardClient(state.key, client)
      throw new CancellationError()
    }
  }
  if (!loggedIn) throw new Error("SAP rejected the new Browser SSO login")
  browserSsoLoginListener?.(state.key)
}

/** Capture new cookies for the language server or debugger without restarting editor sessions. */
export async function refreshBrowserSsoCookies(connId: string): Promise<boolean> {
  const state = stateFor(connId)
  if (disconnecting || state.removed || state.cancelled || state.failure) return false
  const renewal = state.ssoRecovery
  if (renewal) return renewal.catch(() => false)
  const cloneRenewal = state.cloneSsoRecovery
  if (cloneRenewal) return cloneRenewal.catch(() => false)
  let refresh = state.cookieRefresh
  if (!refresh) {
    refresh = captureFreshBrowserSsoCookies(state).finally(() => {
      if (state.cookieRefresh === refresh) state.cookieRefresh = undefined
    })
    state.cookieRefresh = refresh
  }
  return refresh
}

async function captureFreshBrowserSsoCookies(state: ConnectionState) {
  const generation = state.generation
  const connection = await RemoteManager.get()
    .byIdAsync(state.key)
    .catch(() => undefined)
  if (state.removed || state.generation !== generation) return false
  if (connection?.authMethod !== "browser_sso") return false
  try {
    await captureBrowserSsoCookies(connection.name, connection.url, connection.client)
  } catch (error) {
    log(`[browser-sso] Login for ${state.key} did not complete: ${error}`)
    return false
  }
  const current = !state.removed && state.generation === generation
  if (current) browserSsoLoginListener?.(state.key)
  return current
}

/** Tell the language server to try again; used when the user asks to connect. */
export function announceBrowserSsoLogin(connId: string) {
  const state = connectionStates.get(formatKey(connId))
  if (state?.browserSso) browserSsoLoginListener?.(state.key)
}

function createIfMissing(connId: string) {
  const state = stateFor(connId)
  // The user removed the folder or cancelled the login: stay away until Connect.
  if (state.removed || state.cancelled) return Promise.reject(notConnected(state))
  // If connection previously failed with a non-retryable error, don't retry
  if (state.failure) return Promise.reject(new Error(state.failure))
  if (state.expiredBrowserSso) {
    return reauthenticateBrowserSso(connId).then(() => undefined)
  }
  if (state.root) return
  let creation = state.creation
  if (!creation) {
    const generation = state.generation
    creation = create(connId).catch(async err => {
      if (state.removed || state.generation !== generation) throw notConnected(state)
      if (err instanceof CancellationError) {
        state.cancelled = true
        throw notConnected(state)
      }
      if (await recoverBrowserSsoConnection(connId, err)) return
      // Mark as permanently failed if it's an interactive/auth error
      // so VS Code filesystem doesn't keep triggering retry loops
      if (needsUserAction(err)) {
        log.debug(
          `[connect] Marking ${state.key} as failed (no auto-retry): ${String(err?.message || err).substring(0, 100)}`
        )
        state.failure = retryConnectionMessage(err)
      }
      throw err
    })
    state.creation = creation
    void creation.then(
      () => {
        if (state.creation === creation) state.creation = undefined
      },
      () => {
        if (state.creation === creation) state.creation = undefined
      }
    )
  }
  return creation
}

/** Clear the failed state for a connection (called on disconnect/reconnect). */
export async function clearConnectionFailure(connId: string) {
  const state = stateFor(connId)
  await state.disconnect?.catch(error =>
    log(`[disconnect] Cleanup failed for ${state.key}: ${error}`)
  )
  state.failure = undefined
  state.removed = false
  state.cancelled = false
}

export async function getOrCreateClient(connId: string, clone = true) {
  await createIfMissing(connId)
  return getClient(connId, clone)
}

export function getClient(connId: string, clone = true) {
  const key = formatKey(connId)
  const state = connectionStates.get(key)
  if (state?.removed || state?.cancelled) throw notConnected(state)
  const client = state?.client
  if (client) return clone ? client.statelessClone : client

  // If client doesn't exist, this means validation failed or connection was never established
  // Instead of generic "missing" error, provide more helpful feedback
  throw new Error(
    `SAP system '${key}' is not accessible. This may be due to whitelist restrictions or connection issues. Check the extension logs for validation details.`
  )
}

export const getRoot = (connId: string) => {
  const root = connectionStates.get(formatKey(connId))?.root
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
  for (const { root } of connectionStates.values())
    if (root?.lockManager.lockedPaths().next().value) return true
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
  const state = stateFor(connId)
  if (state.browserSso) {
    await clearSsoCookies(state.key)
    return
  }
  const connection = await RemoteManager.get()
    .byIdAsync(state.key)
    .catch(() => undefined)
  if (connection?.authMethod === "browser_sso") await clearSsoCookies(state.key)
}

export async function disconnectConnection(connId: string) {
  const state = stateFor(connId)
  const pending = state.disconnect
  if (pending) return pending

  // Detach resources before awaiting network cleanup so no caller can reuse a client being logged
  // out. Incrementing the generation also invalidates creation or recovery already in progress.
  state.removed = true
  state.generation++
  state.cancelled = false
  const { client, browserSso } = state
  state.client = undefined
  state.root = undefined
  state.browserSso = false
  state.expiredBrowserSso = false
  state.failure = undefined
  state.creation = undefined
  const cleanup = (async () => {
    await cancelBrowserSsoCapture(state.key)
    if (client) await logoutClientWithTimeout(state.key, client)
    if (browserSso) await clearSsoCookies(state.key)
    else await clearBrowserSsoCookies(state.key)
  })()
  state.disconnect = cleanup
  void cleanup.then(
    () => {
      if (state.disconnect === cleanup) state.disconnect = undefined
    },
    () => {
      if (state.disconnect === cleanup) state.disconnect = undefined
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
  const workspaceIds = new Set(workspaceConnectionIds.map(formatKey))
  // Snapshot clients before any await. Cleanup must target the clients that were connected when
  // Disconnect started, even if another asynchronous operation changes a state object later.
  const connected = [...connectionStates.values()].flatMap(state =>
    state.client ? [{ key: state.key, client: state.client }] : []
  )
  log.debug(`[disconnect] preserveBrowserSso=${preserveBrowserSso}, clients=${connected.length}`)

  // Include mounted folders without a client and connections that are still being created.
  const affected = new Map(
    [...connectionStates.values()]
      .filter(state => state.client || state.creation)
      .map(state => [state.key, state])
  )
  for (const id of workspaceIds) affected.set(id, stateFor(id))
  const blockedNow = [...affected.values()].filter(state => !state.removed)
  // Requests must not rebuild a connection while it is being logged out
  for (const state of blockedNow) {
    state.removed = true
    state.generation++
    // Do not let a later Connect join work that this disconnect just invalidated.
    // The old promise is still generation-guarded and will discard any client it creates.
    state.creation = undefined
  }
  await cancelAllBrowserSsoCaptures()
  const failures: unknown[] = []
  const collectFailures = (results: PromiseSettledResult<unknown>[]) => {
    for (const result of results) if (result.status === "rejected") failures.push(result.reason)
  }
  const ssoIds = new Set(
    [...connectionStates.values()].filter(state => state.browserSso).map(state => state.key)
  )
  if (preserveBrowserSso) {
    collectFailures(
      await Promise.allSettled(
        [...connectionStates.values()]
          .filter(state => state.root && ssoIds.has(state.key))
          .flatMap(state =>
            [...state.root!.lockManager.lockedPaths()].map(path =>
              state.root!.lockManager.requestUnlock(path, true)
            )
          )
      )
    )
  }
  // A Browser SSO logout only ends this window's SAP sessions, so it is safe even when preserving
  collectFailures(
    await Promise.allSettled([
      ...connected.map(({ key, client }) => logoutClientWithTimeout(key, client)),
      ...LogOutPendingDebuggers()
    ])
  )
  const cookieIds = [...new Set([...connected.map(({ key }) => key), ...workspaceIds])].filter(
    id => !preserveBrowserSso || !ssoIds.has(id)
  )
  collectFailures(await Promise.allSettled(cookieIds.map(clearBrowserSsoCookies)))
  log.debug(`[disconnect] Completed; logged out ${connected.length} SAP client(s)`)

  // Clear resources and retry gates together. Removed mounted folders stay blocked below, while
  // folderless connections return to their previous on-demand behavior.
  for (const state of connectionStates.values()) {
    state.client = undefined
    state.root = undefined
    state.browserSso = false
    state.expiredBrowserSso = false
    state.failure = undefined
    state.cancelled = false
  }
  // Systems without a folder may reconnect on demand, as before
  for (const state of blockedNow) if (!workspaceIds.has(state.key)) state.removed = false
  for (const failure of failures) log(`[disconnect] Cleanup step failed: ${failure}`)
  if (failures.length) throw failures[0]
}

export const rootIsConnected = (connId: string) =>
  !!workspace.workspaceFolders?.find(
    f => f.uri.scheme === ADTSCHEME && f.uri.authority === connId?.toLowerCase()
  )
