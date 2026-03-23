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

function debugCallBack(conf: ClientConfiguration) {
  if (httpTraceUrl(conf))
    return (data: LogData) => sendHttpLog({ source: SOURCE_SERVER, data, connection: conf.name })
}
function createFetchToken(conf: ClientConfiguration) {
  if (conf.oauth)
    return () => connection.sendRequest(Methods.getToken, conf.name) as Promise<string>
}

/** Whether the client has the comm-log webview open */
let commLogActive = false
export function setCommLogActive(active: boolean) { commLogActive = active }

const MAX_PAYLOAD = 2 * 1024 * 1024
function serializePayload(data: any): string | undefined {
  if (data === undefined || data === null) return undefined
  try {
    const str = typeof data === "string" ? data : JSON.stringify(data)
    return str.length > MAX_PAYLOAD
      ? str.substring(0, MAX_PAYLOAD) + `\n\n--- TRUNCATED (${str.length} chars total) ---`
      : str
  } catch { return "[unserializable]" }
}

function extractHeaders(headers: any): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined
  const result: Record<string, string> = {}
  const raw = typeof headers.toJSON === "function" ? headers.toJSON() : headers
  for (const [key, val] of Object.entries(raw)) {
    if (val !== undefined && val !== null) result[key] = String(val)
  }
  return Object.keys(result).length ? result : undefined
}

/** Attach axios interceptors to forward ADT HTTP traffic to the client comm log */
function addCommLogInterceptor(adtClient: ADTClient, connId: string) {
  try {
    const httpClient = adtClient.httpClient as any
    if (
      httpClient?.httpclient?.axios?.interceptors &&
      typeof httpClient.httpclient.axios.interceptors === "object"
    ) {
      const axios = httpClient.httpclient.axios

      // Only stamp start time on request — actual logging happens on response
      axios.interceptors.request.use((config: any) => {
        if (config && typeof config === "object") {
          config._adtLogStart = Date.now()
        }
        return config
      })

      axios.interceptors.response.use(
        (response: any) => {
          if (response?.config && commLogActive) {
            try {
              const now = Date.now()
              const start = response.config._adtLogStart
              const entry: CommLogEntryData = {
                connId,
                method: (response.config.method || "GET").toUpperCase(),
                url: response.config.url || "",
                params: response.config.params && typeof response.config.params === "object" ? { ...response.config.params } : undefined,
                requestBody: serializePayload(response.config.data),
                requestHeaders: extractHeaders(response.config.headers),
                responseHeaders: extractHeaders(response.headers),
                status: response.status,
                responseBody: serializePayload(response.data),
                duration: start ? now - start : undefined,
                startTime: start, endTime: now, error: false
              }
              connection.sendNotification(Methods.commLogEntry, entry)
            } catch { /* never break HTTP */ }
          }
          return response
        },
        (error: any) => {
          if (error?.config && commLogActive) {
            try {
              const now = Date.now()
              const start = error.config._adtLogStart
              const entry: CommLogEntryData = {
                connId,
                method: (error.config.method || "GET").toUpperCase(),
                url: error.config.url || "",
                params: error.config.params && typeof error.config.params === "object" ? { ...error.config.params } : undefined,
                requestBody: serializePayload(error.config.data),
                requestHeaders: extractHeaders(error.config.headers),
                responseHeaders: extractHeaders(error.response?.headers),
                status: error.response?.status || "ERR",
                responseBody: serializePayload(error.response?.data),
                duration: start ? now - start : undefined,
                startTime: start, endTime: now, error: true
              }
              connection.sendNotification(Methods.commLogEntry, entry)
            } catch { /* never break HTTP */ }
          }
          return Promise.reject(error)
        }
      )
    }
  } catch { /* ignore interceptor setup failure */ }
}

const refreshClient = (key: string, conf: ClientConfiguration) => {
  const oldClient = clients.get(key)
  const sslconf = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = debugCallBack(conf)
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
  addCommLogInterceptor(baseclient, key)
  addCommLogInterceptor(baseclient.statelessClone, key)
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
