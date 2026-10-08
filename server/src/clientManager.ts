import { ADTClient, createSSLConfig, type LogData, session_types } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { types } from "util"
import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { readConfiguration } from "./clientapis"
import {
  type ClientConfiguration,
  type AuthHeadersResponse,
  type CertAuthTransport,
  getAuthMethod,
  attachBrowserSsoCookies,
  loginWithBrowserSsoCookies,
  onBrowserSsoAuthFailure,
  Methods,
  type CommLogTogglePayload
} from "vscode-abap-remote-fs-sharedapi"
import { isString } from "./functions"

/**
 * Language-server resources and pending work for one normalized connection ID.
 *
 * The state object is intentionally stable so folder changes, periodic refreshes, and Browser SSO
 * recovery all update the same lifecycle record.
 */
interface ServerConnectionState {
  readonly key: string
  // Client and timer currently serving language features.
  client?: ADTClient
  refreshTimer?: ReturnType<typeof setInterval>

  // Concurrent initialization and refresh calls share these promises.
  initialization?: Promise<ADTClient | undefined>
  refresh?: Promise<void>

  // Lifecycle gates checked before asynchronous work publishes a client.
  removed: boolean
  blockedBrowserSso: boolean
  generation: number
}

const connectionStates = new Map<string, ServerConnectionState>()

type ServerSslConfig = ReturnType<typeof createSSLConfig> & {
  debugCallback?: (logData: LogData) => void
  httpsAgent?: https.Agent
  headers?: Record<string, string>
}

/**
 * Shared connection object for the language server process.
 */
export const connection = createConnection(ProposedFeatures.all)

/**
 * Log an error through the language server connection.
 */
export const error = (...params: unknown[]) => connection.console.error(convertParams(...params))

/**
 * Log a warning through the language server connection.
 */
export const warn = (...params: unknown[]) => connection.console.warn(convertParams(...params))

/**
 * Log informational output through the language server connection.
 */
export const info = (...params: unknown[]) => connection.console.info(convertParams(...params))

/**
 * Log a message through the language server connection.
 */
export const log = (...params: unknown[]) => connection.console.log(convertParams(...params))

/**
 * Extract the connection key from an ADT URI so the server can reuse the same client instance.
 */
export function clientKeyFromUrl(url: string) {
  const match = url.match(/adt:\/\/([^\/]*)/)
  return match && match[1]
}

