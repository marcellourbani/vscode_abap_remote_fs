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
const clients: Map<string, ADTClient> = new Map()
const refreshTimers = new Map<string, ReturnType<typeof setInterval>>()
const initializations = new Map<string, Promise<ADTClient | undefined>>()
const removedConnections = new Set<string>()
const blockedBrowserSso = new Set<string>()
const connectionGenerations = new Map<string, number>()
const refreshes = new Map<string, Promise<void>>()

// Two refreshes at once would both replace the same old client and leak one of the new ones
function queueRefresh(key: string, conf: ClientConfiguration) {
  const previous = refreshes.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => refreshClient(key, conf))
  refreshes.set(key, next)
  void next
    .finally(() => {
      if (refreshes.get(key) === next) refreshes.delete(key)
    })
    .catch(() => undefined)
  return next
}

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
function blockBrowserSso(key: string) {
  blockedBrowserSso.add(key)
  clearInterval(refreshTimers.get(key))
  refreshTimers.delete(key)
  clients.delete(key)
}

// Try the saved cookies first; only a rejected login asks the editor to open the browser.
function registerBrowserSsoRecovery(key: string, conf: ClientConfiguration, client: ADTClient) {
  const isCurrent = () => clients.get(key) === client && !removedConnections.has(key)
  const loginWithSavedCookies = async () => {
    const headers = await fetchAuthHeaders(conf.name)
    if (!isCurrent()) return false
    return loginWithBrowserSsoCookies(client, headers?.httpHeaders?.Cookie?.split(";") ?? [])
  }
  const renew = async () => {
    if (await loginWithSavedCookies()) return true
    if (!isCurrent()) return false
    const refreshed = await (
      connection.sendRequest(Methods.recoverBrowserSso, key) as Promise<boolean>
    ).catch(() => false)
    if (refreshed && isCurrent() && (await loginWithSavedCookies())) return true
    if (isCurrent()) {
      blockBrowserSso(key)
      connection.window.showWarningMessage(
        `Syntax check and code completion for ${key} are paused because the SAP login was not completed. Run Connect for ${key} to resume.`
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

const refreshClient = async (key: string, conf: ClientConfiguration) => {
  if (removedConnections.has(key) || blockedBrowserSso.has(key)) return
  const generation = connectionGenerations.get(key) ?? 0
  const oldClient = clients.get(key)
  const sslconf = createServerSslConfig(conf, key)

  const authMethod = getAuthMethod(conf)
  let pwdOrFetch: string | (() => Promise<string>)
  let browserSsoCookies: string[] = []

  if (authMethod !== "basic" && !conf.oauth) {
    const authResponse = await fetchAuthHeaders(conf.name)
    if (removedConnections.has(key) || (connectionGenerations.get(key) ?? 0) !== generation) return
    log(
      `[server] refreshClient: auth response received for ${key}: ${authResponse ? [authResponse.httpHeaders ? "httpHeaders" : undefined, authResponse.certAuth ? "certAuth" : undefined].filter(Boolean).join(",") : "null"}`
    )

    if (authMethod === "cert") {
      log(`[server] refreshClient: reconstructing cert agent for ${key}`)
      if (authResponse?.certAuth) {
        try {
          sslconf.httpsAgent = buildCertificateAgent(
            authResponse.certAuth,
            !!conf.allowSelfSigned,
            conf.customCA
          )
        } catch (e) {
          warn(`Failed to reconstruct cert httpsAgent for ${key}: ${e}`)
          // Don't create a broken client — propagate the error
          throw new Error(`Certificate auth setup failed for ${key}: ${e}`)
        }
      } else {
        warn(
          `Cert auth configured for ${key} but no cert paths received — language features will fail`
        )
      }
      pwdOrFetch = "cert-auth"
    } else if (authMethod === "oauth_onprem" && authResponse?.httpHeaders?.Authorization) {
      log(`[server] refreshClient: setting up OAuth on-prem token fetcher for ${key}`)
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
            `Browser SSO cookies unavailable for ${key}; keeping the current client until refresh succeeds`
          )
          return
        }
        blockBrowserSso(key)
        throw new Error(
          `Browser SSO cookies unavailable for ${key}. Language features resume after the next Browser SSO login.`
        )
      } else if (authMethod === "kerberos") {
        warn(`${authMethod} auth headers missing for ${key} — user may need to reconnect`)
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
    registerBrowserSsoRecovery(key, conf, baseclient)
  }
  baseclient.stateful = session_types.stateful
  clients.set(key, baseclient)
  if (oldClient) {
    setTimeout(() => {
      oldClient.stateful = session_types.stateless
      oldClient.logout().catch(err => warn(`Logout of replaced ${key} client failed: ${err}`))
    }, 2000)
  }
}

export function connectionFolderChanged(added: string[], removed: string[]) {
  for (const key of removed) {
    const normalized = connectionKey(key)
    const client = clients.get(normalized)
    removedConnections.add(normalized)
    blockedBrowserSso.delete(normalized)
    connectionGenerations.set(normalized, (connectionGenerations.get(normalized) ?? 0) + 1)
    clearInterval(refreshTimers.get(normalized))
    refreshTimers.delete(normalized)
    initializations.delete(normalized)
    clients.delete(normalized)
    if (client) {
      client.stateful = session_types.stateless
      client.logout().catch(err => warn(`Logout of removed ${normalized} failed: ${err}`))
    }
  }
  for (const key of added) {
    removedConnections.delete(connectionKey(key))
    blockedBrowserSso.delete(connectionKey(key))
  }
}

export async function browserSsoLoginCompleted(connId: string) {
  const key = connectionKey(connId)
  blockedBrowserSso.delete(key)
  // A working client picks up the new cookies itself the next time SAP rejects the old ones
  if (removedConnections.has(key) || clients.has(key)) return
  try {
    await clientFromKey(key)
  } catch (err) {
    warn(`Client refresh after Browser SSO login failed for ${key}: ${err}`)
  }
}

export async function clientFromKey(key: string) {
  key = connectionKey(key)
  if (removedConnections.has(key) || blockedBrowserSso.has(key)) return undefined
  const client = clients.get(key)
  if (client) return client
  let initialization = initializations.get(key)
  if (!initialization) {
    const generation = connectionGenerations.get(key) ?? 0
    initialization = (async () => {
      const conf = await readConfiguration(key)
      if (
        !conf ||
        removedConnections.has(key) ||
        (connectionGenerations.get(key) ?? 0) !== generation
      )
        return undefined
      await queueRefresh(key, conf)
      if (removedConnections.has(key) || (connectionGenerations.get(key) ?? 0) !== generation)
        return undefined
      const created = clients.get(key)
      if (!created) return undefined
      refreshTimers.set(
        key,
        setInterval(() => {
          void queueRefresh(key, conf).catch(err =>
            warn(`Client refresh failed for ${key}: ${err}`)
          )
        }, 240000)
      )
      return created
    })()
    initializations.set(key, initialization)
    void initialization.then(
      () => {
        if (initializations.get(key) === initialization) initializations.delete(key)
      },
      () => {
        if (initializations.get(key) === initialization) initializations.delete(key)
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
