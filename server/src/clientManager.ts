import { ADTClient, createSSLConfig, LogData, session_types } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { types } from "util"
import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { readConfiguration, sendLog, sendHttpLog } from "./clientapis"
import {
  ClientConfiguration,
  AuthHeadersResponse,
  CertAuthTransport,
  clientTraceUrl,
  getAuthMethod,
  SOURCE_SERVER,
  Methods,
  CommLogTogglePayload
} from "vscode-abap-remote-fs-sharedapi"
import { createProxy, MethodCall } from "method-call-logger"
import { isString } from "./functions"
const clients: Map<string, ADTClient> = new Map()

type ServerSslConfig = ReturnType<typeof createSSLConfig> & {
  debugCallback?: (logData: LogData) => void
  httpsAgent?: https.Agent
  headers?: Record<string, string>
}

export const connection = createConnection(ProposedFeatures.all)
export const error = (...params: unknown[]) => connection.console.error(convertParams(...params))
export const warn = (...params: unknown[]) => connection.console.warn(convertParams(...params))
export const info = (...params: unknown[]) => connection.console.info(convertParams(...params))
export const log = (...params: unknown[]) => connection.console.log(convertParams(...params))

export function clientKeyFromUrl(url: string) {
  const match = url.match(/adt:\/\/([^\/]*)/)
  return match && match[1]
}

function loggedProxy(client: ADTClient, conf: ClientConfiguration) {
  const temp = {
    connection: conf.name,
    source: SOURCE_SERVER,
    fromClone: false
  }
  const logger = (call: MethodCall) => sendLog({ ...temp, call })
  const cloneLogger = (call: MethodCall) => sendLog({ ...temp, call, fromClone: true })

  const clone = createProxy(client.statelessClone, cloneLogger)

  return createProxy(client, logger, {
    resolvePromises: true,
    getterOverride: new Map([["statelessClone", () => clone]])
  })
}

function createFetchToken(conf: ClientConfiguration) {
  if (conf.oauth)
    return () => connection.sendRequest(Methods.getToken, conf.name) as Promise<string>
}

/** Fetch auth headers from the client extension for non-basic auth methods. */
async function fetchAuthHeaders(
  connName: string
): Promise<AuthHeadersResponse | undefined> {
  try {
    const headers = await connection.sendRequest(
      Methods.getAuthHeaders,
      connName
    )
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

  if (!certInfo.certPath || !allowedExts.test(certInfo.certPath) || !existsSync(certInfo.certPath)) {
    throw new Error(`Client certificate not found or invalid extension: ${certInfo.certPath}`)
  }
  if (!isPkcs12 && (!certInfo.keyPath || !allowedExts.test(certInfo.keyPath) || !existsSync(certInfo.keyPath))) {
    throw new Error(`Private key not found or invalid extension: ${certInfo.keyPath}`)
  }

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: !allowSelfSigned,
    keepAlive: true,
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

const refreshClient = async (key: string, conf: ClientConfiguration) => {
  const oldClient = clients.get(key)
  const sslconf = createServerSslConfig(conf, key)

  const authMethod = getAuthMethod(conf)
  let pwdOrFetch: string | (() => Promise<string>)
  log(`[server] refreshClient: key=${key}, authMethod=${authMethod}`)

  if (authMethod !== "basic" && !conf.oauth) {
    const authResponse = await fetchAuthHeaders(conf.name)
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
        warn(`Cert auth configured for ${key} but no cert paths received — language features will fail`)
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
      if (authResponse?.httpHeaders) {
        sslconf.headers = { ...sslconf.headers, ...authResponse.httpHeaders }
      } else if (authMethod === "kerberos" || authMethod === "browser_sso") {
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
  baseclient.stateful = session_types.stateful
  const traceUrl = clientTraceUrl(conf)
  const client = traceUrl ? loggedProxy(baseclient, conf) : baseclient
  clients.set(key, client)
  if (oldClient) {
    setTimeout(() => {
      oldClient.stateful = session_types.stateless
      oldClient.logout()
    }, 2000)
  }
}

export async function clientFromKey(key: string) {
  key = decodeURIComponent(key)
  let client = clients.get(key)
  if (!client) {
    const conf = await readConfiguration(key)
    if (conf) {
      await refreshClient(key, conf)
      // as clients are stateful, they will expire, usually in 10 minutes. So we need to refresh them every 4 minutes
      setInterval(() => refreshClient(key, conf), 240000)
    }
  }
  return client
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