// Folder URIs may percent-encode the connection name
function connectionKey(raw: string) {
  try {
    return decodeURIComponent(raw).toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

function stateFor(raw: string) {
  const key = connectionKey(raw)
  let state = connectionStates.get(key)
  if (!state) {
    // Keep the object after removal so work that captured it can detect the new generation.
    state = {
      key,
      removed: false,
      blockedBrowserSso: false,
      generation: 0
    }
    connectionStates.set(key, state)
  }
  return state
}

// Two refreshes at once would both replace the same old client and leak one of the new ones
function queueRefresh(state: ServerConnectionState, conf: ClientConfiguration) {
  const previous = state.refresh ?? Promise.resolve()
  // Serialize replacements for one connection. Parallel replacements could both install a client
  // and leave one of the newly created SAP sessions without an owner.
  const next = previous.catch(() => undefined).then(() => refreshClient(state, conf))
  state.refresh = next
  void next
    .finally(() => {
      if (state.refresh === next) state.refresh = undefined
    })
    .catch(() => undefined)
  return next
}

function createFetchToken(conf: ClientConfiguration) {
  if (conf.oauth)
    return () => connection.sendRequest(Methods.getToken, conf.name) as Promise<string>
}

/** Fetch auth headers from the client extension for non-basic auth methods. */
async function fetchAuthHeaders(connName: string): Promise<AuthHeadersResponse | undefined> {
  try {
    const headers = await connection.sendRequest(Methods.getAuthHeaders, connName)
    if (headers && typeof headers === "object") {
      return headers as AuthHeadersResponse
    }
  } catch {
    // Client may not support this method (older version) — fall back silently
  }
  return undefined
}

/** Whether the client has the comm-log panel open */
const activeConnections = new Set<string>()

/**
 * Track whether a connection should receive comm-log notifications from the server.
 */
export function setCommLogActive(active: CommLogTogglePayload) {
  if (active.active) activeConnections.add(active.connId)
  else activeConnections.delete(active.connId)
}

/** Build a debugCallback that chains MongoDB tracing and comm log forwarding */
function buildServerDebugCallback(connId: string) {
  return (logData: LogData) =>
    activeConnections.has(connId) &&
    connection.sendNotification(Methods.commLogEntry, { logData, connId })
}

function createServerSslConfig(conf: ClientConfiguration, connId: string): ServerSslConfig {
  const sslconf: ServerSslConfig = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = buildServerDebugCallback(connId)
  return sslconf
}

function buildCertificateAgent(
  certInfo: CertAuthTransport,
  allowSelfSigned: boolean,
  fallbackCa?: string
): https.Agent {
  const allowedExts = /\.(pem|crt|cer|key|p12|pfx)$/i
  const isPkcs12 = /\.(p12|pfx)$/i.test(certInfo.certPath || "")

  if (
    !certInfo.certPath ||
    !allowedExts.test(certInfo.certPath) ||
    !existsSync(certInfo.certPath)
  ) {
    throw new Error(`Client certificate not found or invalid extension: ${certInfo.certPath}`)
  }
  if (
    !isPkcs12 &&
    (!certInfo.keyPath || !allowedExts.test(certInfo.keyPath) || !existsSync(certInfo.keyPath))
  ) {
    throw new Error(`Private key not found or invalid extension: ${certInfo.keyPath}`)
  }

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: !allowSelfSigned,
    keepAlive: true
  }

  if (isPkcs12) {
    agentOptions.pfx = readFileSync(certInfo.certPath)
  } else {
    agentOptions.cert = readFileSync(certInfo.certPath)
    agentOptions.key = readFileSync(certInfo.keyPath)
  }

  if (certInfo.passphrase) {
    agentOptions.passphrase = certInfo.passphrase
  }

  const caSource = certInfo.caPath || fallbackCa
  if (caSource) {
    if (existsSync(caSource)) {
      agentOptions.ca = readFileSync(caSource)
    } else if (caSource.includes("-----BEGIN CERTIFICATE-----")) {
      agentOptions.ca = caSource
    } else {
      throw new Error(`CA certificate not found: ${caSource}`)
    }
  }

  return new https.Agent(agentOptions)
}

// Language features stay off until the editor reports the next Browser SSO login.
function blockBrowserSso(state: ServerConnectionState) {
  // Keep the lifecycle record but remove the unusable client and its timer. A later login
  // notification clears the block and initializes language features again.
  state.blockedBrowserSso = true
  clearInterval(state.refreshTimer)
  state.refreshTimer = undefined
  state.client = undefined
}

// Try the saved cookies first; only a rejected login asks the editor to open the browser.
function registerBrowserSsoRecovery(
  state: ServerConnectionState,
  conf: ClientConfiguration,
  client: ADTClient
) {
  const isCurrent = () => state.client === client && !state.removed
  const loginWithSavedCookies = async () => {
    const headers = await fetchAuthHeaders(conf.name)
    if (!isCurrent()) return false
    return loginWithBrowserSsoCookies(client, headers?.httpHeaders?.Cookie?.split(";") ?? [])
  }
  const renew = async () => {
    if (await loginWithSavedCookies()) return true
    if (!isCurrent()) return false
    const refreshed = await (
      connection.sendRequest(Methods.recoverBrowserSso, state.key) as Promise<boolean>
    ).catch(() => false)
    if (refreshed && isCurrent() && (await loginWithSavedCookies())) return true
    if (isCurrent()) {
      blockBrowserSso(state)
      connection.window.showWarningMessage(
        `Syntax check and code completion for ${state.key} are paused because the SAP login was not completed. Run Connect for ${state.key} to resume.`
      )
    }
    return false
  }
  let pending: Promise<boolean> | undefined
  const recover = () => {
    if (!isCurrent()) return Promise.resolve(false)
    pending ??= renew().finally(() => (pending = undefined))
    return pending
  }
  onBrowserSsoAuthFailure(client, recover)
  onBrowserSsoAuthFailure(client.statelessClone, recover)
}

const refreshClient = async (state: ServerConnectionState, conf: ClientConfiguration) => {
  if (state.removed || state.blockedBrowserSso) return
  const generation = state.generation
  const oldClient = state.client
  const sslconf = createServerSslConfig(conf, state.key)

  const authMethod = getAuthMethod(conf)
  let pwdOrFetch: string | (() => Promise<string>)
  let browserSsoCookies: string[] = []

  if (authMethod !== "basic" && !conf.oauth) {
    const authResponse = await fetchAuthHeaders(conf.name)
    if (state.removed || state.generation !== generation) return
    log(
      `[server] refreshClient: auth response received for ${state.key}: ${authResponse ? [authResponse.httpHeaders ? "httpHeaders" : undefined, authResponse.certAuth ? "certAuth" : undefined].filter(Boolean).join(",") : "null"}`
    )

    if (authMethod === "cert") {
      log(`[server] refreshClient: reconstructing cert agent for ${state.key}`)
      if (authResponse?.certAuth) {
        try {
          sslconf.httpsAgent = buildCertificateAgent(
            authResponse.certAuth,
            !!conf.allowSelfSigned,
            conf.customCA
          )
        } catch (e) {
          warn(`Failed to reconstruct cert httpsAgent for ${state.key}: ${e}`)
          // Don't create a broken client — propagate the error
          throw new Error(`Certificate auth setup failed for ${state.key}: ${e}`)
        }
      } else {
        warn(
          `Cert auth configured for ${state.key} but no cert paths received — language features will fail`
        )
      }
      pwdOrFetch = "cert-auth"
    } else if (authMethod === "oauth_onprem" && authResponse?.httpHeaders?.Authorization) {
      log(`[server] refreshClient: setting up OAuth on-prem token fetcher for ${state.key}`)
      const currentToken = authResponse.httpHeaders.Authorization.replace(/^Bearer\s+/i, "")
      pwdOrFetch = () =>
        fetchAuthHeaders(conf.name).then(h => {
          const t = h?.httpHeaders?.Authorization?.replace(/^Bearer\s+/i, "")
          return t || currentToken
        })
    } else {
      if (
        authResponse?.httpHeaders?.Cookie ||
        (authMethod !== "browser_sso" && authResponse?.httpHeaders)
      ) {
        if (authMethod === "browser_sso") {
          const { Cookie, ...headers } = authResponse.httpHeaders
          browserSsoCookies = Cookie?.split(";") ?? []
          sslconf.headers = { ...sslconf.headers, ...headers }
        } else {
          sslconf.headers = { ...sslconf.headers, ...authResponse.httpHeaders }
        }
      } else if (authMethod === "browser_sso") {
        if (oldClient) {
          warn(
            `Browser SSO cookies unavailable for ${state.key}; keeping the current client until refresh succeeds`
          )
          return
        }
        blockBrowserSso(state)
        throw new Error(
          `Browser SSO cookies unavailable for ${state.key}. Language features resume after the next Browser SSO login.`
        )
      } else if (authMethod === "kerberos") {
        warn(`${authMethod} auth headers missing for ${state.key} — user may need to reconnect`)
      }
      pwdOrFetch = `${authMethod}-auth`
    }
  } else {
    pwdOrFetch = createFetchToken(conf) || conf.password
  }

  const baseclient = new ADTClient(
    conf.url,
    conf.username,
    pwdOrFetch,
    conf.client,
    conf.language,
    sslconf
  )
  if (authMethod === "browser_sso" && !conf.oauth) {
    attachBrowserSsoCookies(baseclient, browserSsoCookies)
    attachBrowserSsoCookies(baseclient.statelessClone, browserSsoCookies)
    registerBrowserSsoRecovery(state, conf, baseclient)
  }
  baseclient.stateful = session_types.stateful
  state.client = baseclient
  if (oldClient) {
    setTimeout(() => {
      oldClient.stateful = session_types.stateless
      void oldClient.logout().catch(() => undefined)
    }, 2000)
  }
}

export function connectionFolderChanged(added: string[], removed: string[]) {
  for (const key of removed) {
    const state = stateFor(key)
    const { client } = state
    // Invalidate work started for this folder even if the same folder is immediately re-added.
    state.removed = true
    state.blockedBrowserSso = false
    state.generation++
    clearInterval(state.refreshTimer)
    state.refreshTimer = undefined
    state.initialization = undefined
    state.client = undefined
    if (client) {
      client.stateful = session_types.stateless
      void client.logout().catch(() => undefined)
    }
  }
  for (const key of added) {
    const state = stateFor(key)
    state.removed = false
    state.blockedBrowserSso = false
  }
}

export async function browserSsoLoginCompleted(connId: string) {
  const state = stateFor(connId)
  state.blockedBrowserSso = false
  // A working client picks up the new cookies itself the next time SAP rejects the old ones
  if (state.removed || state.client) return
  try {
    await clientFromKey(state.key)
  } catch (err) {
    warn(`Client refresh after Browser SSO login failed for ${state.key}: ${err}`)
  }
}

export async function clientFromKey(key: string) {
  const state = stateFor(key)
  if (state.removed || state.blockedBrowserSso) return undefined
  const { client } = state
  if (client) return client

  // The first concurrent language requests share one configuration lookup and one client.
  let initialization = state.initialization
  if (!initialization) {
    const generation = state.generation
    initialization = (async () => {
      const conf = await readConfiguration(state.key)
      if (!conf || state.removed || state.generation !== generation) return undefined
      await queueRefresh(state, conf)
      if (state.removed || state.generation !== generation) return undefined
      const created = state.client
      if (!created) return undefined
      state.refreshTimer = setInterval(() => {
        void queueRefresh(state, conf).catch(err =>
          warn(`Client refresh failed for ${state.key}: ${err}`)
        )
      }, 240000)
      return created
    })()
    state.initialization = initialization
    void initialization.then(
      () => {
        if (state.initialization === initialization) state.initialization = undefined
      },
      () => {
        if (state.initialization === initialization) state.initialization = undefined
      }
    )
  }
  return initialization
}

export async function clientFromUrl(url: string) {
  const key = clientKeyFromUrl(url)
  if (!key) return
  return clientFromKey(key)
}

function convertParams(...params: unknown[]) {
  let msg = ""
  for (const x of params) {
    try {
      if (types.isNativeError(x)) msg += `\nError ${x.name}\n${x.message}\n\n${x.stack}\n`
      else msg += isString(x) ? x : JSON.stringify(x)
    } catch (e) {
      msg += String(x)
    }
    msg += " "
  }
  return msg
}
