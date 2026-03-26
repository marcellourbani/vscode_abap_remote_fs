import { ADTClient, createSSLConfig, LogData, session_types } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { types } from "util"
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

const refreshClient = (key: string, conf: ClientConfiguration) => {
  const oldClient = clients.get(key)
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = buildServerDebugCallback(key)
  const pwdOrFetch = createFetchToken(conf) || conf.password
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
      refreshClient(key, conf)
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
