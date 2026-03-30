import { ADTClient, createSSLConfig, LogData, session_types } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { types } from "util"
import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { readConfiguration, sendLog, sendHttpLog } from "./clientapis"
import {
  ClientConfiguration,
  clientTraceUrl,
  SOURCE_SERVER,
  Methods,
  CommLogTogglePayload
} from "vscode-abap-remote-fs-sharedapi"
import { createProxy, MethodCall } from "method-call-logger"
import { isString } from "./functions"
const clients: Map<string, ADTClient> = new Map()

export const connection = createConnection(ProposedFeatures.all)
export const error = (...params: any) => connection.console.error(convertParams(...params))
export const warn = (...params: any) => connection.console.warn(convertParams(...params))
export const info = (...params: any) => connection.console.info(convertParams(...params))
export const log = (...params: any) => connection.console.log(convertParams(...params))

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
): Promise<Record<string, string> | undefined> {
  try {
    const headers = await connection.sendRequest(
      Methods.getAuthHeaders,
      connName
    )
    if (headers && typeof headers === "object") {
      return headers as Record<string, string>
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

const refreshClient = async (key: string, conf: ClientConfiguration) => {
  const oldClient = clients.get(key)
  const sslconf: any = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = buildServerDebugCallback(key)

  const authMethod = conf.authMethod || "basic"
  let pwdOrFetch: string | (() => Promise<string>)
  log(`[server] refreshClient: key=${key}, authMethod=${authMethod}`)

  if (authMethod !== "basic" && !conf.oauth) {
    const authHeaders = await fetchAuthHeaders(conf.name)
    log(`[server] refreshClient: authHeaders received for ${key}: ${authHeaders ? Object.keys(authHeaders).join(",") : "null"}`)

    if (authMethod === "cert") {
      log(`[server] refreshClient: reconstructing cert agent for ${key}`)
      // Reconstruct httpsAgent from cert paths returned by the client
      if (authHeaders && authHeaders._certAuth) {
        try {
          const certInfo = JSON.parse(authHeaders._certAuth)
          const allowedExts = /\.(pem|crt|cer|key|p12|pfx)$/i
          const agentOptions: https.AgentOptions = {
            rejectUnauthorized: !conf.allowSelfSigned,
            keepAlive: true,
          }
          // Handle .p12/.pfx (PKCS#12) vs PEM cert+key
          if (/\.(p12|pfx)$/i.test(certInfo.certPath || "")) {
            if (certInfo.certPath && allowedExts.test(certInfo.certPath) && existsSync(certInfo.certPath))
              agentOptions.pfx = readFileSync(certInfo.certPath)
          } else {
            if (certInfo.certPath && allowedExts.test(certInfo.certPath) && existsSync(certInfo.certPath))
              agentOptions.cert = readFileSync(certInfo.certPath)
            if (certInfo.keyPath && allowedExts.test(certInfo.keyPath) && existsSync(certInfo.keyPath))
              agentOptions.key = readFileSync(certInfo.keyPath)
          }
          // Passphrase received from client over local stdio IPC (same OS user)
          if (certInfo.passphrase)
            agentOptions.passphrase = certInfo.passphrase
          if (certInfo.caPath && allowedExts.test(certInfo.caPath) && existsSync(certInfo.caPath))
            agentOptions.ca = readFileSync(certInfo.caPath)
          sslconf.httpsAgent = new https.Agent(agentOptions)
        } catch (e) {
          warn(`Failed to reconstruct cert httpsAgent for ${key}: ${e}`)
          // Don't create a broken client — propagate the error
          throw new Error(`Certificate auth setup failed for ${key}: ${e}`)
        }
      } else {
        warn(`Cert auth configured for ${key} but no cert paths received — language features will fail`)
      }
      pwdOrFetch = "cert-auth"
    } else if (authMethod === "oauth_onprem" && authHeaders?.Authorization) {
      log(`[server] refreshClient: setting up OAuth on-prem token fetcher for ${key}`)
      const currentToken = authHeaders.Authorization.replace(/^Bearer\s+/i, "")
      pwdOrFetch = () =>
        fetchAuthHeaders(conf.name).then(h => {
          const t = h?.Authorization?.replace(/^Bearer\s+/i, "")
          return t || currentToken
        })
    } else {
      if (authHeaders) {
        // Strip internal metadata key before spreading as HTTP headers
        const { _certAuth, ...httpHeaders } = authHeaders
        sslconf.headers = { ...sslconf.headers, ...httpHeaders }
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

function convertParams(...params: any) {
  let msg = ""
  for (const x of params) {
    try {
      if (types.isNativeError(x)) msg += `\nError ${x.name}\n${x.message}\n\n${x.stack}\n`
      else msg += isString(x) ? x : JSON.stringify(x)
    } catch (e) {
      msg += x.toString()
    }
    msg += " "
  }
  return msg
}
