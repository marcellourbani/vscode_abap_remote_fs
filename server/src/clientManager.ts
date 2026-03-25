import { ADTClient, createSSLConfig, LogData, session_types } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { types } from "util"
import { readConfiguration, sendLog, sendHttpLog } from "./clientapis"
import {
  ClientConfiguration,
  clientTraceUrl,
  httpTraceUrl,
  SOURCE_SERVER,
  Methods,
  CommLogEntryData
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
let commLogActive = false
export function setCommLogActive(active: boolean) { commLogActive = active }

/** Cap payload size for comm log to avoid memory issues */
const MAX_COMM_LOG_PAYLOAD = 2 * 1024 * 1024
function capPayload(body: string | undefined): string | undefined {
  if (!body || body.length <= MAX_COMM_LOG_PAYLOAD) return body
  return body.substring(0, MAX_COMM_LOG_PAYLOAD) + `\n\n--- TRUNCATED (${body.length} chars total) ---`
}

/** Forward a LogData entry from the server to the client comm log via LSP notification */
function sendCommLogEntry(data: LogData, connId: string) {
  if (!commLogActive) return
  try {
    const rh: Record<string, string> = {}
    if (data.response?.headers) {
      for (const [k, v] of Object.entries(data.response.headers)) {
        if (v !== undefined && v !== null) rh[k] = String(v)
      }
    }
    const entry: CommLogEntryData = {
      connId,
      method: data.request.method,
      url: data.request.uri,
      params: Object.keys(data.request.params || {}).length ? data.request.params : undefined,
      requestBody: capPayload(data.request.body),
      requestHeaders: Object.keys(data.request.headers || {}).length ? data.request.headers : undefined,
      responseHeaders: Object.keys(rh).length ? rh : undefined,
      status: data.error ? (data.response?.statusCode || "ERR") : data.response.statusCode,
      responseBody: capPayload(data.response?.body),
      duration: data.duration,
      startTime: data.startTime.getTime(),
      endTime: data.startTime.getTime() + data.duration,
      error: !!data.error
    }
    connection.sendNotification(Methods.commLogEntry, entry)
  } catch { /* never break HTTP pipeline for logging */ }
}

/** Build a debugCallback that chains MongoDB tracing and comm log forwarding */
function buildServerDebugCallback(conf: ClientConfiguration, connId: string): (data: LogData) => void {
  const mongoLogger = httpTraceUrl(conf)
    ? (data: LogData) => sendHttpLog({ source: SOURCE_SERVER, data, connection: conf.name })
    : undefined
  return (data: LogData) => {
    if (mongoLogger) mongoLogger(data)
    sendCommLogEntry(data, connId)
  }
}

const refreshClient = (key: string, conf: ClientConfiguration) => {
  const oldClient = clients.get(key)
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = buildServerDebugCallback(conf, key)
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
